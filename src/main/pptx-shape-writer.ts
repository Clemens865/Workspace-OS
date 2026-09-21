import fs from 'fs'
import path from 'path'
import JSZip from 'jszip'

/**
 * Engine-free .pptx shape-text writer — the "closed-file" half of PowerPoint
 * transclusion (mirrors docx-cc-writer for Word / xlsx-cell-writer for Calc).
 *
 * The LibreOffice engine owns whichever file is currently OPEN; touching that
 * file on disk under it would desync the live view. For files that are NOT open,
 * we skip the engine and set the ONE tagged text shape directly in the .pptx. A
 * .pptx is a zip of XML: across every `ppt/slides/slideN.xml` we locate the
 * `<p:sp>` whose `<p:cNvPr name="wos-metric-…">` carries our tag, then replace
 * ONLY the text of the single `<a:t>` run inside its `<p:txBody>` with the
 * metric's literal value. Every other slide, shape, run, style and relationship
 * is preserved verbatim.
 *
 * STRICT fail-safe — on ANY uncertainty we skip and report, never writing a
 * partial/corrupt file:
 *   - missing / unreadable / not a .pptx / not a valid zip           → skip
 *   - no slides                                                       → skip
 *   - the tag isn't found on any slide                               → skip
 *   - the tag is ambiguous (found on/within more than one shape)     → skip
 *   - the matched shape has 0 or >1 `<a:t>` runs (edited/split text) → skip
 *     (we only own a single numeric literal — not our call to guess)
 *   - the value isn't a finite number                                → skip
 *
 * Durability: we build the new zip to a temp file in the SAME directory, re-open
 * it (verify it's a valid zip whose slide still holds the tag + new value) BEFORE
 * atomically renaming it over the original. A crash mid-write can therefore never
 * truncate the real file.
 */

export interface PptxWriteResult {
  ok: boolean
  /** Machine-readable skip reason (present only when ok === false). */
  reason?: string
}

const skip = (reason: string): PptxWriteResult => ({ ok: false, reason })

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Result of the pure replace: the rewritten slide XML, or a machine-readable error. */
export type ShapeReplaceResult = { xml: string } | { error: string }

/**
 * Counts the shapes on one slide whose `<p:cNvPr>` name equals `tag`. Used by the
 * writer to detect ambiguity ACROSS slides before it touches anything.
 */
export function countNamedShapes(xml: string, tag: string): number {
  if (typeof xml !== 'string' || typeof tag !== 'string' || !tag) return 0
  const re = new RegExp(`<p:cNvPr\\b[^>]*\\bname="${escapeRe(tag)}"`, 'g')
  return (xml.match(re) || []).length
}

/**
 * PURE core: in one `ppt/slides/slideN.xml` string, replace the text of the
 * single shape named `tag` with `value`. Assumes the caller has already verified
 * this slide holds EXACTLY ONE such shape (see countNamedShapes). Returns the new
 * XML or a machine-readable error. No I/O — the fail-safe decision, unit-testable.
 */
export function replaceShapeTextValue(xml: string, tag: string, value: number): ShapeReplaceResult {
  if (typeof value !== 'number' || !Number.isFinite(value)) return { error: 'value-not-finite' }
  if (typeof tag !== 'string' || !tag) return { error: 'bad-tag' }
  if (typeof xml !== 'string' || !xml) return { error: 'bad-xml' }

  // Locate the cNvPr carrying our name (lenient on attribute spacing/order).
  const nameRe = new RegExp(`<p:cNvPr\\b[^>]*\\bname="${escapeRe(tag)}"`, 'g')
  const nameMatches = [...xml.matchAll(nameRe)]
  if (nameMatches.length === 0) return { error: 'tag-not-found' }
  if (nameMatches.length > 1) return { error: 'tag-ambiguous' }
  const nameIdx = nameMatches[0].index as number

  // Find the enclosing <p:sp> that opens before the name, then depth-match its
  // close so a group's nested shapes can't fool the boundary.
  const spOpenRe = /<p:sp\b[^>]*>/g
  let spStart = -1
  for (const m of xml.matchAll(spOpenRe)) {
    const i = m.index as number
    if (i > nameIdx) break
    spStart = i
  }
  if (spStart < 0) return { error: 'sp-open-not-found' }

  const tokenRe = /<p:sp\b[^>]*>|<\/p:sp>/g
  tokenRe.lastIndex = spStart
  let depth = 0
  let spEnd = -1
  for (let m = tokenRe.exec(xml); m; m = tokenRe.exec(xml)) {
    if (m[0].startsWith('</')) {
      depth--
      if (depth === 0) {
        spEnd = m.index + m[0].length
        break
      }
    } else {
      depth++
    }
  }
  if (spEnd < 0) return { error: 'sp-close-not-found' }

  const block = xml.slice(spStart, spEnd)

  // We only own a single numeric literal. Require EXACTLY one text run — 0 means
  // the value was cleared, >1 means the user split/edited it; either way, skip.
  const tRe = /<a:t>([\s\S]*?)<\/a:t>/g
  const runs = [...block.matchAll(tRe)]
  if (runs.length !== 1) return { error: 'multi-run-unsupported' }

  const newBlock = block.replace(tRe, `<a:t>${escapeXml(String(value))}</a:t>`)
  const newXml = xml.slice(0, spStart) + newBlock + xml.slice(spEnd)
  return { xml: newXml }
}

/** True for a `ppt/slides/slideN.xml` part path. */
const isSlidePart = (name: string): boolean => /^ppt\/slides\/slide\d+\.xml$/.test(name)

/**
 * Sets one tagged text shape to a numeric literal in a closed .pptx, safely.
 * Never throws — every failure path returns { ok:false, reason } and leaves the
 * file untouched.
 */
export async function setShapeText(
  filePath: string,
  tag: string,
  value: number
): Promise<PptxWriteResult> {
  if (typeof value !== 'number' || !Number.isFinite(value)) return skip('value-not-finite')
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
  let slides: { name: string; xml: string }[] = []
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

  // Aggregate ambiguity across ALL slides before touching anything.
  const total = slides.reduce((n, s) => n + countNamedShapes(s.xml, tag), 0)
  if (total === 0) return skip('tag-not-found')
  if (total > 1) return skip('tag-ambiguous')

  const target = slides.find((s) => countNamedShapes(s.xml, tag) === 1)!
  const res = replaceShapeTextValue(target.xml, tag, value)
  if ('error' in res) return skip(res.error)

  // Write the ONE changed slide back; every other entry is preserved verbatim.
  zip.file(target.name, res.xml)

  const dir = path.dirname(filePath)
  const tmp = path.join(dir, `.${path.basename(filePath)}.wos-${process.pid}-${Date.now()}.tmp`)
  try {
    const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    fs.writeFileSync(tmp, out)
    // Verify the temp re-opens as a valid pptx whose slide holds the new value
    // under the tag BEFORE we replace the real one.
    const verifyZip = await JSZip.loadAsync(fs.readFileSync(tmp))
    const vEntry = verifyZip.file(target.name)
    if (!vEntry) throw new Error('verify: slide missing')
    const vXml = await vEntry.async('string')
    if (!vXml.includes(`name="${tag}"`) || !vXml.includes(`<a:t>${escapeXml(String(value))}</a:t>`)) {
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
