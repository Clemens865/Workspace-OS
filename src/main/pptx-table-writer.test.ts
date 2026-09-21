import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import JSZip from 'jszip'
import { replaceSlideTableCells, countNamedFrames, setSlideTableCells } from './pptx-table-writer'

const TAG = 'wos-range-r1-abc'

/** One <a:tc> shaped like LibreOffice output. */
const tc = (text: string): string =>
  '<a:tc><a:txBody><a:bodyPr/><a:p><a:pPr algn="l"/><a:r><a:rPr lang="en-US"/><a:t>' +
  text +
  '</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>'

/** A representative slide XML holding one named graphicFrame with a 2×2 a:tbl. */
const slideXml = (tag = TAG): string =>
  '<p:cSld><p:spTree>' +
  '<p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>Slide</a:t></a:r></a:p></p:txBody></p:sp>' +
  '<p:graphicFrame><p:nvGraphicFramePr>' +
  `<p:cNvPr id="2" name="${tag}"/><p:cNvGraphicFramePr/><p:nvPr/>` +
  '</p:nvGraphicFramePr><p:xfrm/>' +
  '<a:graphic><a:graphicData><a:tbl>' +
  '<a:tblPr/><a:tblGrid><a:gridCol w="100"/><a:gridCol w="100"/></a:tblGrid>' +
  `<a:tr h="200">${tc('Region')}${tc('Rev')}</a:tr>` +
  `<a:tr h="200">${tc('EMEA')}${tc('12.5')}</a:tr>` +
  '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>' +
  '</p:spTree></p:cSld>'

const GRID = [
  ['Region', 'Rev'],
  ['APAC', 7],
]

describe('countNamedFrames', () => {
  it('counts only named table frames', () => {
    expect(countNamedFrames(slideXml(), TAG)).toBe(1)
    expect(countNamedFrames(slideXml(), 'wos-range-nope')).toBe(0)
    expect(countNamedFrames(slideXml() + slideXml(), TAG)).toBe(2)
  })
})

describe('replaceSlideTableCells (pure fail-safe core)', () => {
  it('replaces every cell text, preserving other shapes + run/para props', () => {
    const res = replaceSlideTableCells(slideXml(), TAG, GRID)
    expect('xml' in res).toBe(true)
    if (!('xml' in res)) return
    expect(res.xml).toContain('<a:t>Slide</a:t>') // the other shape untouched
    expect(res.xml).toContain('<a:pPr algn="l"/>') // para props kept
    expect(res.xml).toContain('<a:rPr lang="en-US"/>') // run props kept
    expect(res.xml).toContain('<a:t>APAC</a:t>')
    expect(res.xml).toContain('<a:t>7</a:t>')
    expect(res.xml).not.toContain('<a:t>EMEA</a:t>')
    expect(res.xml).not.toContain('<a:t>12.5</a:t>')
    expect((res.xml.match(/<a:tbl>/g) || []).length).toBe(1)
  })

  it('skips (error) on unknown / ambiguous tag and bad inputs', () => {
    expect(replaceSlideTableCells(slideXml(), 'wos-range-nope', GRID)).toEqual({ error: 'tag-not-found' })
    const dup = slideXml() + slideXml()
    expect(replaceSlideTableCells(dup, TAG, GRID)).toEqual({ error: 'tag-ambiguous' })
    expect(replaceSlideTableCells(slideXml(), '', GRID)).toEqual({ error: 'bad-tag' })
  })

  it('FAIL-SAFE: refuses a shape mismatch (row/col count changed)', () => {
    expect(replaceSlideTableCells(slideXml(), TAG, [['a', 'b'], ['c', 'd'], ['e', 'f']])).toEqual({
      error: 'row-count-mismatch',
    })
    expect(replaceSlideTableCells(slideXml(), TAG, [['a', 'b', 'c'], ['d', 'e', 'f']])).toEqual({
      error: 'col-count-mismatch',
    })
  })

  it('escapes XML metacharacters in cell text', () => {
    const res = replaceSlideTableCells(slideXml(), TAG, [['a<b', 'x&y'], ['1', '2']])
    if (!('xml' in res)) throw new Error('expected xml')
    expect(res.xml).toContain('<a:t>a&lt;b</a:t>')
    expect(res.xml).toContain('<a:t>x&amp;y</a:t>')
  })
})

describe('setSlideTableCells (engine-free .pptx table writer, synthetic zip)', () => {
  let dir: string
  let file: string

  const buildPptx = async (...slides: string[]): Promise<Buffer> => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types/>')
    zip.file('ppt/presentation.xml', '<p:presentation/>')
    slides.forEach((s, i) => zip.file(`ppt/slides/slide${i + 1}.xml`, `<p:sld>${s}</p:sld>`))
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  }

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-pptx-tbl-'))
    file = path.join(dir, 'deck.pptx')
    // Two slides; the named table lives on slide 2 — proves multi-slide search.
    fs.writeFileSync(file, await buildPptx('<p:cSld><p:spTree/></p:cSld>', slideXml()))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('sets the table cells on disk, keeps the deck valid + other parts intact', async () => {
    expect(await setSlideTableCells(file, TAG, GRID)).toEqual({ ok: true })
    const zip = await JSZip.loadAsync(fs.readFileSync(file))
    expect(zip.file('[Content_Types].xml')).toBeTruthy()
    expect(zip.file('ppt/slides/slide1.xml')).toBeTruthy() // untouched slide preserved
    const xml = await zip.file('ppt/slides/slide2.xml')!.async('string')
    expect(xml).toContain('<a:t>APAC</a:t>')
    expect(xml).toContain('<a:t>7</a:t>')
    expect(xml).not.toContain('<a:t>EMEA</a:t>')
    expect(xml).toContain(`name="${TAG}"`)
  })

  it('FAIL-SAFE: skips (never corrupts) on missing, wrong ext, unknown tag, shape drift, ambiguity', async () => {
    const before = fs.readFileSync(file)
    expect(await setSlideTableCells(path.join(dir, 'nope.pptx'), TAG, GRID)).toEqual({ ok: false, reason: 'missing' })
    expect(await setSlideTableCells(path.join(dir, 'x.txt'), TAG, GRID)).toEqual({ ok: false, reason: 'not-pptx' })
    expect((await setSlideTableCells(file, 'wos-range-unknown', GRID)).reason).toBe('tag-not-found')
    expect((await setSlideTableCells(file, TAG, [['a', 'b'], ['c', 'd'], ['e', 'f']])).reason).toBe('row-count-mismatch')

    // Ambiguity: the same tag on both slides → skip.
    const ambig = path.join(dir, 'ambig.pptx')
    fs.writeFileSync(ambig, await buildPptx(slideXml(), slideXml()))
    expect((await setSlideTableCells(ambig, TAG, GRID)).reason).toBe('tag-ambiguous')

    expect(fs.readFileSync(file).equals(before)).toBe(true) // untouched by every skip
  })

  it('skips a non-pptx masquerading with the right extension', async () => {
    const fake = path.join(dir, 'fake.pptx')
    fs.writeFileSync(fake, 'not a zip at all')
    expect((await setSlideTableCells(fake, TAG, GRID)).reason).toBe('not-valid-pptx')
  })
})
