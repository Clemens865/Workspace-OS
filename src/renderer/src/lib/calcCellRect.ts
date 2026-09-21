/**
 * Pure Calc cell-address → pixel-rect math for the in-canvas live-link overlay.
 * Mirrors CalcHeaders' column/row span computation (run-length sizes from
 * .uno:SheetGeometryData, twips → px via pxPerTwip) so an overlaid marker lands
 * exactly on the cell the header strips draw. No React, no DOM — unit-testable.
 */
import type { SheetGeometry } from '../types/workspace-api'

const A1_RE = /^([A-Za-z]{1,3})([1-9][0-9]{0,6})$/

/** A1 address → 0-based { col, row }, or null when malformed (mirrors main). */
export function parseA1(cell: string): { col: number; row: number } | null {
  const m = A1_RE.exec(typeof cell === 'string' ? cell.trim() : '')
  if (!m) return null
  let col = 0
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { col: col - 1, row: parseInt(m[2], 10) - 1 }
}

interface Run {
  size: number
  last: number
}

/** Parses a SheetGeometryData run-length string ("size:lastIndex …", twips). */
export function parseRuns(s?: string): Run[] {
  if (!s) return []
  const runs: Run[] = []
  for (const tok of s.trim().split(/\s+/)) {
    const [sz, last] = tok.split(':').map(Number)
    if (Number.isFinite(sz) && Number.isFinite(last)) runs.push({ size: sz, last })
  }
  return runs
}

/** The size (twips) of the axis entry at 0-based index `i` from its runs. */
function sizeAt(runs: Run[], i: number): number {
  for (const r of runs) if (i <= r.last) return r.size
  return runs[runs.length - 1]?.size ?? 0
}

/** Start offset (twips) of index `i` = the summed sizes of everything before it. */
function startOf(runs: Run[], i: number): number {
  let acc = 0
  for (let k = 0; k < i; k++) acc += sizeAt(runs, k)
  return acc
}

export interface CellRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Pixel rect for one cell, in the same document-px space as the cell-cursor
 * overlay (origin at the top-left of the grid, before scroll). Returns null when
 * the address is malformed or the geometry has no usable sizes for either axis.
 */
export function cellRectFromGeometry(
  geometry: SheetGeometry | null,
  cell: string,
  pxPerTwip: number
): CellRect | null {
  if (!geometry) return null
  const addr = parseA1(cell)
  if (!addr) return null
  const colRuns = parseRuns(geometry.columns?.sizes)
  const rowRuns = parseRuns(geometry.rows?.sizes)
  if (!colRuns.length || !rowRuns.length) return null
  const colW = sizeAt(colRuns, addr.col)
  const rowH = sizeAt(rowRuns, addr.row)
  if (colW <= 0 || rowH <= 0) return null
  return {
    x: startOf(colRuns, addr.col) * pxPerTwip,
    y: startOf(rowRuns, addr.row) * pxPerTwip,
    w: colW * pxPerTwip,
    h: rowH * pxPerTwip,
  }
}

/** 0-based column index → letters (0 → A, 26 → AA). */
export function colToLetters(col: number): string {
  let s = ''
  let n = col + 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** 0-based { col, row } → A1. */
export function toA1(col: number, row: number): string {
  return `${colToLetters(col)}${row + 1}`
}

/** Index of the axis entry containing a twips offset (runs from SheetGeometryData). */
function indexAt(runs: Run[], t: number): number {
  let acc = 0
  let i = 0
  for (const r of runs) {
    // Every index up to r.last has size r.size; jump through the run when the
    // point lies beyond it, otherwise land inside it.
    const count = r.last - i + 1
    if (t < acc + count * r.size) return i + Math.floor((t - acc) / r.size)
    acc += count * r.size
    i = r.last + 1
  }
  return i
}

/**
 * The 0-based cell under a document point in twips, or null without usable
 * geometry. Never negative; a point past the last run extends the last size,
 * the same way the header strips extrapolate.
 */
export function cellAtTwips(geometry: SheetGeometry | null, x: number, y: number): { col: number; row: number } | null {
  if (!geometry) return null
  const colRuns = parseRuns(geometry.columns?.sizes)
  const rowRuns = parseRuns(geometry.rows?.sizes)
  if (!colRuns.length || !rowRuns.length) return null
  return { col: indexAt(colRuns, Math.max(0, x)), row: indexAt(rowRuns, Math.max(0, y)) }
}
