import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import JSZip from 'jszip'
import { replaceContentControlValue, setContentControlText } from './docx-cc-writer'

/** The real .docx fixture — produced by the LibreOffice engine, holds a content
 * control tagged `wos-metric-link-42` with the value 23.4 and the surrounding
 * text "Prefix and ". Proves the writer round-trips a genuine Word document. */
const FIXTURE = path.join(__dirname, '__fixtures__', 'metric-cc.docx')
const TAG = 'wos-metric-link-42'

const docXml = async (file: string): Promise<string> => {
  const zip = await JSZip.loadAsync(fs.readFileSync(file))
  return zip.file('word/document.xml')!.async('string')
}

describe('replaceContentControlValue (pure fail-safe core)', () => {
  const xml =
    '<w:body><w:p><w:r><w:t>Prefix </w:t></w:r>' +
    '<w:sdt><w:sdtPr><w:tag w:val="wos-metric-link-42"/></w:sdtPr>' +
    '<w:sdtContent><w:r><w:rPr><w:b/></w:rPr><w:t>23.4</w:t></w:r></w:sdtContent></w:sdt>' +
    '<w:r><w:t> suffix</w:t></w:r></w:p></w:body>'

  it('replaces the tagged control value, preserving surrounding text + run props', () => {
    const res = replaceContentControlValue(xml, TAG, 77.7)
    expect('xml' in res).toBe(true)
    if (!('xml' in res)) return
    expect(res.xml).toContain('<w:t>Prefix </w:t>')
    expect(res.xml).toContain('<w:t> suffix</w:t>')
    expect(res.xml).toContain('<w:tag w:val="wos-metric-link-42"/>')
    expect(res.xml).toContain('<w:rPr><w:b/></w:rPr>') // run props kept
    expect(res.xml).toContain('>77.7<')
    expect(res.xml).not.toContain('>23.4<')
    // the sdt is intact (still one open/close pair, value inside sdtContent)
    expect((res.xml.match(/<w:sdt\b/g) || []).length).toBe(1)
    expect(/<w:sdtContent[^>]*><w:r>.*?77\.7.*?<\/w:r><\/w:sdtContent>/.test(res.xml)).toBe(true)
  })

  it('skips (error) on unknown, ambiguous, non-finite, and bad inputs', () => {
    expect(replaceContentControlValue(xml, 'wos-metric-nope', 1)).toEqual({ error: 'tag-not-found' })
    const dup = xml + xml
    expect(replaceContentControlValue(dup, TAG, 1)).toEqual({ error: 'tag-ambiguous' })
    expect(replaceContentControlValue(xml, TAG, Infinity)).toEqual({ error: 'value-not-finite' })
    expect(replaceContentControlValue(xml, TAG, NaN)).toEqual({ error: 'value-not-finite' })
    expect(replaceContentControlValue(xml, '', 1)).toEqual({ error: 'bad-tag' })
  })

  it('refuses a NESTED content control (never clobbers an inner one)', () => {
    const nested =
      '<w:sdt><w:sdtPr><w:tag w:val="wos-metric-link-42"/></w:sdtPr><w:sdtContent>' +
      '<w:sdt><w:sdtPr><w:tag w:val="inner"/></w:sdtPr><w:sdtContent><w:r><w:t>x</w:t></w:r></w:sdtContent></w:sdt>' +
      '</w:sdtContent></w:sdt>'
    expect(replaceContentControlValue(nested, TAG, 1)).toEqual({ error: 'nested-unsupported' })
  })
})

describe('setContentControlText (engine-free .docx writer, real fixture)', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-docx-'))
    file = path.join(dir, 'doc.docx')
    fs.copyFileSync(FIXTURE, file)
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('the fixture is a real .docx holding the tagged control at 23.4', async () => {
    const xml = await docXml(file)
    expect(xml).toContain('<w:tag w:val="wos-metric-link-42"/>')
    expect(xml).toContain('23.4')
    expect(xml).toContain('Prefix and') // surrounding body text
  })

  it('sets the control value on disk, keeps the doc valid + other content intact', async () => {
    const res = await setContentControlText(file, TAG, 88.8)
    expect(res).toEqual({ ok: true })

    // Re-open the written file as a valid zip and re-read document.xml.
    const zip = await JSZip.loadAsync(fs.readFileSync(file))
    expect(zip.file('word/document.xml')).toBeTruthy()
    expect(zip.file('[Content_Types].xml')).toBeTruthy() // other parts preserved
    expect(zip.file('word/styles.xml')).toBeTruthy()
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('>88.8<')
    expect(xml).not.toContain('>23.4<')
    expect(xml).toContain('<w:tag w:val="wos-metric-link-42"/>') // anchor survives
    expect(xml).toContain('Prefix and') // surrounding text untouched
    // sdt still intact (exactly one, value inside it)
    expect((xml.match(/<w:sdt\b/g) || []).length).toBe(1)
  })

  it('is idempotent + re-writable (second set lands cleanly)', async () => {
    expect(await setContentControlText(file, TAG, 5)).toEqual({ ok: true })
    expect(await setContentControlText(file, TAG, 6.25)).toEqual({ ok: true })
    const xml = await docXml(file)
    expect(xml).toContain('>6.25<')
    expect(xml).not.toContain('>5<')
  })

  it('FAIL-SAFE: skips (never corrupts) on missing file, wrong ext, unknown tag, bad value', async () => {
    const before = fs.readFileSync(file)

    expect(await setContentControlText(path.join(dir, 'nope.docx'), TAG, 1)).toEqual({ ok: false, reason: 'missing' })
    expect(await setContentControlText(path.join(dir, 'x.txt'), TAG, 1)).toEqual({ ok: false, reason: 'not-docx' })
    expect((await setContentControlText(file, 'wos-metric-unknown', 1)).reason).toBe('tag-not-found')
    expect((await setContentControlText(file, TAG, Infinity)).reason).toBe('value-not-finite')

    // The original file is byte-for-byte untouched by every skip path.
    expect(fs.readFileSync(file).equals(before)).toBe(true)
  })

  it('skips a non-docx zip masquerading with the right extension', async () => {
    const fake = path.join(dir, 'fake.docx')
    fs.writeFileSync(fake, 'not a zip at all')
    expect((await setContentControlText(fake, TAG, 1)).reason).toBe('not-valid-docx')
  })
})
