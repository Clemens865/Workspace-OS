import fs from 'fs'
import path from 'path'
import JSZip from 'jszip'
import { recordCell, type CollectionRecord } from './collections'

/**
 * Engine-free .docx CARD/DIRECTORY writer — the repeated-formatted-block analogue
 * of docx-table-writer. Where the table writer stamps a `<w:tbl>` grid, this
 * writer stamps a DIRECTORY: one rendered BLOCK of `<w:p>` paragraphs per record
 * (e.g. a bold "{Name} — {Title}" line + a "{Email}" line), replacing whatever
 * sits BETWEEN a bookmark PAIR.
 *
 * A .docx is a zip of XML. Unlike the single-table anchor, a directory needs a
 * REGION — so the app seeds a PAIR of bookmarks around an (initially empty) span:
 *   `<w:bookmarkStart w:name="wos-cards-<tag>-start"/> … <w:bookmarkStart w:name="wos-cards-<tag>-end"/>`
 * These round-trip MS Word and are the stable, locatable region delimiters. We
 * find both, then REPLACE everything between the start bookmark's close and the
 * end bookmark's open with the rendered record blocks. Every other part, run,
 * style and relationship is preserved verbatim.
 *
 * NOTE (app requirement): the insert gesture must seed BOTH bookmarks
 * `wos-cards-<tag>-start` and `wos-cards-<tag>-end` (the LOK insert macro; see the
 * table anchor's WosInsertDocTable sibling). Absent either → we skip (fail-safe),
 * never inventing a region.
 *
 * STRICT fail-safe — on ANY uncertainty we skip and report, never a partial write:
 *   - missing / unreadable / not a .docx / not a valid zip            → skip
 *   - word/document.xml absent                                        → skip
 *   - either bookmark of the pair isn't found, or is ambiguous (>1)   → skip
 *   - the start bookmark is at/after the end bookmark                 → skip
 *   - the template is malformed (no lines / no renderable segments)   → skip
 *
 * Durability: temp file in the SAME dir → re-open + verify → atomic rename over
 * the original. A crash mid-write can therefore never truncate the real file.
 */

export interface DocxCardsWriteResult {
  ok: boolean
  reason?: string
}

/** One inline segment of a card line: a record field, or a literal string. */
export interface CardSegment {
  /** A collection field name — its value is rendered (missing → empty). */
  field?: string
  /** A literal string rendered verbatim (e.g. " — "). */
  literal?: string
  /** Render this segment's run bold. */
  bold?: boolean
}

/** One line of a card = one `<w:p>` built from ordered segments. */
export interface CardLine {
  segments: CardSegment[]
}

/** The card render model: N lines, each a paragraph of inline segments. */
export interface CardTemplate {
  lines: CardLine[]
}

const skip = (reason: string): DocxCardsWriteResult => ({ ok: false, reason })

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The bookmark names delimiting a directory region for `tag`. */
export const cardsStartName = (tag: string): string => `wos-cards-${tag}-start`
export const cardsEndName = (tag: string): string => `wos-cards-${tag}-end`

/**
 * Coerces an untrusted template into a strict CardTemplate, or null when nothing
 * renderable remains. STRICT at the boundary: a line needs ≥1 segment, and a
 * segment needs a non-empty `field` OR a `literal` string (bold coerced to bool).
 * Field/literal strings are capped defensively. Never throws.
 */
export function coerceCardTemplate(raw: unknown): CardTemplate | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { lines?: unknown }
  if (!Array.isArray(r.lines)) return null
  const lines: CardLine[] = []
  for (const ln of r.lines.slice(0, 12)) {
    const l = ln as { segments?: unknown }
    if (!Array.isArray(l?.segments)) continue
    const segments: CardSegment[] = []
    for (const sg of l.segments.slice(0, 24)) {
      const s = sg as { field?: unknown; literal?: unknown; bold?: unknown }
      const seg: CardSegment = {}
      if (typeof s?.field === 'string' && s.field) seg.field = s.field.slice(0, 120)
      else if (typeof s?.literal === 'string') seg.literal = s.literal.slice(0, 500)
      else continue
      if (s?.bold === true) seg.bold = true
      segments.push(seg)
    }
    if (segments.length) lines.push({ segments })
  }
  return lines.length ? { lines } : null
}

/** The text a segment contributes for one record (field lookup or literal). */
function segmentText(seg: CardSegment, rec: CollectionRecord): string {
  if (seg.field !== undefined) {
    const v = recordCell(rec, seg.field)
    return v === null || v === undefined ? '' : String(v)
  }
  return seg.literal ?? ''
}

/** One `<w:r>` run for a segment (bold via `<w:rPr><w:b/></w:rPr>`). */
function segmentRun(seg: CardSegment, rec: CollectionRecord): string {
  const rpr = seg.bold ? '<w:rPr><w:b/></w:rPr>' : ''
  return `<w:r>${rpr}<w:t xml:space="preserve">${escapeXml(segmentText(seg, rec))}</w:t></w:r>`
}

/** One `<w:p>` paragraph from a line's segments for one record. */
function lineParagraph(line: CardLine, rec: CollectionRecord): string {
  return `<w:p>${line.segments.map((s) => segmentRun(s, rec)).join('')}</w:p>`
}

/**
 * PURE core: renders `records` through `template` into a run of `<w:p>`
 * paragraphs — one BLOCK (template.lines.length paragraphs) per record, in order,
 * concatenated. Empty records → '' (an empty region; the surrounding doc keeps
 * its shape). Unit-testable, no I/O.
 */
export function renderCards(records: CollectionRecord[], template: CardTemplate): string {
  if (!template || !Array.isArray(template.lines) || template.lines.length === 0) return ''
  let out = ''
  for (const rec of records) {
    for (const line of template.lines) out += lineParagraph(line, rec)
  }
  return out
}

/** Result of the pure region replace: the rewritten XML, or a machine error. */
export type CardsReplaceResult = { xml: string } | { error: string }

/** Locates the single bookmarkStart named `name`; encodes not-found/ambiguous. */
function findBookmark(xml: string, name: string): { start: number; end: number } | { error: string } {
  const re = new RegExp(`<w:bookmarkStart\\b[^>]*\\bw:name="${escapeRe(name)}"[^>]*/?>`, 'g')
  const ms = [...xml.matchAll(re)]
  if (ms.length === 0) return { error: 'anchor-not-found' }
  if (ms.length > 1) return { error: 'anchor-ambiguous' }
  const start = ms[0].index as number
  return { start, end: start + ms[0][0].length }
}

/**
 * PURE core: in a word/document.xml string, replace the span BETWEEN the
 * start/end bookmark pair for `tag` with the rendered card blocks. Returns the
 * new XML or a machine-readable error. No I/O — the fail-safe decision,
 * unit-testable.
 */
export function replaceCardsRegion(
  xml: string,
  tag: string,
  records: CollectionRecord[],
  template: CardTemplate
): CardsReplaceResult {
  if (typeof tag !== 'string' || !tag) return { error: 'bad-tag' }
  if (typeof xml !== 'string' || !xml) return { error: 'bad-xml' }
  if (!template || !Array.isArray(template.lines) || template.lines.length === 0) {
    return { error: 'bad-template' }
  }

  const startBm = findBookmark(xml, cardsStartName(tag))
  if ('error' in startBm) return startBm
  const endBm = findBookmark(xml, cardsEndName(tag))
  if ('error' in endBm) return endBm

  // The start bookmark must precede the end bookmark; the replaced span is
  // everything AFTER the start bookmark's tag and BEFORE the end bookmark's tag
  // (each bookmarkStart is preserved verbatim so the region survives a re-sync).
  if (startBm.end > endBm.start) return { error: 'anchor-order' }

  const rendered = renderCards(records, template)
  const newXml = xml.slice(0, startBm.end) + rendered + xml.slice(endBm.start)
  return { xml: newXml }
}

/**
 * Writes a tagged Word directory region to a rendered card layout in a closed
 * .docx, safely. Never throws — every failure path returns { ok:false, reason }
 * and leaves the file untouched. Mirrors setDocTableCells' atomic discipline.
 */
export async function setDocCards(
  filePath: string,
  tag: string,
  records: CollectionRecord[],
  template: CardTemplate
): Promise<DocxCardsWriteResult> {
  if (typeof tag !== 'string' || !tag) return skip('bad-tag')
  if (typeof filePath !== 'string' || !filePath) return skip('bad-path')
  if (path.extname(filePath).toLowerCase() !== '.docx') return skip('not-docx')
  if (!template || !Array.isArray(template.lines) || template.lines.length === 0) {
    return skip('bad-template')
  }
  const recs = Array.isArray(records) ? records : []

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

  const res = replaceCardsRegion(docXml, tag, recs, template)
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
    // Both anchors must survive so the region stays re-syncable.
    if (!vXml.includes(`w:name="${cardsStartName(tag)}"`)) throw new Error('verify: start lost')
    if (!vXml.includes(`w:name="${cardsEndName(tag)}"`)) throw new Error('verify: end lost')
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
