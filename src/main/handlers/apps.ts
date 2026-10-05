import { app, BrowserWindow, dialog, IpcMain, protocol, shell } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError } from '../ipc-validator'
import { getWorkspaceRoot } from '../workspace-root'
import { runProviderJson } from '../agent/providerText'
import * as apps from '../apps/apps-store'

/**
 * Apps: the gallery, running an app, and what an app asks of the workspace.
 *
 * Every call from an app is checked twice: the window checks that it came from
 * that app's frame and that app.json grants it; here it is checked again
 * against app.json on disk, because the window can be wrong and the disk is
 * the person's. Files only ever move through the person's own Open/Save
 * dialog. AI runs with no tools in a temporary folder (so a prompt cannot read
 * the workspace), web lookup only for apps granted "ai.web".
 */

/** Where the kit and the built-in apps are: the packaged resources, or the repo (dev, or launched from out/main). */
function resource(name: string): string {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, name) : '',
    path.join(app.getAppPath(), 'resources', name),
    path.join(app.getAppPath(), '..', '..', 'resources', name),
  ].filter(Boolean)
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[candidates.length - 1]
}

let kit: apps.Kit | null = null
const getKit = (): apps.Kit => (kit ??= apps.loadKit(resource('apps-kit')))

const requireRoot = (): string => {
  const root = getWorkspaceRoot()
  if (!root) throw new IpcValidationError('Open a workspace folder first')
  return root
}
const requireSlug = (slug: unknown): string => {
  if (!apps.isSlug(slug)) throw new IpcValidationError('Which app?')
  return slug
}

/** The built-in apps (templates) a workspace can add. */
function templates(): apps.AppManifest[] {
  const dir = resource('apps')
  try {
    return fs
      .readdirSync(dir)
      .filter(apps.isSlug)
      .map((id) => apps.readManifestAt(path.join(dir, id), id))
      .filter((m): m is apps.AppManifest => !!m)
  } catch {
    return []
  }
}

const running = new Map<string, number>()
const MAX_AI_PER_APP = 2
const MAX_PROMPT = 60_000

async function aiComplete(m: apps.AppManifest, a: Record<string, unknown>): Promise<unknown> {
  const web = a.web === true
  if (!m.permissions.includes('ai') && !(web && m.permissions.includes('ai.web'))) throw new Error(`${m.name} may not use AI (app.json: "permissions": ["ai"])`)
  if (web && !m.permissions.includes('ai.web')) throw new Error(`${m.name} may not look things up on the web (app.json: "permissions": ["ai.web"])`)
  const prompt = typeof a.prompt === 'string' ? a.prompt : ''
  if (!prompt.trim()) throw new Error('Ask something')
  if (prompt.length > MAX_PROMPT) throw new Error('That prompt is too long')
  const n = running.get(m.slug) ?? 0
  if (n >= MAX_AI_PER_APP) throw new Error('This app is already waiting for two answers')
  running.set(m.slug, n + 1)
  try {
    const json = a.json === true
    const system = [
      `You are the AI inside "${m.name}", a small app the person made in Workspace OS. Do exactly what the app asks; answer with the result only, no preamble.`,
      typeof a.system === 'string' ? a.system.slice(0, 8000) : '',
      json ? 'Answer with valid JSON only: no code fences, no commentary.' : '',
    ]
      .filter(Boolean)
      .join('\n')
    const r = await runProviderJson({ prompt, systemPrompt: system, cwd: os.tmpdir(), timeoutMs: 180_000, allowedTools: web ? ['WebSearch', 'WebFetch'] : [] })
    if (r.timedOut) throw new Error('The answer took too long')
    const text = r.text.trim()
    if (!text) throw new Error('No answer came back')
    if (!json) return text
    const body = text.replace(/^```(?:json)?\s*|\s*```$/g, '')
    try {
      return JSON.parse(body)
    } catch {
      throw new Error('The answer was not valid JSON')
    }
  } finally {
    running.set(m.slug, (running.get(m.slug) ?? 1) - 1)
  }
}

async function saveFile(root: string, a: Record<string, unknown>): Promise<string | null> {
  const name = (typeof a.name === 'string' ? a.name : 'export').replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ').trim().slice(0, 120) || 'export'
  const data = typeof a.data === 'string' ? a.data : ''
  if (data.length > 40 * 1024 * 1024) throw new Error('That file is too large')
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(root, name) })
  if (r.canceled || !r.filePath) return null
  fs.writeFileSync(r.filePath, a.encoding === 'base64' ? Buffer.from(data, 'base64') : data)
  return path.basename(r.filePath)
}

async function openFile(root: string, a: Record<string, unknown>): Promise<{ name: string; data: string } | null> {
  const exts = (Array.isArray(a.accept) ? a.accept : []).filter((x): x is string => typeof x === 'string').map((x) => x.replace(/^\./, '')).filter((x) => /^\w{1,8}$/.test(x))
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const r = await dialog.showOpenDialog(win, { defaultPath: root, properties: ['openFile'], ...(exts.length ? { filters: [{ name: 'Files', extensions: exts }] } : {}) })
  const f = r.filePaths[0]
  if (r.canceled || !f) return null
  if (fs.statSync(f).size > 25 * 1024 * 1024) throw new Error('That file is larger than 25 MB')
  const buf = fs.readFileSync(f)
  return { name: path.basename(f), data: a.as === 'base64' ? buf.toString('base64') : buf.toString('utf8') }
}

/**
 * Apps (and a chat's HTML artifacts) are served from wos-app://, not srcdoc:
 * a srcdoc frame inherits the app window's own policy, which forbids inline
 * scripts, so no app could run. Here each page carries its own policy: inline
 * scripts yes, network no, and a forced sandbox (no origin) even if the page
 * were ever opened on its own. Only the default session knows the scheme; the
 * in-app browser's pages (their own partitions) cannot reach it.
 *
 *   wos-app://app/<slug>/?theme=dark      an app, assembled (see composeApp)
 *   wos-app://file/?path=<relative.html>  an HTML file of the workspace (artifacts)
 */
export const APP_SCHEME = 'wos-app'
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true } }])
}

const PAGE_HEADERS = (): Record<string, string> => ({
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': `${apps.APP_CSP}; sandbox allow-scripts allow-modals`,
  'cache-control': 'no-store',
})

function serve(req: Request): Response {
  const root = getWorkspaceRoot()
  const url = new URL(req.url)
  const fail = (status: number, text: string): Response => new Response(text, { status, headers: { 'content-type': 'text/plain' } })
  if (!root) return fail(404, 'No workspace is open')
  try {
    if (url.host === 'app') {
      const slug = url.pathname.split('/').filter(Boolean)[0]
      if (!apps.isSlug(slug)) return fail(404, 'No such app')
      const { html } = apps.composeApp(root, slug, getKit(), url.searchParams.get('theme') === 'dark' ? 'dark' : 'light')
      return new Response(html, { headers: PAGE_HEADERS() })
    }
    if (url.host === 'file') {
      const rel = url.searchParams.get('path') ?? ''
      const abs = path.resolve(root, rel)
      if (!abs.startsWith(root + path.sep) || !/\.html?$/i.test(abs) || !fs.existsSync(abs)) return fail(404, 'Not a page of this workspace')
      return new Response(fs.readFileSync(abs, 'utf8'), { headers: PAGE_HEADERS() })
    }
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : 'Could not open it')
  }
  return fail(404, 'Not found')
}

export function registerAppsHandlers(ipcMain: IpcMain): void {
  protocol.handle(APP_SCHEME, (req) => serve(req))

  /** What the host needs to check an app's requests (its permissions). */
  ipcHandle(ipcMain, 'apps:manifest', (_e, slug: unknown) => {
    const m = apps.readManifest(requireRoot(), requireSlug(slug))
    if (!m) throw new IpcValidationError('No such app')
    return m
  })

  ipcHandle(ipcMain, 'apps:list', () => {
    const root = getWorkspaceRoot()
    return root ? apps.listApps(root) : []
  })

  ipcHandle(ipcMain, 'apps:templates', () => {
    const root = getWorkspaceRoot()
    const have = new Set(root ? apps.listApps(root).map((a) => a.from).filter(Boolean) : [])
    return templates().map((t) => ({ ...t, added: have.has(t.slug) }))
  })

  /** Add a built-in app to the workspace (a copy the person owns and can change). */
  ipcHandle(ipcMain, 'apps:install', (_e, id: unknown) => {
    const root = requireRoot()
    const t = templates().find((x) => x.slug === requireSlug(id))
    if (!t) throw new IpcValidationError('No such app in the gallery')
    const slug = apps.freeSlug(root, t.slug)
    apps.copyApp(path.join(resource('apps'), t.slug), apps.appDir(root, slug))
    const file = path.join(apps.appDir(root, slug), 'app.json')
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), from: t.slug }, null, 2))
    return slug
  })

  /** A new, empty app for the builder to fill. */
  ipcHandle(ipcMain, 'apps:create', (_e, name: unknown, description: unknown) => {
    const root = requireRoot()
    const n = typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : 'New app'
    const slug = apps.freeSlug(root, apps.slugify(n))
    const dir = apps.appDir(root, slug)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify({ name: n, description: typeof description === 'string' ? description.slice(0, 240) : '', icon: n.slice(0, 1).toUpperCase(), permissions: ['ai'], entry: 'index.html' }, null, 2))
    fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html>\n<html>\n<head><title>${n.replace(/[<&]/g, '')}</title></head>\n<body>\n  <div class="wos-app"><div class="wos-main"><div class="wos-empty">Describe this app in the chat, and it is built here.</div></div></div>\n</body>\n</html>\n`)
    return slug
  })

  ipcHandle(ipcMain, 'apps:duplicate', (_e, slug: unknown) => {
    const root = requireRoot()
    const from = apps.appDir(root, requireSlug(slug))
    const copy = apps.freeSlug(root, `${slug}-copy`)
    apps.copyApp(from, apps.appDir(root, copy))
    const m = apps.readManifest(root, copy)
    if (m) fs.writeFileSync(path.join(apps.appDir(root, copy), 'app.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(from, 'app.json'), 'utf8')), name: `${m.name} (copy)` }, null, 2))
    return copy
  })

  /** The design check (apps-store lintApp): run after each builder turn. */
  ipcHandle(ipcMain, 'apps:lint', (_e, slug: unknown) => apps.lintApp(requireRoot(), requireSlug(slug)))

  ipcHandle(ipcMain, 'apps:reveal', (_e, slug: unknown) => {
    shell.showItemInFolder(path.join(apps.appDir(requireRoot(), requireSlug(slug)), 'app.json'))
  })

  /** The app as one sandboxable page. */
  ipcHandle(ipcMain, 'apps:load', (_e, slug: unknown, theme: unknown) => {
    return apps.composeApp(requireRoot(), requireSlug(slug), getKit(), theme === 'dark' ? 'dark' : 'light')
  })

  /** One request from a running app (see resources/apps-kit/bridge.js). */
  ipcHandle(ipcMain, 'apps:call', async (_e, slug: unknown, method: unknown, args: unknown) => {
    const root = requireRoot()
    const m = apps.readManifest(root, requireSlug(slug))
    if (!m) throw new IpcValidationError('No such app')
    const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
    switch (method) {
      case 'ai.complete':
        return aiComplete(m, a)
      case 'storage.get':
      case 'storage.set':
      case 'storage.remove':
      case 'storage.keys':
        return apps.storage(root, m.slug, method.slice(8) as 'get', a.key as string, a.value)
      case 'files.save':
        return saveFile(root, a)
      case 'files.open':
        return openFile(root, a)
      default:
        throw new IpcValidationError('Apps cannot do that')
    }
  })
}
