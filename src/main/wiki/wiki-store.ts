import { contentRoot } from '../host-profile'
import { appStateDir } from '../host-profile'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { INDEX_TITLE, WIKI_DIR, fileNameOf, keyOf, linksOf, parsePage, renderIndex, renderPage, type WikiPage } from './wiki-page'
import { applyDrafts, buildIngestPrompt, parseIngest, pickPages } from './wiki-ingest'

/**
 * The wiki on disk: its pages in `Wiki/`, and in `.workspace-os/wiki.json` which
 * files it was written from (and when) plus the last changes, each with the
 * page text before and after, so any change can be undone.
 */

const KEEP_CHANGES = 50

export interface SourceEntry {
  mtimeMs: number
  at: number
  pages: string[]
}
interface PageChange {
  file: string
  title: string
  before: string | null
  after: string
}
export interface WikiChange {
  id: string
  at: number
  source: string
  created: string[]
  updated: string[]
  kept: { title: string; why: string }[]
  pages: PageChange[]
}
interface WikiState {
  sources: Record<string, SourceEntry>
  changes: WikiChange[]
}

const stateFile = (root: string): string => path.join(appStateDir(root), 'wiki.json')
export const wikiDir = (root: string): string => path.join(contentRoot(root), WIKI_DIR)

function readState(root: string): WikiState {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(root), 'utf8')) as Partial<WikiState>
    return { sources: s.sources ?? {}, changes: Array.isArray(s.changes) ? s.changes : [] }
  } catch {
    return { sources: {}, changes: [] }
  }
}
function writeState(root: string, s: WikiState): void {
  const f = stateFile(root)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  const tmp = `${f}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ ...s, changes: s.changes.slice(-KEEP_CHANGES) }, null, 1))
  fs.renameSync(tmp, f)
}

export interface PageFile {
  page: WikiPage
  /** Absolute path. */
  file: string
  text: string
}

/** Every page in `Wiki/` (one folder deep, so the person may sort pages into folders), by key. */
export function readPages(root: string): Map<string, PageFile> {
  const out = new Map<string, PageFile>()
  const dir = wikiDir(root)
  const visit = (d: string, depth: number): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const abs = path.join(d, e.name)
      if (e.isDirectory() && depth < 1) visit(abs, depth + 1)
      if (!e.isFile() || !/\.md$/i.test(e.name)) continue
      const fileTitle = e.name.replace(/\.md$/i, '')
      if (d === dir && keyOf(fileTitle) === keyOf(INDEX_TITLE)) continue
      const text = fs.readFileSync(abs, 'utf8')
      const page = parsePage(text, fileTitle)
      if (!out.has(keyOf(page.title))) out.set(keyOf(page.title), { page, file: abs, text })
    }
  }
  visit(dir, 0)
  return out
}

const dayOf = (now: number): string => {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function writeIndex(root: string, now: number): void {
  const pages = [...readPages(root).values()].map((p) => p.page)
  fs.mkdirSync(wikiDir(root), { recursive: true })
  fs.writeFileSync(path.join(wikiDir(root), `${INDEX_TITLE}.md`), renderIndex(pages, dayOf(now)))
}

export type WikiRunner = (prompt: string) => Promise<string>

export interface IngestResult {
  source: string
  change: WikiChange | null
}

/**
 * Add one file to the wiki. `rel` is workspace-relative, `text` what the file
 * says (office files as the index reads them). The pages are re-read after
 * the model answers: one the person edited meanwhile is left as they wrote it.
 */
export async function ingest(root: string, rel: string, text: string, mtimeMs: number, run: WikiRunner, now = Date.now()): Promise<IngestResult> {
  const before = readPages(root)
  const all = [...before.values()].map((p) => p.page)
  const shown = pickPages(all, text)
  const drafts = parseIngest(await run(buildIngestPrompt({ path: rel, text }, all, shown)))
  const pages = new Map([...before].map(([k, v]) => [k, v.page]))
  const applied = applyDrafts(pages, drafts, new Set(shown.map((p) => keyOf(p.title))), rel, dayOf(now))

  const change: WikiChange = { id: randomUUID(), at: now, source: rel, created: [], updated: [], kept: [...applied.kept], pages: [] }
  fs.mkdirSync(wikiDir(root), { recursive: true })
  for (const page of applied.pages) {
    const was = before.get(keyOf(page.title))
    const file = was?.file ?? path.join(wikiDir(root), fileNameOf(page.title))
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
    if (current !== (was?.text ?? null)) {
      change.kept.push({ title: page.title, why: 'it was edited while the source was being read' })
      continue
    }
    const after = renderPage(page)
    if (after === current) continue // read again, nothing new
    fs.writeFileSync(file, after)
    change.pages.push({ file: path.relative(root, file), title: page.title, before: current, after })
    ;(was ? change.updated : change.created).push(page.title)
  }

  const state = readState(root)
  state.sources[rel] = { mtimeMs, at: now, pages: [...change.created, ...change.updated] }
  if (change.pages.length) state.changes.push(change)
  writeState(root, state)
  if (change.pages.length) writeIndex(root, now)
  return { source: rel, change: change.pages.length || change.kept.length ? change : null }
}

/** The files the wiki was written from, with when each was added. */
export const sources = (root: string): Record<string, SourceEntry> => readState(root).sources

/** The latest changes first, without the page texts. */
export function changes(root: string, limit = 10): Omit<WikiChange, 'pages'>[] {
  return readState(root)
    .changes.slice(-limit)
    .reverse()
    .map(({ pages: _pages, ...c }) => c)
}

/** The workspace-relative files a change touched. */
export const changePages = (root: string, id: string): string[] => readState(root).changes.find((c) => c.id === id)?.pages.map((p) => p.file) ?? []

export interface UndoResult {
  ok: boolean
  restored: string[]
  /** Pages edited since that change: left as they are. */
  left: string[]
}

/**
 * Put the pages back as they were before a change. A page edited since (by
 * the person or a later change) is left alone and named, never overwritten.
 */
export function undo(root: string, id: string, now = Date.now()): UndoResult {
  const state = readState(root)
  const change = state.changes.find((c) => c.id === id)
  if (!change) return { ok: false, restored: [], left: [] }
  const restored: string[] = []
  const left: string[] = []
  for (const p of change.pages) {
    const abs = path.resolve(root, p.file)
    if (!abs.startsWith(wikiDir(root) + path.sep)) continue
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null
    if (current !== p.after) {
      left.push(p.title)
      continue
    }
    if (p.before === null) fs.rmSync(abs, { force: true })
    else fs.writeFileSync(abs, p.before)
    restored.push(p.title)
  }
  state.changes = state.changes.filter((c) => c.id !== id)
  // Undone, the file counts as not added: adding it again reads it again.
  if (!left.length) delete state.sources[change.source]
  writeState(root, state)
  writeIndex(root, now)
  return { ok: true, restored, left }
}

export interface WikiCheck {
  pages: number
  /** Sources changed since they were added (worth adding again). */
  changed: string[]
  /** Sources that no longer exist. */
  missing: string[]
  /** Pages no other page links to. */
  unlinked: string[]
  /** [[Titles]] pages link to that have no page yet, most wanted first. */
  wanted: { title: string; refs: number }[]
}

/** What needs a look, without a model: changed and missing sources, lone pages, missing pages. */
export function check(root: string): WikiCheck {
  const pages = readPages(root)
  const state = readState(root)
  const changed: string[] = []
  const missing: string[] = []
  for (const [rel, s] of Object.entries(state.sources)) {
    try {
      if (fs.statSync(path.join(root, rel)).mtimeMs > s.mtimeMs + 1) changed.push(rel)
    } catch {
      missing.push(rel)
    }
  }
  const linkedTo = new Map<string, number>()
  const names = new Map<string, string>()
  for (const { page } of pages.values()) {
    for (const k of linksOf(page.body)) if (k !== keyOf(page.title)) linkedTo.set(k, (linkedTo.get(k) ?? 0) + 1)
    for (const m of page.body.matchAll(/\[\[([^\][|#\n]+?)(?:[#|][^\]\n]*)?\]\]/g)) names.set(keyOf(m[1]), m[1].trim())
  }
  return {
    pages: pages.size,
    changed: changed.sort(),
    missing: missing.sort(),
    unlinked: [...pages.values()].filter(({ page }) => !linkedTo.has(keyOf(page.title))).map(({ page }) => page.title).sort(),
    wanted: [...linkedTo]
      .filter(([k]) => !pages.has(k) && k !== keyOf(INDEX_TITLE))
      .map(([k, refs]) => ({ title: names.get(k) ?? k, refs }))
      .sort((a, b) => b.refs - a.refs || a.title.localeCompare(b.title))
      .slice(0, 20),
  }
}
