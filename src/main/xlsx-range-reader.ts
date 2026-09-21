import fs from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import { parseRangeRef, type RangeGrid, type RangeCell } from './ranges'

/**
 * Engine-free .xlsx range READER — the "source" half of source-linked ranges
 * (mirror of xlsx-cell-reader.ts, grid-sized). Reads a rectangular block of
 * values from the file ON DISK (disk is authoritative once saved).
 *
 * STRICT at the file/sheet/ref level, LENIENT per cell — reading NEVER modifies
 * the source, and on file-level uncertainty it returns { ok:false, reason } so
 * the range keeps its last good cached grid:
 *   - the file is missing / not a file / not .xlsx / not a valid workbook → fail
 *   - the named sheet can't be resolved                                   → fail
 *   - the ref is malformed or oversized                                   → fail
 * Per cell: a plain number reads as a number; text as a string; a formula as
 * its cached result (numeric or text); anything else (dates, rich text,
 * errors, empties) reads as null — the block mirrors what a person would see
 * as "value or empty".
 */

export interface RangeReadResult {
  ok: boolean
  /** The block's values, row-major (present only when ok === true). */
  values?: RangeGrid
  /** Machine-readable failure reason (present only when ok === false). */
  reason?: string
}

const fail = (reason: string): RangeReadResult => ({ ok: false, reason })

/** Maps one exceljs cell to a RangeCell (number | string | null). */
function cellValueOf(cell: ExcelJS.Cell): RangeCell {
  const v = cell.value
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') return v
  if (cell.type === ExcelJS.ValueType.Formula) {
    const r = cell.result
    if (typeof r === 'number' && Number.isFinite(r)) return r
    if (typeof r === 'string') return r
  }
  return null
}

/**
 * Reads a rectangular block from a closed .xlsx, safely. Never throws — every
 * failure path returns { ok:false, reason } and leaves the file untouched.
 */
export async function readRange(
  filePath: string,
  sheetName: string,
  ref: string
): Promise<RangeReadResult> {
  const r = parseRangeRef(ref)
  if (!r) return fail('bad-ref')
  if (typeof filePath !== 'string' || !filePath) return fail('bad-path')
  if (path.extname(filePath).toLowerCase() !== '.xlsx') return fail('not-xlsx')

  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
  } catch {
    return fail('missing')
  }
  if (!stat.isFile()) return fail('not-a-file')

  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.readFile(filePath)
  } catch {
    return fail('not-valid-xlsx')
  }

  // Resolve the sheet by name; fall back to the single sheet only if unambiguous.
  let ws = sheetName ? wb.getWorksheet(sheetName) : undefined
  if (!ws && !sheetName && wb.worksheets.length === 1) ws = wb.worksheets[0]
  if (!ws) return fail('sheet-not-found')

  const values: RangeGrid = []
  for (let row = 0; row < r.rows; row++) {
    const out: RangeCell[] = []
    for (let col = 0; col < r.cols; col++) {
      // exceljs is 1-based (row & col); parseRangeRef is 0-based.
      out.push(cellValueOf(ws.getCell(r.startRow + row + 1, r.startCol + col + 1)))
    }
    values.push(out)
  }
  return { ok: true, values }
}
