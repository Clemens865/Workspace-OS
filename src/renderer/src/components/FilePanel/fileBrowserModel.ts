import type { FileEntry } from '../../types/fs'

/**
 * WOS-013 — the Files surface as a real file browser.
 *
 * All the decisions that are worth getting right live here, as pure functions:
 * how things sort, what a "kind" is, how a filter narrows a listing, and how a
 * back/forward history behaves. The view is then a thin thing that renders the
 * result, and none of this needs a DOM to test.
 *
 * The listing this replaces was hardcoded to folders-first-then-name with a
 * name-substring box that flattened matches and lost their folder context.
 */

export type SortKey = 'name' | 'kind' | 'modified' | 'size'
export type SortDir = 'asc' | 'desc'

/**
 * How the folder is drawn. Each answers a different question:
 *   list    — "which of these is newest / biggest" (sortable columns)
 *   icon    — "which one is it" (recognise a document by its look)
 *   gallery — "is this the right one" (one big preview, filmstrip below)
 *   column  — "where does this sit" (the path stays on screen as you drill)
 */
export type ViewMode = 'list' | 'icon' | 'gallery' | 'column'

export const VIEW_MODES: ViewMode[] = ['list', 'icon', 'gallery', 'column']

export function isViewMode(v: unknown): v is ViewMode {
  return typeof v === 'string' && (VIEW_MODES as string[]).includes(v)
}

/**
 * The chain of folders a column view shows, from the root down to `current`.
 *
 * Column view is the one mode where the path IS the interface, so it needs the
 * ancestors as locations rather than as breadcrumb labels. Returns [] when
 * `current` is outside the root, so a stale path cannot make the view render
 * folders from somewhere else entirely.
 */
export function columnChain(root: string, current: string): string[] {
  if (!root) return []
  if (current === root) return [root]
  if (!current.startsWith(`${root}/`)) return [root]

  const chain = [root]
  let acc = root
  for (const part of current.slice(root.length).split('/').filter(Boolean)) {
    acc = `${acc}/${part}`
    chain.push(acc)
  }
  return chain
}

/** True for the formats a real thumbnail can be produced from in the renderer. */
export function isThumbnailable(entry: Pick<FileEntry, 'name' | 'isDirectory'>): boolean {
  if (entry.isDirectory) return false
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(extensionOf(entry.name))
}

/**
 * The coarse buckets a person actually thinks in. Deliberately not a MIME map:
 * "is this a document or a picture" is the question being asked, and a long
 * tail of exact types makes the filter menu useless.
 */
export type FileKind = 'folder' | 'document' | 'spreadsheet' | 'presentation' | 'pdf' | 'image' | 'text' | 'other'

const KIND_BY_EXT: Record<string, FileKind> = {
  doc: 'document', docx: 'document', odt: 'document', rtf: 'document', pages: 'document',
  xls: 'spreadsheet', xlsx: 'spreadsheet', ods: 'spreadsheet', csv: 'spreadsheet', numbers: 'spreadsheet',
  ppt: 'presentation', pptx: 'presentation', odp: 'presentation', key: 'presentation',
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
  heic: 'image', bmp: 'image', tiff: 'image', avif: 'image',
  txt: 'text', md: 'text', json: 'text', yml: 'text', yaml: 'text', log: 'text',
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  // A leading dot is a dotfile, not an extension — ".gitignore" has none.
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function kindOf(entry: Pick<FileEntry, 'name' | 'isDirectory'>): FileKind {
  if (entry.isDirectory) return 'folder'
  return KIND_BY_EXT[extensionOf(entry.name)] ?? 'other'
}

export const KIND_LABEL: Record<FileKind, string> = {
  folder: 'Folder',
  document: 'Document',
  spreadsheet: 'Spreadsheet',
  presentation: 'Presentation',
  pdf: 'PDF',
  image: 'Image',
  text: 'Text',
  other: 'File',
}

/** Human-readable size. Folders have no meaningful one, so they show a dash. */
export function formatSize(entry: FileEntry): string {
  if (entry.isDirectory) return '—'
  const bytes = entry.size
  if (bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  // One decimal below 10 so "1.4 MB" and "940 KB" both read naturally.
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

/**
 * Dates as a person reads them: a time for today, a weekday within the week,
 * otherwise a date. An absolute timestamp on every row is unreadable at a
 * glance, which is the only way this column gets used.
 */
export function formatModified(entry: FileEntry, now = Date.now()): string {
  const ms = entry.mtimeMs
  if (!ms) return '—'
  const d = new Date(ms)
  const age = now - ms
  const DAY = 86_400_000
  if (age < DAY && new Date(now).getDate() === d.getDate()) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  if (age < 7 * DAY) {
    return d.toLocaleDateString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  }
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * Sort a listing.
 *
 * Folders always come first regardless of key or direction — including under a
 * descending sort. Interleaving them by size or date scatters the structure of
 * the folder through the list, and reversing the sort should not move a folder
 * to the bottom of a page of files.
 *
 * Name is the tiebreaker everywhere, so equal sizes or identical timestamps
 * (which are common — a copied folder gives every file the same mtime) still
 * produce a stable, predictable order.
 */
export function sortEntries(entries: readonly FileEntry[], key: SortKey, dir: SortDir): FileEntry[] {
  const sign = dir === 'asc' ? 1 : -1
  const byName = (a: FileEntry, b: FileEntry): number =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1

    switch (key) {
      case 'name':
        return sign * byName(a, b)
      case 'kind': {
        const c = KIND_LABEL[kindOf(a)].localeCompare(KIND_LABEL[kindOf(b)])
        return c !== 0 ? sign * c : byName(a, b)
      }
      case 'modified': {
        const c = (a.mtimeMs ?? 0) - (b.mtimeMs ?? 0)
        return c !== 0 ? sign * c : byName(a, b)
      }
      case 'size': {
        const c = (a.size ?? 0) - (b.size ?? 0)
        return c !== 0 ? sign * c : byName(a, b)
      }
    }
  })
}

export interface BrowserFilter {
  /** Name substring, case-insensitive. */
  text: string
  /** Empty means every kind. */
  kinds: readonly FileKind[]
  /** Only entries modified within this many days. 0 = any age. */
  withinDays: number
}

export const EMPTY_FILTER: BrowserFilter = { text: '', kinds: [], withinDays: 0 }

/**
 * Narrow a listing.
 *
 * A folder is kept whenever it matches by NAME, even under a kind or age
 * filter that would otherwise exclude it — a folder is how you get to the
 * things you are looking for, and filtering the route away leaves the user
 * unable to reach a match one level down.
 */
export function filterEntries(
  entries: readonly FileEntry[],
  filter: BrowserFilter,
  now = Date.now(),
): FileEntry[] {
  const needle = filter.text.trim().toLowerCase()
  const kinds = new Set(filter.kinds)
  const cutoff = filter.withinDays > 0 ? now - filter.withinDays * 86_400_000 : 0

  return entries.filter((e) => {
    if (needle && !e.name.toLowerCase().includes(needle)) return false
    if (e.isDirectory) return true // never filter away the route to a match
    if (kinds.size > 0 && !kinds.has(kindOf(e))) return false
    if (cutoff && (e.mtimeMs ?? 0) < cutoff) return false
    return true
  })
}

export function isFilterActive(f: BrowserFilter): boolean {
  return f.text.trim() !== '' || f.kinds.length > 0 || f.withinDays > 0
}

/** Path split into cumulative crumbs, from the workspace root rightwards. */
export interface Crumb {
  label: string
  path: string
}

export function breadcrumbs(root: string, current: string): Crumb[] {
  const rootName = root.split('/').filter(Boolean).pop() ?? root
  const crumbs: Crumb[] = [{ label: rootName, path: root }]
  if (!current.startsWith(root) || current === root) return crumbs

  let acc = root
  for (const part of current.slice(root.length).split('/').filter(Boolean)) {
    acc = `${acc}/${part}`
    crumbs.push({ label: part, path: acc })
  }
  return crumbs
}

/**
 * Back/forward, with the same rule every browser uses: navigating somewhere new
 * discards the forward entries. Keeping them would offer a "forward" that leads
 * to a place the user has already branched away from.
 */
export interface History {
  stack: string[]
  index: number
}

export function newHistory(start: string): History {
  return { stack: [start], index: 0 }
}

export function navigate(h: History, to: string): History {
  if (h.stack[h.index] === to) return h // re-entering the same folder is not a move
  const stack = [...h.stack.slice(0, h.index + 1), to]
  return { stack, index: stack.length - 1 }
}

export function canGoBack(h: History): boolean {
  return h.index > 0
}

export function canGoForward(h: History): boolean {
  return h.index < h.stack.length - 1
}

export function goBack(h: History): History {
  return canGoBack(h) ? { ...h, index: h.index - 1 } : h
}

export function goForward(h: History): History {
  return canGoForward(h) ? { ...h, index: h.index + 1 } : h
}

export function currentPath(h: History): string {
  return h.stack[h.index]
}
