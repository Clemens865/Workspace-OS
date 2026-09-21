import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import JSZip from 'jszip'
import { replaceShapeTextValue, countNamedShapes, setShapeText } from './pptx-shape-writer'

/** The real .pptx fixture — produced by the LibreOffice engine, 2 slides. Slide 1
 * holds an UNTAGGED 'Prefix' text shape + a tagged text shape named
 * `wos-metric-link-42` with the value '23.4'. Slide 2 holds 'Slide two content'.
 * Proves the writer round-trips a genuine PowerPoint document and leaves other
 * shapes/slides intact. Rebuild with scripts (see report) if ever regenerated. */
const FIXTURE = path.join(__dirname, '__fixtures__', 'metric-shape.pptx')
const TAG = 'wos-metric-link-42'

const slideXml = async (file: string, n: number): Promise<string> => {
  const zip = await JSZip.loadAsync(fs.readFileSync(file))
  return zip.file(`ppt/slides/slide${n}.xml`)!.async('string')
}

describe('replaceShapeTextValue (pure fail-safe core)', () => {
  const xml =
    '<p:sp><p:nvSpPr><p:cNvPr id="9" name="Other"/></p:nvSpPr>' +
    '<p:txBody><a:p><a:r><a:t>Prefix</a:t></a:r></a:p></p:txBody></p:sp>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="11" name="wos-metric-link-42"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>' +
    '<p:txBody><a:p><a:r><a:rPr sz="1800"/><a:t>23.4</a:t></a:r></a:p></p:txBody></p:sp>'

  it('replaces ONLY the tagged shape run, preserving the other shape + run props', () => {
    const res = replaceShapeTextValue(xml, TAG, 77.7)
    expect('xml' in res).toBe(true)
    if (!('xml' in res)) return
    expect(res.xml).toContain('<a:t>Prefix</a:t>') // untagged shape untouched
    expect(res.xml).toContain('name="wos-metric-link-42"') // anchor survives
    expect(res.xml).toContain('<a:rPr sz="1800"/>') // run props kept
    expect(res.xml).toContain('<a:t>77.7</a:t>')
    expect(res.xml).not.toContain('<a:t>23.4</a:t>')
  })

  it('counts named shapes for ambiguity detection', () => {
    expect(countNamedShapes(xml, TAG)).toBe(1)
    expect(countNamedShapes(xml, 'Other')).toBe(1)
    expect(countNamedShapes(xml, 'nope')).toBe(0)
    expect(countNamedShapes(xml + xml, TAG)).toBe(2)
  })

  it('skips (error) on unknown, non-finite, and bad inputs', () => {
    expect(replaceShapeTextValue(xml, 'wos-metric-nope', 1)).toEqual({ error: 'tag-not-found' })
    expect(replaceShapeTextValue(xml + xml, TAG, 1)).toEqual({ error: 'tag-ambiguous' })
    expect(replaceShapeTextValue(xml, TAG, Infinity)).toEqual({ error: 'value-not-finite' })
    expect(replaceShapeTextValue(xml, TAG, NaN)).toEqual({ error: 'value-not-finite' })
    expect(replaceShapeTextValue(xml, '', 1)).toEqual({ error: 'bad-tag' })
  })

  it('refuses a shape with a SPLIT value (0 or >1 text runs — never guesses)', () => {
    const multi =
      '<p:sp><p:nvSpPr><p:cNvPr id="11" name="wos-metric-link-42"/></p:nvSpPr>' +
      '<p:txBody><a:p><a:r><a:t>2</a:t></a:r><a:r><a:t>3.4</a:t></a:r></a:p></p:txBody></p:sp>'
    expect(replaceShapeTextValue(multi, TAG, 1)).toEqual({ error: 'multi-run-unsupported' })
    const empty =
      '<p:sp><p:nvSpPr><p:cNvPr id="11" name="wos-metric-link-42"/></p:nvSpPr>' +
      '<p:txBody><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>'
    expect(replaceShapeTextValue(empty, TAG, 1)).toEqual({ error: 'multi-run-unsupported' })
  })
})

describe('setShapeText (engine-free .pptx writer, real fixture)', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-pptx-'))
    file = path.join(dir, 'deck.pptx')
    fs.copyFileSync(FIXTURE, file)
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('the fixture is a real .pptx holding the tagged shape at 23.4 (2 slides)', async () => {
    const zip = await JSZip.loadAsync(fs.readFileSync(file))
    expect(zip.file('ppt/slides/slide1.xml')).toBeTruthy()
    expect(zip.file('ppt/slides/slide2.xml')).toBeTruthy()
    const s1 = await slideXml(file, 1)
    expect(s1).toContain('name="wos-metric-link-42"')
    expect(s1).toContain('<a:t>23.4</a:t>')
    expect(s1).toContain('<a:t>Prefix</a:t>') // sibling shape
    expect(await slideXml(file, 2)).toContain('<a:t>Slide two content</a:t>')
  })

  it('sets the shape value on disk, keeps the deck valid + other content intact', async () => {
    const res = await setShapeText(file, TAG, 88.8)
    expect(res).toEqual({ ok: true })

    // Re-open as a valid zip and re-read the slides.
    const zip = await JSZip.loadAsync(fs.readFileSync(file))
    expect(zip.file('[Content_Types].xml')).toBeTruthy() // other parts preserved
    expect(zip.file('ppt/presentation.xml')).toBeTruthy()
    const s1 = await zip.file('ppt/slides/slide1.xml')!.async('string')
    expect(s1).toContain('<a:t>88.8</a:t>')
    expect(s1).not.toContain('<a:t>23.4</a:t>')
    expect(s1).toContain('name="wos-metric-link-42"') // anchor survives
    expect(s1).toContain('<a:t>Prefix</a:t>') // sibling shape untouched
    // slide 2 is byte-identical (untouched slide)
    const s2 = await zip.file('ppt/slides/slide2.xml')!.async('string')
    expect(s2).toContain('<a:t>Slide two content</a:t>')
  })

  it('is idempotent + re-writable (second set lands cleanly)', async () => {
    expect(await setShapeText(file, TAG, 5)).toEqual({ ok: true })
    expect(await setShapeText(file, TAG, 6.25)).toEqual({ ok: true })
    const s1 = await slideXml(file, 1)
    expect(s1).toContain('<a:t>6.25</a:t>')
    expect(s1).not.toContain('<a:t>5</a:t>')
  })

  it('FAIL-SAFE: skips (never corrupts) on missing file, wrong ext, unknown tag, bad value', async () => {
    const before = fs.readFileSync(file)

    expect(await setShapeText(path.join(dir, 'nope.pptx'), TAG, 1)).toEqual({ ok: false, reason: 'missing' })
    expect(await setShapeText(path.join(dir, 'x.txt'), TAG, 1)).toEqual({ ok: false, reason: 'not-pptx' })
    expect((await setShapeText(file, 'wos-metric-unknown', 1)).reason).toBe('tag-not-found')
    expect((await setShapeText(file, TAG, Infinity)).reason).toBe('value-not-finite')

    // The original file is byte-for-byte untouched by every skip path.
    expect(fs.readFileSync(file).equals(before)).toBe(true)
  })

  it('skips a non-pptx zip masquerading with the right extension', async () => {
    const fake = path.join(dir, 'fake.pptx')
    fs.writeFileSync(fake, 'not a zip at all')
    expect((await setShapeText(fake, TAG, 1)).reason).toBe('not-valid-pptx')
  })
})
