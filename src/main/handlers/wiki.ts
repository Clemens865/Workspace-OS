import { BrowserWindow, IpcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError, validateFilePath } from '../ipc-validator'
import { getWorkspaceRoot } from '../workspace-root'
import { extractText } from '../search/extract'
import { runProviderOneShot } from '../agent/providerText'
import { indexNow } from './search'
import { WIKI_DIR } from '../wiki/wiki-page'
import * as wiki from '../wiki/wiki-store'

/**
 * The wiki that keeps itself: files the person (or an agent) adds are read one
 * at a time by the person's default model, and their pages in `Wiki/` are
 * written or updated. One queue for the app, so two additions never edit the
 * same page at once; each job holds the workspace it was added in, so
 * switching workspaces mid-queue writes nothing into the wrong one.
 */

/** Files with text worth a page (code is not what a wiki is for). */
const READABLE = new Set(['md', 'markdown', 'txt', 'docx', 'xlsx', 'pptx', 'pdf', 'csv', 'html', 'htm'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out'])
/** A folder adds at most this many files per click; the rest wait for the next. */
export const MAX_PER_ADD = 40
const MIN_TEXT = 40

interface Job {
  root: string
  rel: string
  abs: string
  done: (r: JobResult) => void
}
interface JobResult {
  source: string
  created: string[]
  updated: string[]
  kept: { title: string; why: string }[]
  error?: string
}

const queue: Job[] = []
let current: string | null = null
let finished = 0
let failed: { source: string; error: string }[] = []

const isReadable = (p: string): boolean => READABLE.has(path.extname(p).slice(1).toLowerCase())
/** The wiki's own pages and the app's folder are never sources. */
const isOwn = (rel: string): boolean => rel === WIKI_DIR || rel.startsWith(`${WIKI_DIR}/`) || rel.startsWith('.workspace-os')

/** A file, or a folder's readable files (a few levels deep, hidden and build folders skipped). */
function expand(root: string, abs: string): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.') || out.length >= MAX_PER_ADD * 4) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (depth < 4 && !SKIP_DIRS.has(e.name) && !isOwn(path.relative(root, p))) walk(p, depth + 1)
      } else if (e.isFile() && isReadable(p)) out.push(p)
    }
  }
  const st = fs.statSync(abs)
  if (st.isDirectory()) walk(abs, 0)
  else out.push(abs)
  return out
}

/** The written pages and the index page, read into search before anyone is told. */
async function reindex(root: string, rels: string[]): Promise<void> {
  await indexNow([...rels, `${WIKI_DIR}/Index.md`].map((r) => path.join(root, r))).catch(() => {})
}

function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('wiki:changed')
}

async function work(): Promise<void> {
  if (current !== null) return
  for (let job = queue.shift(); job; job = queue.shift()) {
    current = job.rel
    const result: JobResult = { source: job.rel, created: [], updated: [], kept: [] }
    try {
      const st = fs.statSync(job.abs)
      const text = (await extractText(job.abs)) ?? ''
      if (text.trim().length < MIN_TEXT) throw new Error('there is no text in it to read')
      // The person's default model: a wiki page wants more than the light model gives.
      const r = await wiki.ingest(job.root, job.rel, text, st.mtimeMs, (prompt) =>
        runProviderOneShot(prompt, { label: 'Adding to the wiki' }),
      )
      if (r.change) Object.assign(result, { created: r.change.created, updated: r.change.updated, kept: r.change.kept })
      if (r.change?.pages.length) await reindex(job.root, r.change.pages.map((p) => p.file))
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e)
      failed = [...failed, { source: job.rel, error: result.error }].slice(-10)
    }
    finished++
    job.done(result)
    broadcast()
  }
  current = null
}

export function registerWikiHandlers(ipcMain: IpcMain): void {
  /**
   * Add files or folders. Files already added and unchanged are skipped unless
   * `again`; with `wait` the answer comes when they are done (agents use this).
   */
  ipcHandle(ipcMain, 'wiki:add', async (_e, paths: unknown, opts: unknown) => {
    const root = getWorkspaceRoot()
    if (!root) throw new IpcValidationError('No workspace is open')
    const list = Array.isArray(paths) ? paths : [paths]
    if (!list.length || list.length > 200) throw new IpcValidationError('Which files?')
    const o = (opts ?? {}) as { wait?: unknown; again?: unknown }
    const known = wiki.sources(root)
    const queued = new Set(queue.map((j) => j.abs))
    const files: string[] = []
    let unchanged = 0
    for (const p of list) {
      for (const abs of expand(root, validateFilePath(p, root))) {
        const rel = path.relative(root, abs).split(path.sep).join('/')
        if (isOwn(rel) || queued.has(abs) || files.includes(abs)) continue
        const was = known[rel]
        if (was && o.again !== true && fs.statSync(abs).mtimeMs <= was.mtimeMs + 1) {
          unchanged++
          continue
        }
        files.push(abs)
      }
    }
    const take = files.slice(0, MAX_PER_ADD)
    if (current === null && !queue.length) {
      finished = 0
      failed = []
    }
    const done = take.map(
      (abs) =>
        new Promise<JobResult>((resolve) => {
          queue.push({ root, abs, rel: path.relative(root, abs).split(path.sep).join('/'), done: resolve })
        }),
    )
    void work()
    broadcast()
    const answer = { queued: take.length, unchanged, left: files.length - take.length }
    return o.wait === true ? { ...answer, results: await Promise.all(done) } : answer
  })

  ipcHandle(ipcMain, 'wiki:status', () => ({ busy: current !== null, current, queued: queue.length, finished, failed }))
  ipcHandle(ipcMain, 'wiki:changes', (_e, limit: unknown) => {
    const root = getWorkspaceRoot()
    return root ? wiki.changes(root, typeof limit === 'number' ? Math.min(50, Math.max(1, limit)) : 10) : []
  })
  ipcHandle(ipcMain, 'wiki:sources', () => {
    const root = getWorkspaceRoot()
    return root ? Object.keys(wiki.sources(root)) : []
  })
  ipcHandle(ipcMain, 'wiki:undo', async (_e, id: unknown) => {
    const root = getWorkspaceRoot()
    if (!root || typeof id !== 'string' || !id) throw new IpcValidationError('Which change?')
    const pages = wiki.changePages(root, id)
    const r = wiki.undo(root, id)
    await reindex(root, pages)
    broadcast()
    return r
  })
  ipcHandle(ipcMain, 'wiki:check', () => {
    const root = getWorkspaceRoot()
    return root ? wiki.check(root) : null
  })
}
