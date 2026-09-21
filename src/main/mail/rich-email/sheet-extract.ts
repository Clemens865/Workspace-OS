import fs from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'

/**
 * Reads the USED area of a workbook's sheets, for "build me an email from this
 * file".
 *
 * `xlsx-range-reader.ts` already reads a block, but it needs a ref you already
 * know. Here nobody knows one yet: the point is to hand the model enough of the
 * sheet to decide what the email should say. So this walks the sheet's own
 * declared dimensions instead.
 *
 * Everything is capped. The grid ends up inside a prompt, and a workbook with
 * 200 columns and 40,000 rows would either blow the context or cost a fortune —
 * and would not make a better email than the first screenful does. Truncation is
 * REPORTED rather than silent, so the prompt can say so and the model does not
 * claim to have summarised a whole file it only saw the top of.
 *
 * Reading never modifies the file.
 */

export type Cell = string | number | null

export interface SheetExtract {
  name: string
  /** Rows/cols actually returned (after capping). */
  rows: number
  cols: number
  /** True when the sheet was larger than the caps allowed. */
  truncated: boolean
  /** Row-major values, first row usually the header. */
  grid: Cell[][]
}

export interface ExtractResult {
  ok: boolean
  fileName?: string
  sheets?: SheetExtract[]
  reason?: string
}

export const EXTRACT_LIMITS = {
  maxSheets: 5,
  maxRows: 60,
  maxCols: 15,
  /** Guards against a pathological file before ExcelJS parses it. */
  maxFileBytes: 40 * 1024 * 1024,
}

const fail = (reason: string): ExtractResult => ({ ok: false, reason })

/** Mirrors xlsx-range-reader's per-cell rules so both paths agree on "value". */
function cellValueOf(cell: ExcelJS.Cell): Cell {
  const v = cell.value
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') return v
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (cell.type === ExcelJS.ValueType.Formula) {
    const r = cell.result
    if (typeof r === 'number' && Number.isFinite(r)) return r
    if (typeof r === 'string') return r
  }
  // Rich text arrives as an object with a runs array; flatten rather than drop,
  // since a styled header is still a header.
  if (v && typeof v === 'object' && Array.isArray((v as { richText?: unknown[] }).richText)) {
    return (v as { richText: { text?: string }[] }).richText.map((t) => t.text ?? '').join('')
  }
  return null
}

/** Reads the used area of each sheet, capped. Never throws. */
export async function extractSheets(filePath: string): Promise<ExtractResult> {
  if (typeof filePath !== 'string' || !filePath) return fail('bad-path')
  if (path.extname(filePath).toLowerCase() !== '.xlsx') return fail('not-xlsx')

  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
  } catch {
    return fail('missing')
  }
  if (!stat.isFile()) return fail('not-a-file')
  if (stat.size > EXTRACT_LIMITS.maxFileBytes) return fail('too-large')

  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.readFile(filePath)
  } catch {
    return fail('unreadable')
  }

  const sheets: SheetExtract[] = []
  for (const ws of wb.worksheets.slice(0, EXTRACT_LIMITS.maxSheets)) {
    /**
     * `rowCount` is the INDEX of the last populated row; `actualRowCount` is how
     * many rows carry data. They differ the moment a sheet has a blank row in
     * the middle, and using the count as an index bound silently drops
     * everything past the gap — a sheet of a/blank/b returned only `a`, and an
     * email summarising it would have been quietly missing rows.
     *
     * So: iterate by INDEX to the last populated row, and stop once enough
     * non-empty rows have been collected.
     */
    const lastRow = Math.max(ws.rowCount ?? 0, ws.actualRowCount ?? 0)
    const lastCol = Math.max(ws.columnCount ?? 0, ws.actualColumnCount ?? 0)
    if (lastRow === 0 || lastCol === 0) continue

    const cols = Math.min(lastCol, EXTRACT_LIMITS.maxCols)
    // A sparse sheet could otherwise walk a hundred thousand blank rows to find
    // its cap; bound the scan as well as the yield.
    const scanLimit = Math.min(lastRow, EXTRACT_LIMITS.maxRows * 20)
    const grid: Cell[][] = []
    let scanned = 0
    for (let r = 1; r <= scanLimit && grid.length < EXTRACT_LIMITS.maxRows; r += 1) {
      const row = ws.getRow(r)
      const line: Cell[] = []
      for (let c = 1; c <= cols; c += 1) line.push(cellValueOf(row.getCell(c)))
      // A wholly empty row inside the used area carries nothing to the model.
      if (line.some((v) => v !== null && v !== '')) grid.push(line)
      scanned = r
    }
    if (grid.length === 0) continue

    sheets.push({
      name: ws.name,
      rows: grid.length,
      cols,
      truncated: scanned < lastRow || lastCol > cols,
      grid,
    })
  }

  if (sheets.length === 0) return fail('empty')
  return { ok: true, fileName: path.basename(filePath), sheets }
}

/**
 * Renders extracted sheets as delimited text for a prompt.
 *
 * Tab-delimited rather than JSON: it costs a fraction of the tokens for the same
 * information, and a model reads a grid more reliably when it looks like a grid.
 * Empty cells become an empty field so column positions stay aligned — losing
 * alignment is how a model attributes a number to the wrong column.
 */
export function sheetsToPromptText(sheets: SheetExtract[]): string {
  return sheets
    .map((s) => {
      const head = `## Sheet: ${s.name}${s.truncated ? '  (TRUNCATED — you are seeing only the first rows/columns)' : ''}`
      const body = s.grid.map((row) => row.map((c) => (c === null ? '' : String(c))).join('\t')).join('\n')
      return `${head}\n${body}`
    })
    .join('\n\n')
}
