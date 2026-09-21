import fs from 'fs'
import path from 'path'
import JSZip from 'jszip'
import { coerceGrid, type RangeGrid } from './ranges'
import { cellText } from './docx-table-writer'

/**
 * Engine-free .pptx TABLE writer — the "closed-file" half of PowerPoint live
 * tables (the grid analogue of pptx-shape-writer, which writes a single scalar).
 * A whole LiveRange grid lives in one place and appears as a real slide table;
 * this writer updates that table's cell text on disk while the file is NOT open.
 *
 * A .pptx is a zip of XML. A slide table is an `<a:tbl>` inside a
 * `<p:graphicFrame>` whose `<p:cNvPr name="wos-range-…">` carries our tag (the
 * shape Name round-trips PowerPoint — the same anchor the scalar shape uses).
 * Across every `ppt/slides/slideN.xml` we find the graphicFrame named `tag`, then
 * replace ONLY the text of each `<a:tc>` cell (row-major) with the range's grid.
 * Every other slide, shape, run, style and relationship is preserved verbatim.
 *
 * STRICT fail-safe — on ANY uncertainty we skip and report, never writing a
 * partial/corrupt file:
 *   - missing / unreadable / not a .pptx / not a valid zip            → skip
 *   - no slides                                                       → skip
 *   - the tag isn't found on any slide, or is ambiguous (>1)          → skip
 *   - the named frame holds no `<a:tbl>`                              → skip
 *   - the table's shape (rows × cols) no longer matches the grid      → skip
 *   - the grid isn't a valid rectangular grid                         → skip
 *
 * Durability: temp file in the SAME dir → re-open + verify → atomic rename over
 * the original. A crash mid-write can therefore never truncate the real file.
 */

export interface PptxTableWriteResult {
  ok: boolean
  reason?: string
}

const skip = (reason: string): PptxTableWriteResult => ({ ok: false, reason })

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Result of the pure replace: the rewritten slide XML, or a machine-readable error. */
export type SlideTableReplaceResult = { xml: string } | { error: string }

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

/** Counts the graphicFrames on one slide whose `<p:cNvPr>` name equals `tag`. */
export function countNamedFrames(xml: string, tag: string): number {
  if (typeof xml !== 'string' || typeof tag !== 'string' || !tag) return 0
  // A named table frame is a <p:graphicFrame> containing a cNvPr with our name.
  const frames = [...xml.matchAll(/<p:graphicFrame\b[^>]*>/g)]
  let n = 0
  for (const fm of frames) {
    const end = matchBalanced(xml, fm.index as number, /<p:graphicFrame\b[^>]*>/g, '</p:graphicFrame>')
    if (end < 0) continue
    const block = xml.slice(fm.index as number, end)
    const nameRe = new RegExp(`<p:cNvPr\\b[^>]*\\bname="${escapeRe(tag)}"`)
    if (nameRe.test(block) && block.includes('<a:tbl>')) n++
  }
  return n
}

/**
 * PURE core: in one `ppt/slides/slideN.xml`, replace the cell text of the table
 * frame named `tag` with `grid` (row-major). Assumes the caller has verified this
 * slide holds EXACTLY ONE such frame. Returns the new XML or a machine-readable
 * error. No I/O — the fail-safe decision, unit-testable.
 */
export function replaceSlideTableCells(xml: string, tag: string, grid: RangeGrid): SlideTableReplaceResult {
  if (typeof tag !== 'string' || !tag) return { error: 'bad-tag' }
  if (typeof xml !== 'string' || !xml) return { error: 'bad-xml' }
  const g = coerceGrid(grid)
  if (!g) return { error: 'bad-grid' }

  // Find the graphicFrame whose cNvPr name is our tag.
  const nameRe = new RegExp(`<p:cNvPr\\b[^>]*\\bname="${escapeRe(tag)}"`, 'g')
  const nameMatches = [...xml.matchAll(nameRe)]
  if (nameMatches.length === 0) return { error: 'tag-not-found' }
  if (nameMatches.length > 1) return { error: 'tag-ambiguous' }
  const nameIdx = nameMatches[0].index as number

  const frameOpenRe = /<p:graphicFrame\b[^>]*>/g
  let frameStart = -1
  for (const m of xml.matchAll(frameOpenRe)) {
    const i = m.index as number
    if (i > nameIdx) break
    frameStart = i
  }
  if (frameStart < 0) return { error: 'frame-open-not-found' }
  const frameEnd = matchBalanced(xml, frameStart, /<p:graphicFrame\b[^>]*>/g, '</p:graphicFrame>')
  if (frameEnd < 0) return { error: 'frame-close-not-found' }

  const frame = xml.slice(frameStart, frameEnd)
  const tblStart = frame.indexOf('<a:tbl>')
  if (tblStart < 0) return { error: 'no-table' }
  const tblEnd = matchBalanced(frame, tblStart, /<a:tbl\b[^>]*>/g, '</a:tbl>')
  if (tblEnd < 0) return { error: 'table-close-not-found' }
  const table = frame.slice(tblStart, tblEnd)

  // Rows are <a:tr>; cells are <a:tc>. Grid columns come from the grid, not gridCol.
  const rows: { start: number; end: number }[] = []
  const rowOpenRe = /<a:tr\b[^>]*>/g
  for (let rm = rowOpenRe.exec(table); rm; rm = rowOpenRe.exec(table)) {
    const rEnd = matchBalanced(table, rm.index, /<a:tr\b[^>]*>/g, '</a:tr>')
    if (rEnd < 0) return { error: 'row-close-not-found' }
    rows.push({ start: rm.index, end: rEnd })
    rowOpenRe.lastIndex = rEnd
  }
  if (rows.length !== g.length) return { error: 'row-count-mismatch' }

  let outTable = ''
  let cursor = 0
  for (let r = 0; r < rows.length; r++) {
    outTable += table.slice(cursor, rows[r].start)
    const rowXml = table.slice(rows[r].start, rows[r].end)
    const rebuilt = replaceRowCells(rowXml, g[r])
    if ('error' in rebuilt) return rebuilt
    outTable += rebuilt.xml
    cursor = rows[r].end
  }
  outTable += table.slice(cursor)

  const newFrame = frame.slice(0, tblStart) + outTable + frame.slice(tblEnd)
  const newXml = xml.slice(0, frameStart) + newFrame + xml.slice(frameEnd)
  return { xml: newXml }
}

/** Replaces every cell's text in one `<a:tr>` with `values`; column-count-strict. */
function replaceRowCells(rowXml: string, values: RangeGrid[number]): SlideTableReplaceResult {
  const cells: { start: number; end: number }[] = []
  const cellOpenRe = /<a:tc\b[^>]*>/g
  for (let cm = cellOpenRe.exec(rowXml); cm; cm = cellOpenRe.exec(rowXml)) {
    const cEnd = matchBalanced(rowXml, cm.index, /<a:tc\b[^>]*>/g, '</a:tc>')
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
 * Replaces the text of ONE `<a:tc>`: rewrites its `<a:txBody>` first paragraph's
 * runs to a single run holding `text` (preserving that run's rPr, if any). The
 * cell always has a `<a:txBody>` with an `<a:p>`.
 */
function replaceCellText(cellXml: string, text: string): string {
  const bodyRe = /<a:txBody\b[^>]*>[\s\S]*?<\/a:txBody>/
  const bm = bodyRe.exec(cellXml)
  if (!bm) return cellXml // no text body — leave untouched (defensive)
  const body = bm[0]

  const pRe = /<a:p\b[^>]*>[\s\S]*?<\/a:p>/
  const pm = pRe.exec(body)
  if (!pm) return cellXml
  const para = pm[0]

  const rprMatch = /<a:rPr\b[^>]*\/>/.exec(para)
  const rpr = rprMatch ? rprMatch[0] : ''
  const pPrMatch = /<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>|<a:pPr\b[^>]*\/>/.exec(para)
  const pPr = pPrMatch ? pPrMatch[0] : ''
  const endParaMatch = /<a:endParaRPr\b[^>]*\/?>/.exec(para)
  const endPara = endParaMatch ? endParaMatch[0] : ''
  const run = `<a:r>${rpr}<a:t>${escapeXml(text)}</a:t></a:r>`
  const openMatch = /^<a:p\b[^>]*>/.exec(para)
  const open = openMatch ? openMatch[0] : '<a:p>'
  const newPara = `${open}${pPr}${run}${endPara}</a:p>`

  const newBody = body.replace(para, newPara)
  return cellXml.replace(body, newBody)
}

/** True for a `ppt/slides/slideN.xml` part path. */
const isSlidePart = (name: string): boolean => /^ppt\/slides\/slide\d+\.xml$/.test(name)

/**
 * Sets a tagged slide table's cells to a grid in a closed .pptx, safely. Never
 * throws — every failure path returns { ok:false, reason } and leaves the file
 * untouched.
 */
export async function setSlideTableCells(
  filePath: string,
  tag: string,
  grid: RangeGrid
): Promise<PptxTableWriteResult> {
  const g = coerceGrid(grid)
  if (!g) return skip('bad-grid')
  if (typeof tag !== 'string' || !tag) return skip('bad-tag')
  if (typeof filePath !== 'string' || !filePath) return skip('bad-path')
  if (path.extname(filePath).toLowerCase() !== '.pptx') return skip('not-pptx')

  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
  } catch {
    return skip('missing')
  }
  if (!stat.isFile()) return skip('not-a-file')

  let zip: JSZip
  const slides: { name: string; xml: string }[] = []
  try {
    const buf = fs.readFileSync(filePath)
    zip = await JSZip.loadAsync(buf)
    const parts = Object.keys(zip.files).filter(isSlidePart)
    for (const name of parts) {
      slides.push({ name, xml: await zip.file(name)!.async('string') })
    }
  } catch {
    return skip('not-valid-pptx')
  }
  if (slides.length === 0) return skip('no-slides')

  const total = slides.reduce((n, s) => n + countNamedFrames(s.xml, tag), 0)
  if (total === 0) return skip('tag-not-found')
  if (total > 1) return skip('tag-ambiguous')

  const target = slides.find((s) => countNamedFrames(s.xml, tag) === 1)!
  const res = replaceSlideTableCells(target.xml, tag, g)
  if ('error' in res) return skip(res.error)

  zip.file(target.name, res.xml)

  const dir = path.dirname(filePath)
  const tmp = path.join(dir, `.${path.basename(filePath)}.wos-${process.pid}-${Date.now()}.tmp`)
  try {
    const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    fs.writeFileSync(tmp, out)
    const verifyZip = await JSZip.loadAsync(fs.readFileSync(tmp))
    const vEntry = verifyZip.file(target.name)
    if (!vEntry) throw new Error('verify: slide missing')
    const vXml = await vEntry.async('string')
    if (!vXml.includes(`name="${tag}"`)) throw new Error('verify: tag lost')
    const first = escapeXml(cellText(g[0][0]))
    if (first && !vXml.includes(`<a:t>${first}</a:t>`)) throw new Error('verify: value not present')
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
