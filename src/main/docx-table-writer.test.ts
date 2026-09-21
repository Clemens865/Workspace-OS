import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import JSZip from 'jszip'
import { replaceTableCells, setDocTableCells, cellText } from './docx-table-writer'

const TAG = 'wos-range-r1-abc'

/** A representative word/document.xml holding one bookmark-anchored 2×2 table,
 * shaped like what LibreOffice emits (bookmark immediately before the <w:tbl>). */
const tableXml = (tag = TAG): string =>
  '<w:body>' +
  '<w:p><w:r><w:t>Before </w:t></w:r></w:p>' +
  `<w:bookmarkStart w:id="1" w:name="${tag}"/><w:bookmarkEnd w:id="1"/>` +
  '<w:tbl><w:tblPr><w:tblStyle w:val="Table"/></w:tblPr>' +
  '<w:tr>' +
  '<w:tc><w:tcPr/><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Region</w:t></w:r></w:p></w:tc>' +
  '<w:tc><w:tcPr/><w:p><w:r><w:t>Rev</w:t></w:r></w:p></w:tc>' +
  '</w:tr>' +
  '<w:tr>' +
  '<w:tc><w:tcPr/><w:p><w:r><w:t>EMEA</w:t></w:r></w:p></w:tc>' +
  '<w:tc><w:tcPr/><w:p><w:r><w:t>12.5</w:t></w:r></w:p></w:tc>' +
  '</w:tr>' +
  '</w:tbl>' +
  '<w:p><w:r><w:t> After</w:t></w:r></w:p>' +
  '</w:body>'

const GRID = [
  ['Region', 'Rev'],
  ['APAC', 7],
]

describe('cellText', () => {
  it('renders numbers, strings, and empties (null → blank)', () => {
    expect(cellText(12.5)).toBe('12.5')
    expect(cellText('EMEA')).toBe('EMEA')
    expect(cellText(null)).toBe('')
  })
})

describe('replaceTableCells (pure fail-safe core)', () => {
  it('replaces every cell text, preserving surrounding text + run/para props', () => {
    const res = replaceTableCells(tableXml(), TAG, GRID)
    expect('xml' in res).toBe(true)
    if (!('xml' in res)) return
    expect(res.xml).toContain('<w:t>Before </w:t>')
    expect(res.xml).toContain('<w:t> After</w:t>')
    expect(res.xml).toContain(`w:name="${TAG}"`) // anchor survives
    expect(res.xml).toContain('<w:rPr><w:b/></w:rPr>') // header run props kept
    expect(res.xml).toContain('<w:jc w:val="left"/>') // para props kept
    // New values present; old row-2 values gone.
    expect(res.xml).toContain('>APAC<')
    expect(res.xml).toContain('>7<')
    expect(res.xml).not.toContain('>EMEA<')
    expect(res.xml).not.toContain('>12.5<')
    // Header row-1 rewritten to the same header text (idempotent shape).
    expect(res.xml).toContain('>Region<')
    // Still exactly one table.
    expect((res.xml.match(/<w:tbl>/g) || []).length).toBe(1)
  })

  it('skips (error) on unknown / ambiguous tag and bad inputs', () => {
    expect(replaceTableCells(tableXml(), 'wos-range-nope', GRID)).toEqual({ error: 'tag-not-found' })
    const dup = tableXml() + tableXml()
    expect(replaceTableCells(dup, TAG, GRID)).toEqual({ error: 'tag-ambiguous' })
    expect(replaceTableCells(tableXml(), '', GRID)).toEqual({ error: 'bad-tag' })
    expect(replaceTableCells('', TAG, GRID)).toEqual({ error: 'bad-xml' })
  })

  it('FAIL-SAFE: refuses a shape mismatch (row/col count changed)', () => {
    // Grid has 3 rows; the table has 2 → refuse (never reshape).
    const tallGrid = [['a', 'b'], ['c', 'd'], ['e', 'f']]
    expect(replaceTableCells(tableXml(), TAG, tallGrid)).toEqual({ error: 'row-count-mismatch' })
    // Grid has 3 cols; the table rows have 2 → refuse.
    const wideGrid = [['a', 'b', 'c'], ['d', 'e', 'f']]
    expect(replaceTableCells(tableXml(), TAG, wideGrid)).toEqual({ error: 'col-count-mismatch' })
  })

  it('escapes XML metacharacters in cell text', () => {
    const res = replaceTableCells(tableXml(), TAG, [['a<b', 'x&y'], ['1', '2']])
    if (!('xml' in res)) throw new Error('expected xml')
    expect(res.xml).toContain('a&lt;b')
    expect(res.xml).toContain('x&amp;y')
  })

  it('associates the table when the bookmark lands AFTER it (LibreOffice ordering)', () => {
    // LibreOffice emits the bookmark right after the <w:tbl> it wraps.
    const bookmarkAfter =
      '<w:body><w:p><w:r><w:t>Before </w:t></w:r></w:p>' +
      '<w:tbl><w:tblPr/>' +
      '<w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Rev</w:t></w:r></w:p></w:tc></w:tr>' +
      '<w:tr><w:tc><w:p><w:r><w:t>EMEA</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>12.5</w:t></w:r></w:p></w:tc></w:tr>' +
      '</w:tbl>' +
      `<w:p><w:bookmarkStart w:id="0" w:name="${TAG}"/><w:bookmarkEnd w:id="0"/></w:p>` +
      '</w:body>'
    const res = replaceTableCells(bookmarkAfter, TAG, GRID)
    if (!('xml' in res)) throw new Error('expected xml, got ' + JSON.stringify(res))
    expect(res.xml).toContain('>APAC<')
    expect(res.xml).not.toContain('>EMEA<')
  })
})

describe('setDocTableCells (engine-free .docx table writer, synthetic zip)', () => {
  let dir: string
  let file: string

  const buildDocx = async (docXml: string): Promise<Buffer> => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types/>')
    zip.file('word/document.xml', `<w:document>${docXml}</w:document>`)
    zip.file('word/styles.xml', '<w:styles/>')
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  }

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-docx-tbl-'))
    file = path.join(dir, 'doc.docx')
    fs.writeFileSync(file, await buildDocx(tableXml()))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('sets the table cells on disk, keeps the doc valid + other parts intact', async () => {
    expect(await setDocTableCells(file, TAG, GRID)).toEqual({ ok: true })
    const zip = await JSZip.loadAsync(fs.readFileSync(file))
    expect(zip.file('[Content_Types].xml')).toBeTruthy()
    expect(zip.file('word/styles.xml')).toBeTruthy()
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('>APAC<')
    expect(xml).toContain('>7<')
    expect(xml).not.toContain('>EMEA<')
    expect(xml).toContain(`w:name="${TAG}"`)
  })

  it('is re-writable (a second grid lands cleanly)', async () => {
    expect(await setDocTableCells(file, TAG, GRID)).toEqual({ ok: true })
    expect(await setDocTableCells(file, TAG, [['Region', 'Rev'], ['LATAM', 9]])).toEqual({ ok: true })
    const zip = await JSZip.loadAsync(fs.readFileSync(file))
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('>LATAM<')
    expect(xml).not.toContain('>APAC<')
  })

  it('FAIL-SAFE: skips (never corrupts) on missing file, wrong ext, unknown tag, shape drift', async () => {
    const before = fs.readFileSync(file)
    expect(await setDocTableCells(path.join(dir, 'nope.docx'), TAG, GRID)).toEqual({ ok: false, reason: 'missing' })
    expect(await setDocTableCells(path.join(dir, 'x.txt'), TAG, GRID)).toEqual({ ok: false, reason: 'not-docx' })
    expect((await setDocTableCells(file, 'wos-range-unknown', GRID)).reason).toBe('tag-not-found')
    expect((await setDocTableCells(file, TAG, [['only-one-col'], ['x']])).reason).toBe('col-count-mismatch')
    expect(fs.readFileSync(file).equals(before)).toBe(true) // untouched by every skip
  })

  it('skips a non-docx masquerading with the right extension', async () => {
    const fake = path.join(dir, 'fake.docx')
    fs.writeFileSync(fake, 'not a zip at all')
    expect((await setDocTableCells(fake, TAG, GRID)).reason).toBe('not-valid-docx')
  })
})
