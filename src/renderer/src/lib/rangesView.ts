/**
 * Pure helpers for live ranges in the renderer (no React, no DOM) — the
 * range-sized sibling of linksView.ts. A1/ref parsing mirrors
 * src/main/ranges.ts (the renderer can't import main-process code), the
 * overlap guard mirrors rangeLinks.ts. Kept side-effect-free so it's
 * unit-testable and shared by hook + panel.
 */
import type { RangeGrid, RangeLink, RangeSource } from '../types/workspace-api'

const A1_RE = /^([A-Za-z]{1,3})([1-9][0-9]{0,6})$/

/** Parses an A1 address → 0-based { col, row }, or null if malformed. */
export function parseA1(cell: string): { col: number; row: number } | null {
  const m = A1_RE.exec(typeof cell === 'string' ? cell.trim() : '')
  if (!m) return null
  let col = 0
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { col: col - 1, row: parseInt(m[2], 10) - 1 }
}

/** Parses "A1:C4" (or a single cell) → 0-based bounds, or null if malformed. */
export function parseRangeRef(
  ref: string
): { startCol: number; startRow: number; rows: number; cols: number } | null {
  if (typeof ref !== 'string') return null
  const parts = ref.trim().split(':')
  if (parts.length < 1 || parts.length > 2) return null
  const a = parseA1(parts[0])
  const b = parts.length === 2 ? parseA1(parts[1]) : a
  if (!a || !b) return null
  return {
    startCol: Math.min(a.col, b.col),
    startRow: Math.min(a.row, b.row),
    rows: Math.abs(a.row - b.row) + 1,
    cols: Math.abs(a.col - b.col) + 1,
  }
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
 * True when writing `grid` at the link's anchor would OVERLAP the range's own
 * source rectangle (same file + sheet) — the self-reference/write-loop guard.
 * Mirrors isSelfSourceRangeLink in src/main/rangeLinks.ts.
 */
export function blockOverlapsSource(
  source: RangeSource | undefined,
  linkFilePath: string,
  target: { sheet: string; cell: string },
  grid: RangeGrid
): boolean {
  if (!source || source.kind !== 'xlsx-range') return false
  if (source.filePath !== linkFilePath || source.sheet !== target.sheet) return false
  const src = parseRangeRef(source.ref)
  const anchor = parseA1(target.cell)
  if (!src || !anchor) return false
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  const aR = anchor.col + cols - 1
  const aB = anchor.row + rows - 1
  const sR = src.startCol + src.cols - 1
  const sB = src.startRow + src.rows - 1
  return anchor.col <= sR && src.startCol <= aR && anchor.row <= sB && src.startRow <= aB
}

/** "3×2" label for a grid. */
export function dimsLabel(grid: RangeGrid): string {
  return `${grid.length}×${grid[0]?.length ?? 0}`
}

/** A legible location for one link's anchor ("Sheet1!E2 (3×2)" / a table). */
export function humanBlockLocation(link: RangeLink): string {
  const t = link.target
  const dims = dimsLabel(link.lastValues)
  if (t.kind === 'xlsx-block') return `${t.sheet ? `${t.sheet}!` : ''}${t.cell} (${dims})`
  if (t.kind === 'pptx-table') return `Slide table (${dims})`
  return `Word table (${dims})`
}

/** How many links each range has, keyed by rangeId. */
export function countByRange(links: RangeLink[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const link of links) counts.set(link.rangeId, (counts.get(link.rangeId) ?? 0) + 1)
  return counts
}
