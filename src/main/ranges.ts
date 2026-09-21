// Default import (not `{ app }`) so this module's store class can be reused by
// the plain-node wos-metric CLI, where a named import from CJS `electron` fails
// to instantiate. See metrics.ts / metric-cli.ts.
import electron from 'electron'
import fs from 'fs'
import path from 'path'
import { parseA1 } from './transclusions'

const { app } = electron

/**
 * Live ranges: named rectangular grids of cell values — the range-sized sibling
 * of metrics.ts. Where a Metric is one number, a LiveRange is a small grid
 * (numbers, strings, empties) that a user can transclude into a real office
 * document as a BLOCK (see rangeLinks.ts). The literal values are written into
 * the file so it always opens as a correct, ordinary document; the range is the
 * live source a reopened file re-syncs against. Persists as one JSON file in
 * userData — independent of any workspace, like metrics/snapshots.
 *
 * A range's values usually ORIGINATE from a real spreadsheet range on disk
 * (source kind 'xlsx-range'); `values` is a CACHE of the last successful read,
 * so a sourced range degrades gracefully to a literal grid if the source ever
 * vanishes (fail-safe — downstream blocks are never blanked).
 */

/** One cell of a range: a number, a text, or empty. */
export type RangeCell = number | string | null

/** A rectangular grid of cells (every row has the same length, ≥1×1). */
export type RangeGrid = RangeCell[][]

export const RANGES_MAX = 100
export const RANGE_MAX_ROWS = 50
export const RANGE_MAX_COLS = 26
const NAME_MAX = 80
const CELL_TEXT_MAX = 500

const newId = (): string => `range-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

/** A parsed rectangular A1 reference, 0-based inclusive bounds. */
export interface RangeRef {
  startCol: number
  startRow: number
  rows: number
  cols: number
}

/**
 * Parses an A1 range reference ("A1:C4", or a single cell "B2" = 1×1) into
 * 0-based bounds, normalizing a reversed corner order. Null when malformed or
 * larger than the supported size (ranges are small live blocks, not sheets).
 */
export function parseRangeRef(ref: string): RangeRef | null {
  if (typeof ref !== 'string') return null
  const parts = ref.trim().split(':')
  if (parts.length < 1 || parts.length > 2) return null
  const a = parseA1(parts[0])
  const b = parts.length === 2 ? parseA1(parts[1]) : a
  if (!a || !b) return null
  const startCol = Math.min(a.col, b.col)
  const startRow = Math.min(a.row, b.row)
  const rows = Math.abs(a.row - b.row) + 1
  const cols = Math.abs(a.col - b.col) + 1
  if (rows > RANGE_MAX_ROWS || cols > RANGE_MAX_COLS) return null
  return { startCol, startRow, rows, cols }
}

/** 0-based column index → A1 letters (0 = A, 26 = AA). */
export function colLetters(col: number): string {
  let s = ''
  let c = col + 1
  while (c > 0) {
    const r = (c - 1) % 26
    s = String.fromCharCode(65 + r) + s
    c = Math.floor((c - 1) / 26)
  }
  return s
}

/** 0-based { col, row } → A1 address ("B3"). */
export function a1Of(col: number, row: number): string {
  return `${colLetters(col)}${row + 1}`
}

/** Canonical "A1:C4" form of a parsed ref (single cells stay "B2"). */
export function refString(r: RangeRef): string {
  const from = a1Of(r.startCol, r.startRow)
  if (r.rows === 1 && r.cols === 1) return from
  return `${from}:${a1Of(r.startCol + r.cols - 1, r.startRow + r.rows - 1)}`
}

/** Coerces one untrusted cell: finite numbers and capped strings pass, all else null. */
export function coerceCell(raw: unknown): RangeCell {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') return raw.slice(0, CELL_TEXT_MAX)
  return null
}

/**
 * Normalizes an untrusted grid into a rectangular RangeGrid within the size
 * limits, or null when it isn't one (never persists a ragged/oversized grid).
 */
export function coerceGrid(raw: unknown): RangeGrid | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > RANGE_MAX_ROWS) return null
  const width = Array.isArray(raw[0]) ? raw[0].length : -1
  if (width < 1 || width > RANGE_MAX_COLS) return null
  const out: RangeGrid = []
  for (const row of raw) {
    if (!Array.isArray(row) || row.length !== width) return null
    out.push(row.map(coerceCell))
  }
  return out
}

export function gridsEqual(a: RangeGrid, b: RangeGrid): boolean {
  if (a.length !== b.length) return false
  for (let r = 0; r < a.length; r++) {
    if (a[r].length !== b[r].length) return false
    for (let c = 0; c < a[r].length; c++) if (a[r][c] !== b[r][c]) return false
  }
  return true
}

/**
 * Serializes a grid into the WosSetRangeBlock payload-file format (see
 * lokMacros.ts): line 1 "sheet|anchorA1", then one TAB-separated line per row,
 * cells encoded "n:<number>" / "s:<text>" / "e" (empty). Tabs/newlines inside
 * texts (and '|' in the sheet name) are flattened to spaces — they are the
 * format's delimiters. Pure and unit-testable.
 */
export function encodeGridPayload(sheet: string, anchorCell: string, grid: RangeGrid): string {
  const clean = (s: string): string => s.replace(/[\t\r\n]/g, ' ')
  const head = `${clean(sheet).replace(/\|/g, ' ')}|${anchorCell}`
  const rows = grid.map((row) =>
    row
      .map((cell) => (typeof cell === 'number' ? `n:${cell}` : typeof cell === 'string' ? `s:${clean(cell)}` : 'e'))
      .join('\t')
  )
  return [head, ...rows].join('\n') + '\n'
}

/**
 * Serializes a grid into the WosSetDocTable / WosSetSlideTable payload format:
 * line 1 is the anchor `tag`, then one TAB-separated line per row of the plain
 * DISPLAY text of each cell (numbers stringified, empties blank). A table shows
 * text, not typed cells, so — unlike the Calc block payload — there is no n:/s:/e
 * encoding. Tabs/newlines inside texts are flattened (they are the delimiters).
 * Pure and unit-testable.
 */
export function encodeTablePayload(tag: string, grid: RangeGrid): string {
  const clean = (s: string): string => s.replace(/[\t\r\n]/g, ' ')
  const head = clean(tag)
  const rows = grid.map((row) =>
    row.map((cell) => (cell === null || cell === undefined ? '' : clean(String(cell)))).join('\t')
  )
  return [head, ...rows].join('\n') + '\n'
}

/** Where a range's values ORIGINATE (mirrors MetricSource). */
export type RangeSource = { kind: 'xlsx-range'; filePath: string; sheet: string; ref: string }

export interface LiveRange {
  id: string
  name: string
  values: RangeGrid
  updatedAt: number
  /** Absent = literal grid. Present = the grid's live origin. */
  source?: RangeSource
}

/** Normalizes an untrusted source; undefined = literal (or anything invalid). */
export function coerceRangeSource(raw: unknown): RangeSource | undefined {
  const s = (raw ?? {}) as { kind?: unknown; filePath?: unknown; sheet?: unknown; ref?: unknown }
  if (s.kind !== 'xlsx-range' || typeof s.filePath !== 'string' || !s.filePath) return undefined
  if (typeof s.ref !== 'string') return undefined
  const parsed = parseRangeRef(s.ref)
  if (!parsed) return undefined
  return {
    kind: 'xlsx-range',
    filePath: s.filePath,
    sheet: typeof s.sheet === 'string' ? s.sheet : '',
    ref: refString(parsed), // always canonical
  }
}

/** True when a range reads its grid live from a spreadsheet range. */
export function isSourcedRange(r: LiveRange): r is LiveRange & { source: RangeSource } {
  return r.source?.kind === 'xlsx-range'
}

/**
 * Pure refresh decision — the fail-safe core of source-linked ranges (mirrors
 * planRefresh in metrics.ts). It never blanks a grid: an unreadable source
 * keeps the last good values and reports 'stale'.
 */
export type RangeRefreshStatus = 'literal' | 'stale' | 'unchanged' | 'updated'
export function planRangeRefresh(
  range: LiveRange,
  read: { ok: boolean; values?: RangeGrid }
): { status: RangeRefreshStatus; values: RangeGrid } {
  if (!isSourcedRange(range)) return { status: 'literal', values: range.values }
  const values = read.ok ? coerceGrid(read.values) : null
  if (!values) return { status: 'stale', values: range.values } // keep last good grid
  if (gridsEqual(values, range.values)) return { status: 'unchanged', values: range.values }
  return { status: 'updated', values }
}

export class RangeStore {
  constructor(private file: () => string) {}

  // mtime+size-validated read-through cache (mirrors MetricStore): a warm cache
  // costs one fs.statSync instead of a full read+parse per get/list/update, and
  // stays coherent with the separate-process wos-metric CLI (re-parse only when
  // the file changed on disk). Keyed by file path (app vs CLI differ).
  private cache: { file: string; mtimeMs: number; size: number; list: LiveRange[] } | null = null

  private load(): LiveRange[] {
    const file = this.file()
    let mtimeMs = -1
    let size = -1
    try {
      const st = fs.statSync(file)
      mtimeMs = st.mtimeMs
      size = st.size
    } catch {
      mtimeMs = -1 // missing file — treated as an empty, cacheable state
    }
    const c = this.cache
    if (c && c.file === file && c.mtimeMs === mtimeMs && c.size === size) return c.list

    let out: LiveRange[]
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown
      out = []
      if (Array.isArray(parsed)) {
        for (const raw of parsed) {
          const r = raw as { id?: unknown; name?: unknown; values?: unknown; updatedAt?: unknown; source?: unknown }
          if (typeof r?.id !== 'string' || typeof r?.name !== 'string') continue
          const values = coerceGrid(r.values)
          if (!values) continue
          const range: LiveRange = {
            id: r.id,
            name: r.name.slice(0, NAME_MAX),
            values,
            updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
          }
          const source = coerceRangeSource(r.source)
          if (source) range.source = source
          out.push(range)
        }
      }
    } catch {
      out = [] // nothing saved yet, or corrupt file — start fresh
    }
    this.cache = { file, mtimeMs, size, list: out }
    return out
  }

  private save(list: LiveRange[]): void {
    const file = this.file()
    try {
      fs.writeFileSync(file, JSON.stringify(list), 'utf-8')
      try {
        const st = fs.statSync(file)
        this.cache = { file, mtimeMs: st.mtimeMs, size: st.size, list }
      } catch {
        this.cache = null
      }
    } catch {
      // Best-effort — an unwritable userData dir shouldn't block the app.
      this.cache = null
    }
  }

  /** All ranges, newest-updated first. Sorts a COPY (never mutates the cache). */
  list(): LiveRange[] {
    return [...this.load()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(id: string): LiveRange | undefined {
    return this.load().find((r) => r.id === id)
  }

  /** Creates a range; an invalid grid throws (never persists a bad range). */
  create(name: string, values: unknown, source?: unknown): LiveRange {
    const grid = coerceGrid(values)
    if (!grid) throw new Error('invalid range grid')
    const range: LiveRange = {
      id: newId(),
      name: name.trim().slice(0, NAME_MAX) || 'Untitled',
      values: grid,
      updatedAt: Date.now(),
    }
    const src = coerceRangeSource(source)
    if (src) range.source = src
    this.save([range, ...this.load()].slice(0, RANGES_MAX))
    return range
  }

  /**
   * Patches name, values and/or source; bumps updatedAt. No-op for an unknown
   * id or an invalid grid. Passing `source` (even an invalid/literal one)
   * DETACHES to a literal grid, keeping the current cached values.
   */
  update(
    id: string,
    patch: { name?: string; values?: unknown; source?: unknown }
  ): LiveRange | undefined {
    const list = this.load()
    const i = list.findIndex((r) => r.id === id)
    if (i < 0) return undefined
    const cur = list[i]
    const grid = patch.values === undefined ? cur.values : coerceGrid(patch.values)
    const next: LiveRange = {
      ...cur,
      name: typeof patch.name === 'string' ? patch.name.trim().slice(0, NAME_MAX) || cur.name : cur.name,
      values: grid ?? cur.values,
      updatedAt: Date.now(),
    }
    if ('source' in patch) {
      const src = coerceRangeSource(patch.source)
      if (src) next.source = src
      else delete next.source
    }
    list[i] = next
    this.save(list)
    return next
  }

  remove(id: string): void {
    this.save(this.load().filter((r) => r.id !== id))
  }
}

export const ranges = new RangeStore(() => path.join(app.getPath('userData'), 'ranges.json'))
