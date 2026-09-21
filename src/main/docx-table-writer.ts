import fs from 'fs'
import path from 'path'
import JSZip from 'jszip'
import { coerceGrid, type RangeGrid } from './ranges'

/**
 * Engine-free .docx TABLE writer — the "closed-file" half of Word live tables
 * (the grid analogue of docx-cc-writer, which writes a single scalar). A whole
 * LiveRange grid lives in one place and appears as a real Word table; this writer
 * updates that table's cell text on disk while the file is NOT open in the engine.
 *
 * A .docx is a zip of XML. LibreOffice writes a named Writer TextTable with a
 * bookmark carrying our tag (`<w:bookmarkStart w:name="wos-range-…"/>` — see
 * WosInsertDocTable): the bookmark round-trips MS Word and is the stable, locatable
 * anchor. LibreOffice emits the bookmark IMMEDIATELY AFTER the table it wraps (a
 * table can't itself carry a bookmark), so we find that bookmark, take the table
 * NEAREST to it (the one that closes just before it, else the first that opens
 * after), and replace ONLY the text of each cell (row-major) with the range's grid.
 * Every other part, run, style, column and relationship is preserved verbatim.
 *
 * STRICT fail-safe — on ANY uncertainty we skip and report, never writing a
 * partial/corrupt file:
 *   - missing / unreadable / not a .docx / not a valid zip            → skip
 *   - word/document.xml absent                                        → skip
 *   - the tag bookmark isn't found, or is ambiguous (>1)              → skip
 *   - no `<w:tbl>` follows the bookmark                               → skip
 *   - the table's shape (rows × cols) no longer matches the grid      → skip
 *     (a user added/removed a row or column — not our call to reshape)
 *   - the grid isn't a valid rectangular grid                         → skip
 *
 * Durability: temp file in the SAME dir → re-open + verify → atomic rename over
 * the original. A crash mid-write can therefore never truncate the real file.
 */

export interface DocxTableWriteResult {
  ok: boolean
  reason?: string
}

const skip = (reason: string): DocxTableWriteResult => ({ ok: false, reason })

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** One grid cell → the display string Word shows (empties render blank). */
export function cellText(cell: RangeGrid[number][number]): string {
  if (cell === null || cell === undefined) return ''
  return String(cell)
}

/** Result of the pure replace: the rewritten XML, or a machine-readable error. */
export type TableReplaceResult = { xml: string } | { error: string }

/** Depth-matches a balanced open/close pair starting at `start` (an open token). */
function matchBalanced(xml: string, start: number, openRe: RegExp, close: string): number {
  const tokenRe = new RegExp(`${openRe.source}|${escapeRe(close)}`, 'g')
  tokenRe.lastIndex = start
  let depth = 0
  for (let m = tokenRe.exec(xml); m; m = tokenRe.exec(xml)) {
    if (m[0] === close) {
      depth--
      if (depth === 0) return m.index + m[0].length
    } else {
      depth++
    }
  }
  return -1
}

/**
 * PURE core: in a word/document.xml string, replace the cell text of the table
 * anchored by the bookmark named `tag` with `grid` (row-major). Returns the new
 * XML or a machine-readable error. No I/O — the fail-safe decision, unit-testable.
 */
export function replaceTableCells(xml: string, tag: string, grid: RangeGrid): TableReplaceResult {
  if (typeof tag !== 'string' || !tag) return { error: 'bad-tag' }
  if (typeof xml !== 'string' || !xml) return { error: 'bad-xml' }
  const g = coerceGrid(grid)
  if (!g) return { error: 'bad-grid' }

  // Locate the anchoring bookmark (lenient on attribute spacing/order).
  const bmRe = new RegExp(`<w:bookmarkStart\\b[^>]*\\bw:name="${escapeRe(tag)}"[^>]*/?>`, 'g')
  const bms = [...xml.matchAll(bmRe)]
  if (bms.length === 0) return { error: 'tag-not-found' }
  if (bms.length > 1) return { error: 'tag-ambiguous' }
  const bmIdx = bms[0].index as number

  // The table NEAREST the bookmark. LibreOffice puts the bookmark right after the
  // table, so prefer the table that CLOSES just before the bookmark; if none
  // precedes it, take the first that OPENS after (tolerates either ordering).
  let tblStart = -1
  const openRe = /<w:tbl\b[^>]*>/g
  const opens: number[] = []
  for (let m = openRe.exec(xml); m; m = openRe.exec(xml)) opens.push(m.index)
  // Nearest preceding table whose close is before the bookmark.
  let bestBefore = -1
  for (const start of opens) {
    if (start >= bmIdx) break
    const end = matchBalanced(xml, start, /<w:tbl\b[^>]*>/g, '</w:tbl>')
    if (end >= 0 && end <= bmIdx) bestBefore = start
  }
  if (bestBefore >= 0) tblStart = bestBefore
  else tblStart = opens.find((s) => s >= bmIdx) ?? -1
  if (tblStart < 0) return { error: 'table-not-found' }
  const tblEnd = matchBalanced(xml, tblStart, /<w:tbl\b[^>]*>/g, '</w:tbl>')
  if (tblEnd < 0) return { error: 'table-close-not-found' }

  const table = xml.slice(tblStart, tblEnd)

  // Split the table into its rows (depth-matched so nested tables can't fool us).
  const rows: { start: number; end: number }[] = []
  const rowOpenRe = /<w:tr\b[^>]*>/g
  for (let rm = rowOpenRe.exec(table); rm; rm = rowOpenRe.exec(table)) {
    const rEnd = matchBalanced(table, rm.index, /<w:tr\b[^>]*>/g, '</w:tr>')
    if (rEnd < 0) return { error: 'row-close-not-found' }
    rows.push({ start: rm.index, end: rEnd })
    rowOpenRe.lastIndex = rEnd
  }
  if (rows.length !== g.length) return { error: 'row-count-mismatch' }

  // Rebuild each row, replacing every cell's text. Refuse on a column mismatch.
  let out = ''
  let cursor = 0
  for (let r = 0; r < rows.length; r++) {
    out += table.slice(cursor, rows[r].start)
    const rowXml = table.slice(rows[r].start, rows[r].end)
    const rebuilt = replaceRowCells(rowXml, g[r])
    if ('error' in rebuilt) return rebuilt
    out += rebuilt.xml
    cursor = rows[r].end
  }
  out += table.slice(cursor)

  const newXml = xml.slice(0, tblStart) + out + xml.slice(tblEnd)
  return { xml: newXml }
}

/** Replaces every cell's text in one `<w:tr>` with `values`; column-count-strict. */
function replaceRowCells(rowXml: string, values: RangeGrid[number]): TableReplaceResult {
  const cells: { start: number; end: number }[] = []
  const cellOpenRe = /<w:tc\b[^>]*>/g
  for (let cm = cellOpenRe.exec(rowXml); cm; cm = cellOpenRe.exec(rowXml)) {
    const cEnd = matchBalanced(rowXml, cm.index, /<w:tc\b[^>]*>/g, '</w:tc>')
    if (cEnd < 0) return { error: 'cell-close-not-found' }
    cells.push({ start: cm.index, end: cEnd })
    cellOpenRe.lastIndex = cEnd
  }
  if (cells.length !== values.length) return { error: 'col-count-mismatch' }

  let out = ''
  let cursor = 0
  for (let c = 0; c < cells.length; c++) {
    out += rowXml.slice(cursor, cells[c].start)
    const cellXml = rowXml.slice(cells[c].start, cells[c].end)
    out += replaceCellText(cellXml, cellText(values[c]))
    cursor = cells[c].end
  }
  out += rowXml.slice(cursor)
  return { xml: out }
}

/**
 * Replaces the text of ONE `<w:tc>`: rewrites its first paragraph's runs to a
 * single run holding `text` (preserving that run's rPr, if any). A cell always
 * has a `<w:p>`; if it holds no run yet, we insert one after the paragraph's
 * (optional) pPr.
 */
function replaceCellText(cellXml: string, text: string): string {
  const pRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/
  const pm = pRe.exec(cellXml)
  if (!pm) return cellXml // no paragraph — leave the cell untouched (defensive)
  const para = pm[0]

  const rprMatch = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(para)
  const rpr = rprMatch ? rprMatch[0] : ''
  const run = `<w:r>${rpr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`

  // Keep the paragraph's own pPr; drop every existing run and replace with ours.
  const pPrMatch = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(para)
  const pPr = pPrMatch ? pPrMatch[0] : ''
  const openMatch = /^<w:p\b[^>]*>/.exec(para)
  const open = openMatch ? openMatch[0] : '<w:p>'
  const newPara = `${open}${pPr}${run}</w:p>`

  return cellXml.replace(para, newPara)
}

/**
 * Sets a tagged Word table's cells to a grid in a closed .docx, safely. Never
 * throws — every failure path returns { ok:false, reason } and leaves the file
 * untouched.
 */
export async function setDocTableCells(
  filePath: string,
  tag: string,
  grid: RangeGrid
): Promise<DocxTableWriteResult> {
  const g = coerceGrid(grid)
  if (!g) return skip('bad-grid')
  if (typeof tag !== 'string' || !tag) return skip('bad-tag')
  if (typeof filePath !== 'string' || !filePath) return skip('bad-path')
  if (path.extname(filePath).toLowerCase() !== '.docx') return skip('not-docx')

  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
  } catch {
    return skip('missing')
  }
  if (!stat.isFile()) return skip('not-a-file')

  let zip: JSZip
  let docXml: string
  try {
    const buf = fs.readFileSync(filePath)
    zip = await JSZip.loadAsync(buf)
    const entry = zip.file('word/document.xml')
    if (!entry) return skip('no-document-xml')
    docXml = await entry.async('string')
  } catch {
    return skip('not-valid-docx')
  }

  const res = replaceTableCells(docXml, tag, g)
  if ('error' in res) return skip(res.error)

  zip.file('word/document.xml', res.xml)

  const dir = path.dirname(filePath)
  const tmp = path.join(dir, `.${path.basename(filePath)}.wos-${process.pid}-${Date.now()}.tmp`)
  try {
    const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    fs.writeFileSync(tmp, out)
    const verifyZip = await JSZip.loadAsync(fs.readFileSync(tmp))
    const vEntry = verifyZip.file('word/document.xml')
    if (!vEntry) throw new Error('verify: no document.xml')
    const vXml = await vEntry.async('string')
    // The bookmark must survive and the first grid cell's text must be present.
    if (!vXml.includes(`w:name="${tag}"`)) throw new Error('verify: tag lost')
    const first = escapeXml(cellText(g[0][0]))
    if (first && !vXml.includes(`>${first}<`)) throw new Error('verify: value not present')
    fs.renameSync(tmp, filePath)
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
