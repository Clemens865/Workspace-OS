/**
 * Table geometry from LOK_CALLBACK_TABLE_SELECTED.
 *
 * Writer (crsrsh.cxx) and Impress/Draw (svdotable.cxx) both send the same
 * shape: for each axis, the table's offset on the page, the outer edges
 * (`left`/`right`) and the inner edges (`entries[].position`), all in twips
 * relative to that offset. Nothing in it says which cell is active — but
 * together with the point the user clicked, the cell is a plain lookup. That
 * lookup is what lets a slide-table operation act on the row and column under
 * the pointer instead of the last one (the headless view cursor is unreachable
 * from the model API; see WosSlideTableOp).
 */

export interface TableAxis {
  offset: number
  left: number
  right: number
  /** Inner edge positions, ascending, relative to `offset`. */
  inner: number[]
}

export interface TableGeometry {
  columns: TableAxis
  rows: TableAxis
}

function axis(raw: unknown): TableAxis | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v))
  const offset = num(o.tableOffset), left = num(o.left), right = num(o.right)
  if ([offset, left, right].some((n) => Number.isNaN(n))) return null
  const inner = Array.isArray(o.entries)
    ? o.entries.map((e) => num((e as Record<string, unknown>)?.position)).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b)
    : []
  return { offset, left, right, inner }
}

/** Parse the payload; null for `{}` (no table selected) or anything malformed. */
export function parseTableSelected(payload: string): TableGeometry | null {
  try {
    const o = JSON.parse(payload) as Record<string, unknown>
    const columns = axis(o.columns), rows = axis(o.rows)
    if (!columns || !rows) return null
    return { columns, rows }
  } catch {
    return null
  }
}

/** 0-based index of the band (row or column) containing a page coordinate, or null when outside the table. */
function bandAt(a: TableAxis, p: number): number | null {
  const rel = p - a.offset
  if (rel < a.left || rel > a.right) return null
  let i = 0
  for (const edge of a.inner) { if (rel >= edge) i++; else break }
  return i
}

/** The cell under a page point (twips), or null when the point is not on the table. */
export function cellAtPoint(g: TableGeometry, x: number, y: number): { row: number; col: number } | null {
  const col = bandAt(g.columns, x)
  const row = bandAt(g.rows, y)
  if (col === null || row === null) return null
  return { row, col }
}
