import fs from 'fs'
import path from 'path'
import os from 'os'
import ExcelJS from 'exceljs'
import { parseA1 } from './transclusions'

/**
 * Engine-free .xlsx cell writer — the "closed-file" half of sync-all.
 *
 * The LibreOffice engine owns whichever file is currently OPEN; touching that
 * file on disk under it would desync the live view. For files that are NOT open,
 * we skip the engine entirely and set the one target cell directly in the .xlsx
 * via exceljs, which round-trips the WHOLE workbook (every other sheet, cell,
 * style and drawing is preserved). Only a plain NUMERIC literal is ever written,
 * and only to the exact resolved cell.
 *
 * STRICT fail-safe — on ANY uncertainty we skip and report, never writing a
 * partial/corrupt file:
 *   - the file is missing / unreadable / not a valid .xlsx        → skip
 *   - the named sheet can't be resolved                            → skip
 *   - the A1 address is malformed                                  → skip
 *   - the target cell holds a FORMULA or a shared/rich string      → skip
 *     (overwriting those with a bare number could silently break a
 *      dependent calculation or lose text — not our call to make)
 *   - the value isn't a finite number                              → skip
 *
 * Durability: we write to a temp file in the SAME directory, re-open it with
 * exceljs to prove it's still a valid workbook, then atomically rename it over
 * the original. A crash mid-write can therefore never truncate the real file.
 */

export interface CellWriteResult {
  ok: boolean
  /** Machine-readable skip reason (present only when ok === false). */
  reason?: string
}

const skip = (reason: string): CellWriteResult => ({ ok: false, reason })

/**
 * Sets one cell to a numeric literal in a closed .xlsx, safely. Never throws —
 * every failure path returns { ok:false, reason } and leaves the file untouched.
 */
export async function setCellValue(
  filePath: string,
  sheetName: string,
  cellA1: string,
  value: number
): Promise<CellWriteResult> {
  if (typeof value !== 'number' || !Number.isFinite(value)) return skip('value-not-finite')
  const addr = parseA1(cellA1)
  if (!addr) return skip('bad-cell')
  if (typeof filePath !== 'string' || !filePath) return skip('bad-path')
  if (path.extname(filePath).toLowerCase() !== '.xlsx') return skip('not-xlsx')

  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
  } catch {
    return skip('missing')
  }
  if (!stat.isFile()) return skip('not-a-file')

  // Read the whole workbook. exceljs throws on anything that isn't a real xlsx.
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.readFile(filePath)
  } catch {
    return skip('not-valid-xlsx')
  }

  // Resolve the sheet by name; fall back to the single sheet only if unambiguous.
  let ws = sheetName ? wb.getWorksheet(sheetName) : undefined
  if (!ws && !sheetName && wb.worksheets.length === 1) ws = wb.worksheets[0]
  if (!ws) return skip('sheet-not-found')

  // exceljs is 1-based (row & col); parseA1 is 0-based.
  const cell = ws.getCell(addr.row + 1, addr.col + 1)

  // Refuse to clobber a formula or a string — those aren't a plain number and
  // overwriting them could break a calc or destroy text. Skip-and-report.
  const t = cell.type
  if (t === ExcelJS.ValueType.Formula) return skip('cell-has-formula')
  if (t === ExcelJS.ValueType.String || t === ExcelJS.ValueType.RichText) return skip('cell-has-text')

  cell.value = value

  // Atomic, verified replace: temp → re-open (verify) → rename over original.
  const dir = path.dirname(filePath)
  const tmp = path.join(dir, `.${path.basename(filePath)}.wos-${process.pid}-${Date.now()}.tmp`)
  try {
    await wb.xlsx.writeFile(tmp)
    // Verify the temp re-opens as a valid workbook BEFORE we replace the real one.
    const verify = new ExcelJS.Workbook()
    await verify.xlsx.readFile(tmp)
    fs.renameSync(tmp, filePath) // atomic within the same filesystem
    return { ok: true }
  } catch {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    } catch {
      /* best-effort cleanup */
    }
    return skip('write-failed')
  }
}

/** True when a temp dir is writable — used only by tests/diagnostics. */
export function tmpDir(): string {
  return os.tmpdir()
}
