import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import JSZip from 'jszip'
import {
  renderCards,
  coerceCardTemplate,
  replaceCardsRegion,
  setDocCards,
  cardsStartName,
  cardsEndName,
  type CardTemplate,
} from './docx-cards-writer'
import { applyView } from './collectionLinks'
import type { CollectionRecord } from './collections'

const TAG = 'wos-collection-c1'

/** A 2-line directory card: bold "{Name} — {Title}" then "{Email}". */
const TEMPLATE: CardTemplate = {
  lines: [
    { segments: [{ field: 'Name', bold: true }, { literal: ' — ' }, { field: 'Title' }] },
    { segments: [{ field: 'Email' }] },
  ],
}

const RECORDS: CollectionRecord[] = [
  { Name: 'Ada Lovelace', Title: 'Engineer', Email: 'ada@x.io' },
  { Name: 'Alan Turing', Title: 'Cryptographer', Email: 'alan@x.io' },
  { Name: 'Grace Hopper', Title: 'Admiral', Email: 'grace@x.io' },
]

/** A word/document.xml holding a start…end bookmark pair with a placeholder between. */
const cardsXml = (tag = TAG): string =>
  '<w:body>' +
  '<w:p><w:r><w:t>Team Directory</w:t></w:r></w:p>' +
  `<w:bookmarkStart w:id="1" w:name="${cardsStartName(tag)}"/><w:bookmarkEnd w:id="1"/>` +
  '<w:p><w:r><w:t>placeholder</w:t></w:r></w:p>' +
  `<w:bookmarkStart w:id="2" w:name="${cardsEndName(tag)}"/><w:bookmarkEnd w:id="2"/>` +
  '<w:p><w:r><w:t>Footer</w:t></w:r></w:p>' +
  '</w:body>'

describe('renderCards (pure)', () => {
  it('renders one block per record, correct <w:p> count, bold runs + field values', () => {
    const xml = renderCards(RECORDS, TEMPLATE)
    // 3 records × 2 lines = 6 paragraphs.
    expect((xml.match(/<w:p>/g) || []).length).toBe(6)
    // Bold run for the Name segment; field values present, in order.
    expect(xml).toContain('<w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Ada Lovelace</w:t>')
    expect(xml).toContain('<w:t xml:space="preserve"> — </w:t>')
    expect(xml).toContain('<w:t xml:space="preserve">Engineer</w:t>')
    expect(xml).toContain('<w:t xml:space="preserve">ada@x.io</w:t>')
    // Order: Ada before Alan before Grace.
    expect(xml.indexOf('Ada Lovelace')).toBeLessThan(xml.indexOf('Alan Turing'))
    expect(xml.indexOf('Alan Turing')).toBeLessThan(xml.indexOf('Grace Hopper'))
  })

  it('escapes XML metacharacters + treats missing fields as empty', () => {
    const xml = renderCards(
      [{ Name: 'a<b & c', Title: '', Email: 'z>y' }],
      TEMPLATE
    )
    expect(xml).toContain('a&lt;b &amp; c')
    expect(xml).toContain('z&gt;y')
    // Title empty → a run with empty text (still a bold+literal+field line).
    expect((xml.match(/<w:p>/g) || []).length).toBe(2)
  })

  it('empty records → empty string (an empty region; surrounding doc survives)', () => {
    expect(renderCards([], TEMPLATE)).toBe('')
  })

  it('a view (sort + limit) applied first yields only the queried records, in order', () => {
    const viewed = applyView(RECORDS, { sort: [{ field: 'Name', dir: 'asc' }], limit: 2 })
    const xml = renderCards(viewed, TEMPLATE)
    expect((xml.match(/<w:p>/g) || []).length).toBe(4) // 2 records × 2 lines
    expect(xml).toContain('Ada Lovelace')
    expect(xml).toContain('Alan Turing')
    expect(xml).not.toContain('Grace Hopper') // limited out
  })
})

describe('coerceCardTemplate', () => {
  it('keeps renderable lines/segments; drops empties; caps bold to bool', () => {
    const t = coerceCardTemplate({
      lines: [
        { segments: [{ field: 'Name', bold: true }, { literal: ' — ' }] },
        { segments: [{}] }, // no field/literal → dropped, and line becomes empty → dropped
        { segments: [{ field: 'Email' }] },
      ],
    })
    expect(t).not.toBeNull()
    expect(t!.lines.length).toBe(2)
    expect(t!.lines[0].segments[0]).toEqual({ field: 'Name', bold: true })
  })

  it('returns null for malformed / empty templates', () => {
    expect(coerceCardTemplate(null)).toBeNull()
    expect(coerceCardTemplate({})).toBeNull()
    expect(coerceCardTemplate({ lines: [] })).toBeNull()
    expect(coerceCardTemplate({ lines: [{ segments: [] }] })).toBeNull()
  })
})

describe('replaceCardsRegion (pure fail-safe core)', () => {
  it('replaces the span between the pair, preserving surrounding paragraphs + anchors', () => {
    const res = replaceCardsRegion(cardsXml(), TAG, RECORDS, TEMPLATE)
    expect('xml' in res).toBe(true)
    if (!('xml' in res)) return
    expect(res.xml).toContain('<w:t>Team Directory</w:t>') // before survives
    expect(res.xml).toContain('<w:t>Footer</w:t>') // after survives
    expect(res.xml).toContain(`w:name="${cardsStartName(TAG)}"`)
    expect(res.xml).toContain(`w:name="${cardsEndName(TAG)}"`)
    expect(res.xml).not.toContain('placeholder') // replaced
    expect(res.xml).toContain('Ada Lovelace')
    expect(res.xml).toContain('Grace Hopper')
  })

  it('skips on missing / ambiguous anchors, order, bad template', () => {
    expect(replaceCardsRegion(cardsXml(), 'wos-collection-nope', RECORDS, TEMPLATE)).toEqual({
      error: 'anchor-not-found',
    })
    const dup = cardsXml() + cardsXml()
    expect(replaceCardsRegion(dup, TAG, RECORDS, TEMPLATE)).toEqual({ error: 'anchor-ambiguous' })
    // end before start → order error.
    const swapped =
      '<w:body>' +
      `<w:bookmarkStart w:id="2" w:name="${cardsEndName(TAG)}"/>` +
      '<w:p><w:r><w:t>x</w:t></w:r></w:p>' +
      `<w:bookmarkStart w:id="1" w:name="${cardsStartName(TAG)}"/>` +
      '</w:body>'
    expect(replaceCardsRegion(swapped, TAG, RECORDS, TEMPLATE)).toEqual({ error: 'anchor-order' })
    expect(replaceCardsRegion(cardsXml(), TAG, RECORDS, { lines: [] })).toEqual({
      error: 'bad-template',
    })
  })
})

describe('setDocCards (engine-free .docx directory writer, synthetic zip)', () => {
  let dir: string
  let file: string

  const buildDocx = async (docXml: string): Promise<Buffer> => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types/>')
    zip.file('word/document.xml', `<w:document>${docXml}</w:document>`)
    zip.file('word/styles.xml', '<w:styles/>')
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  }

  const readDocXml = async (): Promise<string> => {
    const zip = await JSZip.loadAsync(fs.readFileSync(file))
    return zip.file('word/document.xml')!.async('string')
  }

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-docx-cards-'))
    file = path.join(dir, 'dir.docx')
    fs.writeFileSync(file, await buildDocx(cardsXml()))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('writes N record-blocks between the bookmarks, in order; surrounding survives', async () => {
    expect(await setDocCards(file, TAG, RECORDS, TEMPLATE)).toEqual({ ok: true })
    const xml = await readDocXml()
    // Other parts intact.
    const zip = await JSZip.loadAsync(fs.readFileSync(file))
    expect(zip.file('[Content_Types].xml')).toBeTruthy()
    expect(zip.file('word/styles.xml')).toBeTruthy()
    // Surrounding content survives; anchors survive.
    expect(xml).toContain('<w:t>Team Directory</w:t>')
    expect(xml).toContain('<w:t>Footer</w:t>')
    expect(xml).toContain(`w:name="${cardsStartName(TAG)}"`)
    expect(xml).toContain(`w:name="${cardsEndName(TAG)}"`)
    // Each record present, in order; placeholder gone.
    expect(xml).not.toContain('placeholder')
    expect(xml.indexOf('Ada Lovelace')).toBeLessThan(xml.indexOf('Alan Turing'))
    expect(xml.indexOf('Alan Turing')).toBeLessThan(xml.indexOf('Grace Hopper'))
    // 3 records × 2 lines between the anchors.
    const start = xml.indexOf(`w:name="${cardsStartName(TAG)}"`)
    const end = xml.indexOf(`w:name="${cardsEndName(TAG)}"`)
    const between = xml.slice(start, end)
    expect((between.match(/<w:p>/g) || []).length).toBe(6)
  })

  it('re-sync replaces the blocks (old record text gone, new present)', async () => {
    expect(await setDocCards(file, TAG, RECORDS, TEMPLATE)).toEqual({ ok: true })
    const next: CollectionRecord[] = [{ Name: 'Nikola Tesla', Title: 'Inventor', Email: 'nik@x.io' }]
    expect(await setDocCards(file, TAG, next, TEMPLATE)).toEqual({ ok: true })
    const xml = await readDocXml()
    expect(xml).toContain('Nikola Tesla')
    expect(xml).not.toContain('Ada Lovelace') // old blocks replaced
    expect(xml).not.toContain('Grace Hopper')
    expect(xml).toContain('<w:t>Team Directory</w:t>') // surrounding still intact
  })

  it('FAIL-SAFE: missing anchor / ambiguous / bad template → skip, file BYTE-IDENTICAL', async () => {
    const before = fs.readFileSync(file)
    // Missing anchor.
    expect((await setDocCards(file, 'wos-collection-x', RECORDS, TEMPLATE)).reason).toBe(
      'anchor-not-found'
    )
    expect(fs.readFileSync(file).equals(before)).toBe(true)
    // Bad template.
    expect((await setDocCards(file, TAG, RECORDS, { lines: [] })).reason).toBe('bad-template')
    expect(fs.readFileSync(file).equals(before)).toBe(true)
    // Ambiguous anchor (duplicate pair).
    const dupFile = path.join(dir, 'dup.docx')
    fs.writeFileSync(dupFile, await buildDocx(cardsXml() + cardsXml()))
    const dupBefore = fs.readFileSync(dupFile)
    expect((await setDocCards(dupFile, TAG, RECORDS, TEMPLATE)).reason).toBe('anchor-ambiguous')
    expect(fs.readFileSync(dupFile).equals(dupBefore)).toBe(true)
  })

  it('FAIL-SAFE: missing file, wrong ext, non-zip → skip', async () => {
    expect((await setDocCards(path.join(dir, 'nope.docx'), TAG, RECORDS, TEMPLATE)).reason).toBe(
      'missing'
    )
    expect((await setDocCards(path.join(dir, 'x.txt'), TAG, RECORDS, TEMPLATE)).reason).toBe(
      'not-docx'
    )
    const fake = path.join(dir, 'fake.docx')
    fs.writeFileSync(fake, 'not a zip at all')
    expect((await setDocCards(fake, TAG, RECORDS, TEMPLATE)).reason).toBe('not-valid-docx')
  })
})
