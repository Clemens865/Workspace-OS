import fs from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import { parseA1 } from './transclusions'

/**
 * Engine-free .xlsx cell READER — the "source" half of source-linked metrics
 * (mirror of xlsx-cell-writer.ts). Reads the NUMERIC value of one cell from the
 * file ON DISK (disk is authoritative once saved). It is the value's origin: a
 * metric that is source-linked to a cell caches whatever this returns.
 *
 * STRICT + fail-safe — reading NEVER modifies the source, and on ANY uncertainty
 * it returns { ok:false, reason } instead of guessing (so the metric keeps its
 * last good cached value and the whole chain degrades to a literal):
 *   - the file is missing / not a file / not .xlsx / not a valid workbook → fail
 *   - the named sheet can't be resolved                                   → fail
 *   - the A1 address is malformed                                         → fail
 *   - the cell is empty, text, or a formula with no numeric result        → fail
 * A plain numeric cell yields its number; a formula cell yields its cached
 * numeric result (e.g. a revenue = SUM(...) cell reads as the computed total).
 */

export interface CellReadResult {
  ok: boolean
  /** The cell's numeric value (present only when ok === true). */
  value?: number
  /** Machine-readable failure reason (present only when ok === false). */
  reason?: string
}

const fail = (reason: string): CellReadResult => ({ ok: false, reason })

/**
 * Reads one numeric cell from a closed .xlsx, safely. Never throws — every
 * failure path returns { ok:false, reason } and leaves the file untouched.
 */
export async function readCell(
  filePath: string,
  sheetName: string,
  cellA1: string
): Promise<CellReadResult> {
  const addr = parseA1(cellA1)
  if (!addr) return fail('bad-cell')
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

  // exceljs is 1-based (row & col); parseA1 is 0-based.
  const cell = ws.getCell(addr.row + 1, addr.col + 1)

  // A plain number is the value directly.
  const v = cell.value
  if (typeof v === 'number' && Number.isFinite(v)) return { ok: true, value: v }
  // A formula cell carries its last computed result — use it if numeric.
  if (cell.type === ExcelJS.ValueType.Formula) {
    const r = cell.result
    if (typeof r === 'number' && Number.isFinite(r)) return { ok: true, value: r }
  }
  return fail('cell-not-numeric')
}
