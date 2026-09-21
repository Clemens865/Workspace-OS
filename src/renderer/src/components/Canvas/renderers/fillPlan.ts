/**
 * The Calc fill handle — the small square at the corner of the selection that
 * every spreadsheet user drags to continue a series.
 *
 * The drag is ours (an overlay); the fill is the engine's: on release the
 * source range plus the dragged extent go to `WosFill`, which calls
 * `fillAuto` on the union with the fill direction and the source count, so a
 * two-value series extends exactly as in Calc's own handle.
 */
import { toA1 } from '../../../lib/calcCellRect'

export interface CellSpan {
  col: number
  row: number
  cols: number
  rows: number
}

/** com.sun.star.sheet.FillDirection */
export const FILL_DIR = { TO_BOTTOM: 0, TO_RIGHT: 1, TO_TOP: 2, TO_LEFT: 3 } as const

export interface FillPlan {
  /** Union of source and target, A1:B9 form — what fillAuto runs on. */
  range: string
  dir: number
  /** Rows (vertical) or columns (horizontal) of the source inside the union. */
  count: number
  /** The union as a span, for the drag overlay. */
  span: CellSpan
}

/**
 * Decide the fill from the source selection and the cell the pointer is over.
 * The dominant axis of the drag wins; a target inside the source is a no-op
 * (null), as is a target on neither axis extension.
 */
export function planFill(src: CellSpan, target: { col: number; row: number }): FillPlan | null {
  const right = src.col + src.cols - 1
  const bottom = src.row + src.rows - 1
  const dxRight = target.col - right, dxLeft = src.col - target.col
  const dyDown = target.row - bottom, dyUp = src.row - target.row
  const vertical = Math.max(dyDown, dyUp), horizontal = Math.max(dxRight, dxLeft)
  if (vertical <= 0 && horizontal <= 0) return null
  if (vertical >= horizontal) {
    if (dyDown > 0) {
      const span = { col: src.col, row: src.row, cols: src.cols, rows: src.rows + dyDown }
      return { range: spanA1(span), dir: FILL_DIR.TO_BOTTOM, count: src.rows, span }
    }
    const span = { col: src.col, row: target.row, cols: src.cols, rows: src.rows + dyUp }
    return { range: spanA1(span), dir: FILL_DIR.TO_TOP, count: src.rows, span }
  }
  if (dxRight > 0) {
    const span = { col: src.col, row: src.row, cols: src.cols + dxRight, rows: src.rows }
    return { range: spanA1(span), dir: FILL_DIR.TO_RIGHT, count: src.cols, span }
  }
  const span = { col: target.col, row: src.row, cols: src.cols + dxLeft, rows: src.rows }
  return { range: spanA1(span), dir: FILL_DIR.TO_LEFT, count: src.cols, span }
}

export function spanA1(s: CellSpan): string {
  return `${toA1(s.col, s.row)}:${toA1(s.col + s.cols - 1, s.row + s.rows - 1)}`
}
