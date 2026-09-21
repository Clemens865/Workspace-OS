import fs from 'fs'
import path from 'path'
import JSZip from 'jszip'

/**
 * Engine-free .docx content-control writer — the "closed-file" half of Word
 * transclusion (mirrors xlsx-cell-writer for Calc).
 *
 * The LibreOffice engine owns whichever file is currently OPEN; touching that
 * file on disk under it would desync the live view. For files that are NOT open,
 * we skip the engine and set the ONE tagged content control directly in the
 * .docx. A .docx is a zip of XML: we locate the `<w:sdt>` whose `<w:sdtPr>`
 * carries `<w:tag w:val="wos-metric-…">`, then replace ONLY the text inside its
 * `<w:sdtContent>` with the metric's literal value. Every other part, run,
 * paragraph, style and relationship is preserved verbatim.
 *
 * STRICT fail-safe — on ANY uncertainty we skip and report, never writing a
 * partial/corrupt file:
 *   - missing / unreadable / not a .docx / not a valid zip        → skip
 *   - word/document.xml absent                                    → skip
 *   - the tag isn't found, or is ambiguous (found more than once) → skip
 *   - the matched control has a NESTED content control            → skip
 *     (replacing its content could clobber the inner one)
 *   - the value isn't a finite number                            → skip
 *
 * Durability: we build the new zip to a temp file in the SAME directory, re-open
 * it (verify it's a valid zip whose document.xml still holds the tag + new value)
 * BEFORE atomically renaming it over the original. A crash mid-write can
 * therefore never truncate the real file.
 */

export interface DocxWriteResult {
  ok: boolean
  /** Machine-readable skip reason (present only when ok === false). */
  reason?: string
}

const skip = (reason: string): DocxWriteResult => ({ ok: false, reason })

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Result of the pure replace: the rewritten XML, or a machine-readable error. */
export type ReplaceResult = { xml: string } | { error: string }

/**
 * PURE core: in a word/document.xml string, replace the value inside the content
 * control tagged `tag` with `value`. Returns the new XML or an error reason.
 * No I/O — this is the fail-safe decision the writer acts on, unit-testable
 * without a real file.
 */
export function replaceContentControlValue(xml: string, tag: string, value: number): ReplaceResult {
  if (typeof value !== 'number' || !Number.isFinite(value)) return { error: 'value-not-finite' }
  if (typeof tag !== 'string' || !tag) return { error: 'bad-tag' }
  if (typeof xml !== 'string' || !xml) return { error: 'bad-xml' }

  // Locate the tag element (lenient on attribute spacing/order).
  const tagRe = new RegExp(`<w:tag\\b[^>]*\\bw:val="${escapeRe(tag)}"[^>]*/?>`, 'g')
  const matches = [...xml.matchAll(tagRe)]
  if (matches.length === 0) return { error: 'tag-not-found' }
  if (matches.length > 1) return { error: 'tag-ambiguous' }
  const tagIdx = matches[0].index as number

  // Find the enclosing <w:sdt> that opens before the tag, then depth-match its
  // close so nested content controls can't fool the boundary.
  const sdtOpenRe = /<w:sdt\b[^>]*>/g
  let sdtStart = -1
  for (const m of xml.matchAll(sdtOpenRe)) {
    const i = m.index as number
    if (i > tagIdx) break
    sdtStart = i
  }
  if (sdtStart < 0) return { error: 'sdt-open-not-found' }

  const tokenRe = /<w:sdt\b[^>]*>|<\/w:sdt>/g
  tokenRe.lastIndex = sdtStart
  let depth = 0
  let sdtEnd = -1
  for (let m = tokenRe.exec(xml); m; m = tokenRe.exec(xml)) {
    if (m[0].startsWith('</')) {
      depth--
      if (depth === 0) {
        sdtEnd = m.index + m[0].length
        break
      }
    } else {
      depth++
    }
  }
  if (sdtEnd < 0) return { error: 'sdt-close-not-found' }

  const block = xml.slice(sdtStart, sdtEnd)

  // Refuse nested content controls — replacing our content could clobber theirs.
  if ((block.match(/<w:sdtContent\b/g) || []).length !== 1) return { error: 'nested-unsupported' }

  const contentRe = /(<w:sdtContent\b[^>]*>)([\s\S]*?)(<\/w:sdtContent>)/
  const cm = contentRe.exec(block)
  if (!cm) return { error: 'sdtContent-not-found' }
  const [, open, inner, close] = cm

  // Preserve the run properties of the run that holds the value, if any, so the
  // number keeps its formatting; otherwise emit a bare run.
  const rprMatch = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(inner)
  const rpr = rprMatch ? rprMatch[0] : ''
  const newInner = `<w:r>${rpr}<w:t xml:space="preserve">${escapeXml(String(value))}</w:t></w:r>`

  const newBlock = block.replace(contentRe, `${open}${newInner}${close}`)
  const newXml = xml.slice(0, sdtStart) + newBlock + xml.slice(sdtEnd)
  return { xml: newXml }
}

/**
 * Sets one tagged content control to a numeric literal in a closed .docx,
 * safely. Never throws — every failure path returns { ok:false, reason } and
 * leaves the file untouched.
 */
export async function setContentControlText(
  filePath: string,
  tag: string,
  value: number
): Promise<DocxWriteResult> {
  if (typeof value !== 'number' || !Number.isFinite(value)) return skip('value-not-finite')
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

  const res = replaceContentControlValue(docXml, tag, value)
  if ('error' in res) return skip(res.error)

  // Write the ONE changed part back; every other entry is preserved verbatim.
  zip.file('word/document.xml', res.xml)

  const dir = path.dirname(filePath)
  const tmp = path.join(dir, `.${path.basename(filePath)}.wos-${process.pid}-${Date.now()}.tmp`)
  try {
    const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    fs.writeFileSync(tmp, out)
    // Verify the temp re-opens as a valid docx whose document.xml holds the new
    // value under the tag BEFORE we replace the real one.
    const verifyZip = await JSZip.loadAsync(fs.readFileSync(tmp))
    const vEntry = verifyZip.file('word/document.xml')
    if (!vEntry) throw new Error('verify: no document.xml')
    const vXml = await vEntry.async('string')
    if (!vXml.includes(`w:val="${tag}"`) || !vXml.includes(`>${escapeXml(String(value))}<`)) {
      throw new Error('verify: value not present')
    }
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
