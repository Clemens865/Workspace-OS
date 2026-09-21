import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { readRange } from './xlsx-range-reader'
import { setRangeValues } from './xlsx-range-writer'
import { setDocTableCells } from './docx-table-writer'
import { CollectionStore, gridToRecords, planCollectionRefresh } from './collections'
import { CollectionLinkStore, planCollectionSyncAll, renderMapping } from './collectionLinks'

/**
 * Disk-level proof for collections (records→layout) against REAL files: a
 * collection is created from a real .xlsx block (row 0 = fields), bound to a
 * docx TABLE and an xlsx BLOCK via a field mapping, synced, then the written
 * files are UNZIPPED / re-read to assert the mapped headers + each record's
 * cells landed in order. Then the source changes and a re-sync propagates.
 * Engine-free (exceljs + jszip) — no LibreOffice.
 */
describe('collection sync-all against real files', () => {
  let dir: string
  const p = (name: string): string => path.join(dir, name)

  /** A source workbook: A1:C3 = a header row + two records; D1 holds a formula. */
  async function makeSource(name: string): Promise<string> {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Sheet1')
    ws.getCell('A1').value = 'Name'
    ws.getCell('B1').value = 'Role'
    ws.getCell('C1').value = 'Rev'
    ws.getCell('A2').value = 'Ana'
    ws.getCell('B2').value = 'Lead'
    ws.getCell('C2').value = 120
    ws.getCell('A3').value = 'Bo'
    ws.getCell('B3').value = 'Eng'
    ws.getCell('C3').value = 90
    ws.getCell('D1').value = { formula: 'C2+C3', result: 210 }
    const file = p(name)
    await wb.xlsx.writeFile(file)
    return file
  }

  /** A minimal .docx holding one bookmark-anchored 3-row × 2-col table. */
  async function makeDocx(name: string, tag: string): Promise<string> {
    const row = (a: string, b: string): string =>
      `<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>${a}</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:tcPr/><w:p><w:r><w:t>${b}</w:t></w:r></w:p></w:tc></w:tr>`
    const docXml =
      '<w:document><w:body>' +
      `<w:bookmarkStart w:id="1" w:name="${tag}"/><w:bookmarkEnd w:id="1"/>` +
      '<w:tbl><w:tblPr/>' +
      row('H1', 'H2') + row('r1a', 'r1b') + row('r2a', 'r2b') +
      '</w:tbl>' +
      '</w:body></w:document>'
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types/>')
    zip.file('word/document.xml', docXml)
    const file = p(name)
    fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
    return file
  }

  const docXmlOf = async (file: string): Promise<string> => {
    const zip = await JSZip.loadAsync(fs.readFileSync(file))
    return zip.file('word/document.xml')!.async('string')
  }
  const readBack = async (file: string, cell: string): Promise<unknown> => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(file)
    return wb.getWorksheet('Sheet1')!.getCell(cell).value
  }

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-collsync-')) })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('creates from a real .xlsx block (row 0 = fields) then syncs a docx table + xlsx block', async () => {
    const src = await makeSource('src.xlsx')
    const collections = new CollectionStore(() => p('collections.json'))
    const links = new CollectionLinkStore(() => p('links.json'))

    // create-from-source: read the block, interpret row 0 as fields.
    const read = await readRange(src, 'Sheet1', 'A1:C3')
    const parsed = gridToRecords(read.values!)!
    expect(parsed.fields).toEqual(['Name', 'Role', 'Rev'])
    expect(parsed.records).toHaveLength(2)
    const coll = collections.create('Team', parsed.fields, parsed.records, {
      kind: 'xlsx-range', filePath: src, sheet: 'Sheet1', ref: 'A1:C3',
    })

    // A docx link with a RE-ORDERED, RE-HEADED mapping (Rev→"Revenue", then Name).
    const TAG = 'wos-collection-team1'
    const docColumns = [
      { field: 'Rev', header: 'Revenue' },
      { field: 'Name', header: 'Person' },
    ]
    const docx = await makeDocx('summary.docx', TAG)
    const docGrid = renderMapping(coll.fields, coll.records, docColumns)
    links.add({ collectionId: coll.id, filePath: docx, target: { kind: 'docx-table', tag: TAG }, columns: docColumns, lastGrid: [[null, null], [null, null], [null, null]] })

    // An xlsx block link with the FULL identity mapping (3 columns).
    const xlColumns = coll.fields.map((f) => ({ field: f, header: f }))
    const dst = await makeSource('deck.xlsx') // a spreadsheet to receive the block at F1
    links.add({ collectionId: coll.id, filePath: dst, target: { kind: 'xlsx-block', sheet: 'Sheet1', cell: 'F1' }, columns: xlColumns, lastGrid: [[null, null, null], [null, null, null], [null, null, null]] })

    // Replay the sync-all handler loop (no open file).
    const plan = planCollectionSyncAll(links.forCollection(coll.id), collections.get(coll.id)!, null)
    expect(plan.toWrite).toHaveLength(2)
    for (const { link, grid } of plan.toWrite) {
      const res =
        link.target.kind === 'xlsx-block'
          ? await setRangeValues(link.filePath, link.target.sheet, link.target.cell, grid)
          : await setDocTableCells(link.filePath, (link.target as { tag: string }).tag, grid)
      expect(res.ok).toBe(true)
      links.add({ collectionId: link.collectionId, filePath: link.filePath, target: link.target, columns: link.columns, lastGrid: grid })
    }

    // ---- ASSERT the DOCX: unzip and check mapped headers + each record row ----
    const xml = await docXmlOf(docx)
    // Header row rendered in the MAPPED order (Revenue, Person).
    expect(xml).toContain('>Revenue<')
    expect(xml).toContain('>Person<')
    // Record 1: Ana / 120 → rendered as (120, Ana) per the mapping.
    expect(xml).toContain('>120<')
    expect(xml).toContain('>Ana<')
    // Record 2: Bo / 90 → (90, Bo).
    expect(xml).toContain('>90<')
    expect(xml).toContain('>Bo<')
    // Old placeholder cell text is gone; the anchor survives.
    expect(xml).not.toContain('>H1<')
    expect(xml).toContain(`w:name="${TAG}"`)
    expect(docGrid).toEqual([['Revenue', 'Person'], [120, 'Ana'], [90, 'Bo']])

    // ---- ASSERT the XLSX block: full identity mapping landed at F1 ----
    expect(await readBack(dst, 'F1')).toBe('Name')
    expect(await readBack(dst, 'H1')).toBe('Rev')
    expect(await readBack(dst, 'F2')).toBe('Ana')
    expect(await readBack(dst, 'H2')).toBe(120)
    expect(await readBack(dst, 'F3')).toBe('Bo')
    expect(await readBack(dst, 'H3')).toBe(90)
  })

  it('re-sync: a source edit propagates fresh records into the docx table', async () => {
    const src = await makeSource('src.xlsx')
    const collections = new CollectionStore(() => p('collections.json'))
    const links = new CollectionLinkStore(() => p('links.json'))
    const read = await readRange(src, 'Sheet1', 'A1:C3')
    const parsed = gridToRecords(read.values!)!
    const coll = collections.create('Team', parsed.fields, parsed.records, {
      kind: 'xlsx-range', filePath: src, sheet: 'Sheet1', ref: 'A1:C3',
    })

    const TAG = 'wos-collection-team2'
    const columns = coll.fields.map((f) => ({ field: f, header: f }))
    const docx = await makeDocx3col('report.docx', TAG)
    const first = renderMapping(coll.fields, coll.records, columns)
    let res = await setDocTableCells(docx, TAG, first)
    expect(res.ok).toBe(true)
    links.add({ collectionId: coll.id, filePath: docx, target: { kind: 'docx-table', tag: TAG }, columns, lastGrid: first })
    expect(await docXmlOf(docx)).toContain('>120<')

    // Edit the SOURCE on disk: Ana's Rev 120 → 500.
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(src)
    wb.getWorksheet('Sheet1')!.getCell('C2').value = 500
    await wb.xlsx.writeFile(src)

    // Refresh the collection from source, then re-sync the docx.
    const plan = planCollectionRefresh(collections.get(coll.id)!, await readRange(src, 'Sheet1', 'A1:C3'))
    expect(plan.status).toBe('updated')
    collections.update(coll.id, { fields: plan.fields, records: plan.records })

    const syncPlan = planCollectionSyncAll(links.forCollection(coll.id), collections.get(coll.id)!, null)
    expect(syncPlan.toWrite).toHaveLength(1) // drifted
    res = await setDocTableCells(docx, TAG, syncPlan.toWrite[0].grid)
    expect(res.ok).toBe(true)

    const xml = await docXmlOf(docx)
    expect(xml).toContain('>500<') // fresh value landed
    expect(xml).not.toContain('>120<') // old value gone
    expect(xml).toContain(`w:name="${TAG}"`)
  })

  it('fail-safe: an unreadable source keeps the last records (stale, never blank)', async () => {
    const src = await makeSource('src.xlsx')
    const collections = new CollectionStore(() => p('collections.json'))
    const read = await readRange(src, 'Sheet1', 'A1:C3')
    const parsed = gridToRecords(read.values!)!
    const coll = collections.create('Team', parsed.fields, parsed.records, {
      kind: 'xlsx-range', filePath: src, sheet: 'Sheet1', ref: 'A1:C3',
    })
    fs.rmSync(src) // delete the source
    const plan = planCollectionRefresh(collections.get(coll.id)!, await readRange(src, 'Sheet1', 'A1:C3'))
    expect(plan.status).toBe('stale')
    expect(plan.records).toEqual(coll.records) // cache preserved, not blanked
  })

  /** A 3-col-wide 3-row .docx table (header + 2 record rows). */
  async function makeDocx3col(name: string, tag: string): Promise<string> {
    const row = (a: string, b: string, c: string): string =>
      `<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>${a}</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:tcPr/><w:p><w:r><w:t>${b}</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:tcPr/><w:p><w:r><w:t>${c}</w:t></w:r></w:p></w:tc></w:tr>`
    const docXml =
      '<w:document><w:body>' +
      `<w:bookmarkStart w:id="1" w:name="${tag}"/><w:bookmarkEnd w:id="1"/>` +
      '<w:tbl><w:tblPr/>' +
      row('h1', 'h2', 'h3') + row('a', 'b', 'c') + row('d', 'e', 'f') +
      '</w:tbl></w:body></w:document>'
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types/>')
    zip.file('word/document.xml', docXml)
    const file = p(name)
    fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
    return file
  }
})
