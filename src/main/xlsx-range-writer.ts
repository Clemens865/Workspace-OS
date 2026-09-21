import fs from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import { parseA1 } from './transclusions'
import { coerceGrid, RANGE_MAX_COLS, RANGE_MAX_ROWS, type RangeGrid } from './ranges'

/**
 * Engine-free .xlsx BLOCK writer — the "closed-file" half of range sync-all
 * (mirror of xlsx-cell-writer.ts, grid-sized).
 *
 * The LibreOffice engine owns whichever file is currently OPEN; touching that
 * file on disk under it would desync the live view. For files that are NOT
 * open, we skip the engine and stamp the whole block (anchored at its top-left
 * cell) directly in the .xlsx via exceljs, which round-trips the WHOLE workbook
 * (every other sheet, cell, style and drawing is preserved). Numbers land as
 * numbers, texts as strings, empties clear the cell — the block mirrors the
 * range exactly, because a linked block is OWNED by its range.
 *
 * STRICT fail-safe — on ANY uncertainty we skip and report, never writing a
 * partial/corrupt file:
 *   - the file is missing / unreadable / not a valid .xlsx    → skip
 *   - the named sheet can't be resolved                        → skip
 *   - the anchor is malformed, or the block would exceed the
 *     supported range size                                     → skip
 *   - ANY cell in the target block holds a FORMULA             → skip
 *     (overwriting a formula could silently break a dependent
 *      calculation — not our call to make; the whole block is
 *      skipped so a partially-stamped grid can never exist)
 *   - the grid isn't a valid rectangular grid                  → skip
 *
 * Durability: we write to a temp file in the SAME directory, re-open it with
 * exceljs to prove it's still a valid workbook, then atomically rename it over
 * the original. A crash mid-write can therefore never truncate the real file.
 */

export interface RangeWriteResult {
  ok: boolean
  /** Machine-readable skip reason (present only when ok === false). */
  reason?: string
}

const skip = (reason: string): RangeWriteResult => ({ ok: false, reason })

/**
 * Stamps a grid of literals into a closed .xlsx block, safely. Never throws —
 * every failure path returns { ok:false, reason } and leaves the file untouched.
 */
export async function setRangeValues(
  filePath: string,
  sheetName: string,
  anchorCell: string,
  values: RangeGrid
): Promise<RangeWriteResult> {
  const grid = coerceGrid(values)
  if (!grid) return skip('bad-grid')
  const anchor = parseA1(anchorCell)
  if (!anchor) return skip('bad-cell')
  if (anchor.row + grid.length > 1048576 || anchor.col + grid[0].length > 16384) return skip('out-of-bounds')
  if (grid.length > RANGE_MAX_ROWS || grid[0].length > RANGE_MAX_COLS) return skip('bad-grid')
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

  // Pass 1 — verify: refuse the WHOLE block if any target cell holds a formula.
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const cell = ws.getCell(anchor.row + r + 1, anchor.col + c + 1)
      if (cell.type === ExcelJS.ValueType.Formula) return skip('cell-has-formula')
    }
  }

  // Pass 2 — stamp every cell (numbers as numbers, text as strings, null clears).
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      ws.getCell(anchor.row + r + 1, anchor.col + c + 1).value = grid[r][c]
    }
  }

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
