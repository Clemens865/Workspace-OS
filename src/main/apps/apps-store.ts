import fs from 'fs'
import path from 'path'

/**
 * Apps made in Workspace OS: each a folder in the workspace's `Apps/`, so it
 * travels with the workspace and is plain files the person owns.
 *
 *   Apps/<slug>/app.json     name, description, icon, permissions, entry
 *   Apps/<slug>/index.html   the app (more .js/.css beside it are fine)
 *   Apps/<slug>/data/        what the app stores through wos.storage
 *
 * An app runs as ONE page assembled here: its own scripts and styles inlined
 * (only from its own folder), the Workspace OS kit and fonts, the wos bridge,
 * and a Content-Security-Policy that loads nothing from the network. The host
 * shows it in a sandboxed frame with no origin (see AppHost).
 */

export const APPS_DIR = 'Apps'
/** What an app may ask for beyond its own storage and the person's file dialogs. */
export const PERMISSIONS = ['ai', 'ai.web'] as const
export type Permission = (typeof PERMISSIONS)[number]

export interface AppManifest {
  slug: string
  name: string
  description: string
  /** One emoji or up to two letters, for the card. */
  icon: string
  permissions: Permission[]
  entry: string
  /** Where it came from (a built-in template id), if anywhere. */
  from?: string
}
export interface AppSummary extends AppManifest {
  updatedAt: number
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/
export const isSlug = (s: unknown): s is string => typeof s === 'string' && SLUG.test(s)

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'app'
  )
}

export const appDir = (root: string, slug: string): string => {
  if (!isSlug(slug)) throw new Error('Not an app name')
  return path.join(root, APPS_DIR, slug)
}

/** A manifest read defensively: a hand-edited or generated app.json never breaks the gallery. */
export function readManifest(root: string, slug: string): AppManifest | null {
  return readManifestAt(appDir(root, slug), slug)
}

/** The manifest of the app in `dir` (a workspace app, or a built-in template). */
export function readManifestAt(dir: string, slug: string): AppManifest | null {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8')) as Record<string, unknown>
  } catch {
    return fs.existsSync(path.join(dir, 'index.html')) ? { slug, name: slug, description: '', icon: slug.slice(0, 2).toUpperCase(), permissions: [], entry: 'index.html' } : null
  }
  const str = (v: unknown, n: number): string => (typeof v === 'string' ? v.trim().slice(0, n) : '')
  const entry = str(raw.entry, 80) || 'index.html'
  return {
    slug,
    name: str(raw.name, 60) || slug,
    description: str(raw.description, 240),
    icon: str(raw.icon, 4) || slug.slice(0, 2).toUpperCase(),
    permissions: (Array.isArray(raw.permissions) ? raw.permissions : []).filter((p): p is Permission => PERMISSIONS.includes(p as Permission)),
    entry: /^[\w.-]+\.html?$/.test(entry) ? entry : 'index.html',
    ...(typeof raw.from === 'string' ? { from: str(raw.from, 64) } : {}),
  }
}

/** Every app in the workspace, most recently changed first. */
export function listApps(root: string): AppSummary[] {
  let names: string[] = []
  try {
    names = fs.readdirSync(path.join(root, APPS_DIR)).filter(isSlug)
  } catch {
    return []
  }
  const out: AppSummary[] = []
  for (const slug of names) {
    const m = readManifest(root, slug)
    if (!m) continue
    let updatedAt = 0
    try {
      for (const f of fs.readdirSync(appDir(root, slug))) {
        const st = fs.statSync(path.join(appDir(root, slug), f))
        if (st.isFile()) updatedAt = Math.max(updatedAt, st.mtimeMs)
      }
    } catch {
      /* listed without a date */
    }
    out.push({ ...m, updatedAt })
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** A file of the app's own folder, or null for anything that leaves it (.., absolute, URLs). */
function ownFile(dir: string, ref: string): string | null {
  if (!/^[\w./ -]+$/.test(ref) || ref.startsWith('/') || ref.includes('..') || /^[a-z]+:/i.test(ref)) return null
  const p = path.resolve(dir, ref)
  return p.startsWith(dir + path.sep) && fs.existsSync(p) ? p : null
}

/** Nothing from the network; inline scripts and styles, images and fonts from data: and blob:. */
export const APP_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'"

/** `</script>` inside inlined code would end the tag early. */
const safeScript = (js: string): string => js.replace(/<\/script/gi, '<\\/script')

export interface Kit {
  /** The kit stylesheet with its fonts already inlined as data: URLs. */
  css: string
  bridge: string
}

/** Reads the kit once: its CSS with the font files embedded. */
export function loadKit(kitDir: string): Kit {
  const css = fs.readFileSync(path.join(kitDir, 'kit.css'), 'utf8').replace(/url\('fonts\/([\w.-]+\.woff2)'\)/g, (_m, f: string) => {
    try {
      return `url('data:font/woff2;base64,${fs.readFileSync(path.join(kitDir, 'fonts', f)).toString('base64')}')`
    } catch {
      return 'local(none)'
    }
  })
  return { css, bridge: fs.readFileSync(path.join(kitDir, 'bridge.js'), 'utf8') }
}

/** The app as one page: CSP, kit, bridge, then the app with its own files inlined. */
export function composeApp(root: string, slug: string, kit: Kit, theme: 'light' | 'dark'): { manifest: AppManifest; html: string } {
  const manifest = readManifest(root, slug)
  if (!manifest) throw new Error('No such app')
  const dir = appDir(root, slug)
  let html = fs.readFileSync(path.join(dir, manifest.entry), 'utf8')
  // The app's own scripts and stylesheets, inlined; anything else is dropped (the CSP would refuse it anyway).
  html = html.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (_m, a: string, ref: string, b: string) => {
    const f = ownFile(dir, ref)
    const type = /type=["']module["']/i.test(a + b) ? ' type="module"' : ''
    return f ? `<script${type}>\n${safeScript(fs.readFileSync(f, 'utf8'))}\n</script>` : ''
  })
  html = html.replace(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi, (tag) => {
    const ref = /href=["']([^"']+)["']/i.exec(tag)?.[1] ?? ''
    const f = ownFile(dir, ref)
    return f ? `<style>\n${fs.readFileSync(f, 'utf8').replace(/<\/style/gi, '<\\/style')}\n</style>` : ''
  })
  const info = JSON.stringify({ slug, name: manifest.name, theme }).replace(/</g, '\\u003c')
  const head = [
    `<meta charset="utf-8">`,
    `<meta http-equiv="Content-Security-Policy" content="${APP_CSP}">`,
    `<style data-wos-kit>\n${kit.css}\n</style>`,
    `<script>window.__WOS_APP__=${info}</script>`,
    `<script data-wos-bridge>\n${safeScript(kit.bridge)}\n</script>`,
  ].join('\n')
  // The kit goes first in <head>, so the app's own styles come after it and can refine it.
  if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (h) => `${h}\n${head}`)
  else html = `<!doctype html><html data-theme="${theme}"><head>${head}</head><body>${html}</body></html>`
  return { manifest, html }
}

// ── each app's own storage: Apps/<slug>/data/store.json ──
const MAX_STORE = 5 * 1024 * 1024
const storeFile = (root: string, slug: string): string => path.join(appDir(root, slug), 'data', 'store.json')

function readStore(root: string, slug: string): Record<string, unknown> {
  try {
    const v = JSON.parse(fs.readFileSync(storeFile(root, slug), 'utf8'))
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function storage(root: string, slug: string, op: 'get' | 'set' | 'remove' | 'keys', key?: string, value?: unknown): unknown {
  const all = readStore(root, slug)
  if (op === 'keys') return Object.keys(all)
  if (typeof key !== 'string' || !key || key.length > 200) throw new Error('A storage key is a short string')
  if (op === 'get') return all[key] ?? null
  if (op === 'remove') delete all[key]
  else all[key] = value === undefined ? null : value
  const json = JSON.stringify(all)
  if (json.length > MAX_STORE) throw new Error('This app has stored more than 5 MB')
  fs.mkdirSync(path.dirname(storeFile(root, slug)), { recursive: true })
  fs.writeFileSync(storeFile(root, slug), json)
  return null
}

/** Copy a folder (a template into Apps/, or an app to its duplicate). Data stays behind. */
export function copyApp(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true })
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.name === 'data' || e.name.startsWith('.')) continue
    const a = path.join(from, e.name)
    const b = path.join(to, e.name)
    if (e.isDirectory()) copyApp(a, b)
    else fs.copyFileSync(a, b)
  }
}

/** `slug`, or `slug-2`… if the workspace already has one. */
export function freeSlug(root: string, slug: string): string {
  const base = slug.slice(0, 60)
  let s = base
  for (let i = 2; fs.existsSync(path.join(root, APPS_DIR, s)); i++) s = `${base}-${i}`
  return s
}

// ── the design check: what an app must not do to look and run like Workspace OS ──
export const KIT_CLASSES = new Set([
  'wos-app', 'wos-header', 'wos-title', 'wos-main', 'wos-split', 'wos-side', 'wos-stack', 'wos-row', 'wos-grid', 'wos-toolbar',
  'wos-card', 'wos-panel', 'wos-empty', 'wos-label', 'wos-muted', 'wos-small', 'wos-chip', 'wos-btn', 'wos-input', 'wos-textarea',
  'wos-select', 'wos-range', 'wos-segment', 'wos-spinner', 'wos-error', 'wos-icon',
])

export interface LintFinding {
  rule: 'colour' | 'font' | 'network' | 'storage' | 'class'
  /** What was found, as the person and the builder will read it. */
  detail: string
}

/**
 * Checks an app's own files against the kit and the sandbox. Run after every
 * builder turn: what it finds goes back to the builder once, to fix.
 */
export function lintApp(root: string, slug: string): LintFinding[] {
  const dir = appDir(root, slug)
  let files: string[] = []
  try {
    files = fs.readdirSync(dir).filter((f) => /\.(html?|js|css)$/i.test(f))
  } catch {
    return []
  }
  const found: LintFinding[] = []
  const add = (rule: LintFinding['rule'], detail: string): void => {
    if (!found.some((f) => f.detail === detail)) found.push({ rule, detail })
  }
  for (const f of files) {
    // Comments say nothing about the app's looks.
    const text = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g, '')
    // A colour, not an HTML entity (&#039;) or an id like #add-note.
    const colours = [...new Set(text.match(/(?<![&\w])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi) ?? [])]
    if (colours.length) add('colour', `${f}: hard-coded colours ${colours.slice(0, 8).join(' ')}; use the kit tokens (--ink, --muted, --line, --paper, --accent, --swatch-1…6 and their -soft fills)`)
    if (/\brgba?\(\s*\d/i.test(text)) add('colour', `${f}: rgb()/rgba() with numbers; tint with rgba(var(--ink-rgb), …) or rgba(var(--paper-rgb), …)`)
    for (const m of text.matchAll(/font-family\s*[:=]\s*['"]?([^;'"\n]+)/gi)) {
      if (!/^\s*(var\(--|inherit)/.test(m[1])) add('font', `${f}: font-family ${m[1].trim().slice(0, 40)}; use var(--sans), var(--serif) or var(--mono)`)
    }
    const urls = (text.match(/https?:\/\/[^\s'"`)<>]+/g) ?? []).filter((u) => !u.startsWith('http://www.w3.org/'))
    if (urls.length) add('network', `${f}: loads from the web (${urls[0].slice(0, 60)}); apps have no network, write it into the app`)
    if (/\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/.test(text)) add('storage', `${f}: uses browser storage, which the sandbox refuses; use wos.storage`)
    for (const c of new Set(text.match(/\bwos-[a-z-]+\b/g) ?? [])) {
      if (!KIT_CLASSES.has(c) && !/^wos-(app|bridge|kit)\b/.test(c)) add('class', `${f}: .${c} is not in the kit (modifiers are separate classes: "wos-btn ghost")`)
    }
  }
  return found
}
