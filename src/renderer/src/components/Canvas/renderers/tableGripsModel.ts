/**
 * Table grips: the row/column bands of the selected table (from
 * LOK_CALLBACK_TABLE_SELECTED) as pixel spans, the cell centres the engine
 * can be clicked at, and the border under a pointer for resize drags.
 */
import type { TableAxis, TableGeometry } from './tableGeometry'

export interface Band {
  index: number
  /** Document twips. */
  start: number
  end: number
}

export function bands(a: TableAxis): Band[] {
  const edges = [a.left, ...a.inner, a.right].map((e) => e + a.offset)
  const out: Band[] = []
  for (let i = 0; i + 1 < edges.length; i++) out.push({ index: i, start: edges[i], end: edges[i + 1] })
  return out
}

/** The table's outer box in twips. */
export function tableBox(g: TableGeometry): { x: number; y: number; w: number; h: number } {
  const c = g.columns, r = g.rows
  return { x: c.offset + c.left, y: r.offset + r.left, w: c.right - c.left, h: r.right - r.left }
}

/** Centre point (twips) of a cell, for engine clicks. */
export function cellCentre(g: TableGeometry, row: number, col: number): { x: number; y: number } | null {
  const cb = bands(g.columns)[col], rb = bands(g.rows)[row]
  if (!cb || !rb) return null
  return { x: Math.round((cb.start + cb.end) / 2), y: Math.round((rb.start + rb.end) / 2) }
}

/** The inner border index (0-based, between band i and i+1) within `tol` twips of `pos`, else null. */
export function borderAt(a: TableAxis, pos: number, tol: number): number | null {
  const edges = a.inner.map((e) => e + a.offset)
  for (let i = 0; i < edges.length; i++) if (Math.abs(pos - edges[i]) <= tol) return i
  return null
}

/** New size (1/100 mm) of band `i` when its trailing border moves to `pos` twips; clamped to a minimum. */
export function resizedSizeMm100(a: TableAxis, i: number, pos: number, minTwips = 200): number {
  const b = bands(a)[i]
  if (!b) return 0
  const twips = Math.max(minTwips, pos - b.start)
  return Math.round((twips * 2540) / 1440)
}
