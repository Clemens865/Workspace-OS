// e2e harness (bundled by esbuild, run under plain node) — exercises the ACTUAL
// collection modules against REAL files, engine-free. electron is external and
// dead here (we build our own stores). Prints a JSON verdict on stdout.
import fs from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { readRange } from '../../src/main/xlsx-range-reader'
import { setRangeValues } from '../../src/main/xlsx-range-writer'
import { setDocTableCells } from '../../src/main/docx-table-writer'
import { CollectionStore, gridToRecords, planCollectionRefresh } from '../../src/main/collections'
import { CollectionLinkStore, planCollectionSyncAll, renderMapping, applyView } from '../../src/main/collectionLinks'

const DIR = process.env.WOS_E2E_DIR as string
const p = (n: string): string => path.join(DIR, n)
const results: { name: string; ok: boolean; detail?: string }[] = []
const ok = (name: string, cond: boolean, detail = ''): void => {
  results.push({ name, ok: cond, detail: cond ? undefined : detail })
}

async function docXml(file: string): Promise<string> {
  const zip = await JSZip.loadAsync(fs.readFileSync(file))
  return zip.file('word/document.xml')!.async('string')
}
async function readBack(file: string, cell: string): Promise<unknown> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  return wb.getWorksheet('Sheet1')!.getCell(cell).value
}
async function makeSource(name: string): Promise<string> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  ws.getCell('A1').value = 'Name'; ws.getCell('B1').value = 'Rev'
  ws.getCell('A2').value = 'Ana'; ws.getCell('B2').value = 120
  ws.getCell('A3').value = 'Bo'; ws.getCell('B3').value = 90
  const f = p(name); await wb.xlsx.writeFile(f); return f
}
async function makeDocx(name: string, tag: string): Promise<string> {
  const row = (a: string, b: string): string =>
    `<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>${a}</w:t></w:r></w:p></w:tc>` +
    `<w:tc><w:tcPr/><w:p><w:r><w:t>${b}</w:t></w:r></w:p></w:tc></w:tr>`
  const xml = '<w:document><w:body>' +
    `<w:bookmarkStart w:id="1" w:name="${tag}"/><w:bookmarkEnd w:id="1"/>` +
    '<w:tbl><w:tblPr/>' + row('h1', 'h2') + row('a', 'b') + row('c', 'd') + '</w:tbl>' +
    '</w:body></w:document>'
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types/>')
  zip.file('word/document.xml', xml)
  const f = p(name)
  fs.writeFileSync(f, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  return f
}

/** A 4-record source with a numeric "revenue" + a "status" field (for VIEWS). */
async function makeViewSource(name: string): Promise<string> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  ws.getCell('A1').value = 'Name'; ws.getCell('B1').value = 'status'; ws.getCell('C1').value = 'revenue'
  ws.getCell('A2').value = 'Ana'; ws.getCell('B2').value = 'active'; ws.getCell('C2').value = 120
  ws.getCell('A3').value = 'Bo'; ws.getCell('B3').value = 'inactive'; ws.getCell('C3').value = 90
  ws.getCell('A4').value = 'Cy'; ws.getCell('B4').value = 'active'; ws.getCell('C4').value = 300
  ws.getCell('A5').value = 'Di'; ws.getCell('B5').value = 'active'; ws.getCell('C5').value = 200
  const f = p(name); await wb.xlsx.writeFile(f); return f
}

/** A .docx with a bookmark-anchored table of `rows` rows × `cols` cols. */
async function makeDocxSized(name: string, tag: string, rows: number, cols: number): Promise<string> {
  const tr = (r: number): string => {
    const cells = Array.from({ length: cols }, (_, c) =>
      `<w:tc><w:tcPr/><w:p><w:r><w:t>ph${r}-${c}</w:t></w:r></w:p></w:tc>`).join('')
    return `<w:tr>${cells}</w:tr>`
  }
  const body = Array.from({ length: rows }, (_, r) => tr(r)).join('')
  const xml = '<w:document><w:body>' +
    `<w:bookmarkStart w:id="1" w:name="${tag}"/><w:bookmarkEnd w:id="1"/>` +
    '<w:tbl><w:tblPr/>' + body + '</w:tbl>' +
    '</w:body></w:document>'
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types/>')
  zip.file('word/document.xml', xml)
  const f = p(name)
  fs.writeFileSync(f, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  return f
}

async function main(): Promise<void> {
  const src = await makeSource('src.xlsx')
  const collections = new CollectionStore(() => p('collections.json'))
  const links = new CollectionLinkStore(() => p('links.json'))

  // 1) create-from-source: real block → fields (row 0) + records.
  const read = await readRange(src, 'Sheet1', 'A1:B3')
  const parsed = gridToRecords(read.values!)!
  ok('create: fields are the header row', JSON.stringify(parsed.fields) === JSON.stringify(['Name', 'Rev']), JSON.stringify(parsed.fields))
  ok('create: two records read', parsed.records.length === 2, String(parsed.records.length))
  const coll = collections.create('Team', parsed.fields, parsed.records, { kind: 'xlsx-range', filePath: src, sheet: 'Sheet1', ref: 'A1:B3' })

  // 2) bind a docx table (identity mapping) + an xlsx block, then sync.
  const TAG = 'wos-collection-e2e1'
  const columns = coll.fields.map((f) => ({ field: f, header: f }))
  const docx = await makeDocx('report.docx', TAG)
  const dst = await makeSource('deck.xlsx')
  links.add({ collectionId: coll.id, filePath: docx, target: { kind: 'docx-table', tag: TAG }, columns, lastGrid: [[null, null], [null, null], [null, null]] })
  links.add({ collectionId: coll.id, filePath: dst, target: { kind: 'xlsx-block', sheet: 'Sheet1', cell: 'D1' }, columns, lastGrid: [[null, null], [null, null], [null, null]] })

  const plan = planCollectionSyncAll(links.forCollection(coll.id), collections.get(coll.id)!, null)
  ok('sync: two closed files to write', plan.toWrite.length === 2, String(plan.toWrite.length))
  for (const { link, grid } of plan.toWrite) {
    const res = link.target.kind === 'xlsx-block'
      ? await setRangeValues(link.filePath, link.target.sheet, link.target.cell, grid)
      : await setDocTableCells(link.filePath, (link.target as { tag: string }).tag, grid)
    ok(`sync: wrote ${path.basename(link.filePath)}`, res.ok === true, JSON.stringify(res))
    links.add({ collectionId: link.collectionId, filePath: link.filePath, target: link.target, columns: link.columns, lastGrid: grid })
  }

  // 3) UNZIP the docx: assert headers + each record row landed.
  const xml = await docXml(docx)
  ok('docx: header Name present', xml.includes('>Name<'))
  ok('docx: header Rev present', xml.includes('>Rev<'))
  ok('docx: record Ana present', xml.includes('>Ana<'))
  ok('docx: record 120 present', xml.includes('>120<'))
  ok('docx: record Bo present', xml.includes('>Bo<'))
  ok('docx: placeholder h1 gone', !xml.includes('>h1<'))
  ok('docx: anchor survives', xml.includes(`w:name="${TAG}"`))

  // 3b) READ BACK the xlsx block at D1.
  ok('xlsx: D1 header Name', (await readBack(dst, 'D1')) === 'Name')
  ok('xlsx: E1 header Rev', (await readBack(dst, 'E1')) === 'Rev')
  ok('xlsx: D2 Ana', (await readBack(dst, 'D2')) === 'Ana')
  ok('xlsx: E3 90', (await readBack(dst, 'E3')) === 90)

  // 4) change the source, refresh, re-sync → fresh record propagates.
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(src)
  wb.getWorksheet('Sheet1')!.getCell('B2').value = 777
  await wb.xlsx.writeFile(src)
  const refresh = planCollectionRefresh(collections.get(coll.id)!, await readRange(src, 'Sheet1', 'A1:B3'))
  ok('refresh: source change detected (updated)', refresh.status === 'updated', refresh.status)
  collections.update(coll.id, { fields: refresh.fields, records: refresh.records })
  const plan2 = planCollectionSyncAll(links.forCollection(coll.id), collections.get(coll.id)!, null)
  ok('re-sync: docx drifted → to-write', plan2.toWrite.some((a) => a.link.filePath === docx))
  const drift = plan2.toWrite.find((a) => a.link.filePath === docx)!
  const res2 = await setDocTableCells(docx, TAG, drift.grid)
  ok('re-sync: docx write ok', res2.ok === true, JSON.stringify(res2))
  const xml2 = await docXml(docx)
  ok('re-sync: fresh value 777 landed', xml2.includes('>777<'))
  ok('re-sync: old value 120 gone', !xml2.includes('>120<'))

  // Render sanity: the mapping produces header + a row per record.
  const rendered = renderMapping(coll.fields, collections.get(coll.id)!.records, columns)
  ok('render: header + 2 record rows', rendered.length === 3 && rendered[0].length === 2, JSON.stringify(rendered))

  // ============================================================================
  // 5) LIVE VIEWS — a bound block becomes a live QUERY (filter/sort/limit).
  // ============================================================================
  const vsrc = await makeViewSource('view-src.xlsx')
  const vread = await readRange(vsrc, 'Sheet1', 'A1:C5')
  const vparsed = gridToRecords(vread.values!)!
  ok('view: source has 4 records', vparsed.records.length === 4, String(vparsed.records.length))
  const vcoll = collections.create('Customers', vparsed.fields, vparsed.records, {
    kind: 'xlsx-range', filePath: vsrc, sheet: 'Sheet1', ref: 'A1:C5',
  })

  // 5a) VIEW: sort revenue desc, limit 2 — bind a 2-col docx table sized to
  // header + 2 record rows (Name, revenue). Expect ONLY Cy(300) & Di(200).
  const VTAG = 'wos-collection-view1'
  const vcols = [{ field: 'Name', header: 'Name' }, { field: 'revenue', header: 'Revenue' }]
  const vdocx = await makeDocxSized('top2.docx', VTAG, 3, 2) // header + 2 rows
  const topView = { sort: [{ field: 'revenue', dir: 'desc' as const }], limit: 2 }
  links.add({ collectionId: vcoll.id, filePath: vdocx, target: { kind: 'docx-table', tag: VTAG }, columns: vcols, view: topView, lastGrid: [[null, null], [null, null], [null, null]] })

  const vplan = planCollectionSyncAll(links.forCollection(vcoll.id), collections.get(vcoll.id)!, null)
  const vaction = vplan.toWrite.find((a) => a.link.filePath === vdocx)!
  ok('view: planned grid is header + top-2 (3 rows)', vaction.grid.length === 3, String(vaction.grid.length))
  const vres = await setDocTableCells(vdocx, VTAG, vaction.grid)
  ok('view: docx write ok', vres.ok === true, JSON.stringify(vres))
  const vxml = await docXml(vdocx)
  // Top-2 by revenue desc: Cy (300) then Di (200) — both present.
  ok('view: top1 Cy present', vxml.includes('>Cy<'))
  ok('view: top1 revenue 300 present', vxml.includes('>300<'))
  ok('view: top2 Di present', vxml.includes('>Di<'))
  ok('view: top2 revenue 200 present', vxml.includes('>200<'))
  // 3rd & 4th (Ana 120, Bo 90) are ABSENT — the limit cut them.
  ok('view: 3rd record Ana absent', !vxml.includes('>Ana<'))
  ok('view: 3rd revenue 120 absent', !vxml.includes('>120<'))
  ok('view: 4th record Bo absent', !vxml.includes('>Bo<'))
  ok('view: 4th revenue 90 absent', !vxml.includes('>90<'))
  // Cy must precede Di in the document (descending order landed in order).
  ok('view: Cy precedes Di (desc order)', vxml.indexOf('>Cy<') < vxml.indexOf('>Di<'))

  // 5b) Change the SOURCE so a DIFFERENT record becomes top-2, refresh, re-sync.
  // Bump Ana's revenue 120 → 999 (now the top) and Bo 90 → 950 (now #2). The new
  // top-2 must be Ana & Bo; Cy/Di must now be gone.
  const vwb = new ExcelJS.Workbook()
  await vwb.xlsx.readFile(vsrc)
  vwb.getWorksheet('Sheet1')!.getCell('C2').value = 999 // Ana
  vwb.getWorksheet('Sheet1')!.getCell('C3').value = 950 // Bo
  await vwb.xlsx.writeFile(vsrc)
  const vrefresh = planCollectionRefresh(collections.get(vcoll.id)!, await readRange(vsrc, 'Sheet1', 'A1:C5'))
  ok('view re-sync: source change detected', vrefresh.status === 'updated', vrefresh.status)
  collections.update(vcoll.id, { fields: vrefresh.fields, records: vrefresh.records })
  const vplan2 = planCollectionSyncAll(links.forCollection(vcoll.id), collections.get(vcoll.id)!, null)
  const vaction2 = vplan2.toWrite.find((a) => a.link.filePath === vdocx)!
  const vres2 = await setDocTableCells(vdocx, VTAG, vaction2.grid)
  ok('view re-sync: docx write ok', vres2.ok === true, JSON.stringify(vres2))
  const vxml2 = await docXml(vdocx)
  ok('view re-sync: new top Ana present', vxml2.includes('>Ana<'))
  ok('view re-sync: new top revenue 999 present', vxml2.includes('>999<'))
  ok('view re-sync: new #2 Bo present', vxml2.includes('>Bo<'))
  ok('view re-sync: new #2 revenue 950 present', vxml2.includes('>950<'))
  ok('view re-sync: old top Cy gone', !vxml2.includes('>Cy<'))
  ok('view re-sync: old #2 Di gone', !vxml2.includes('>Di<'))
  ok('view re-sync: Ana precedes Bo (999 > 950)', vxml2.indexOf('>Ana<') < vxml2.indexOf('>Bo<'))

  // 5c) FILTER VIEW: status == active writes ONLY active rows (Ana, Cy, Di), not
  // Bo. After 5b the records are Ana(999,active), Bo(950,inactive), Cy(300,active),
  // Di(200,active) → 3 active rows. Bind a 3-col docx sized to header + 3 rows.
  const FTAG = 'wos-collection-view2'
  const fcols = [
    { field: 'Name', header: 'Name' },
    { field: 'status', header: 'Status' },
    { field: 'revenue', header: 'Revenue' },
  ]
  const activeCount = applyView(collections.get(vcoll.id)!.records, { filters: [{ field: 'status', op: 'eq', value: 'active' }] }).length
  ok('filter: three active records', activeCount === 3, String(activeCount))
  const fdocx = await makeDocxSized('active.docx', FTAG, activeCount + 1, 3) // header + active rows
  const filterView = { filters: [{ field: 'status', op: 'eq' as const, value: 'active' }] }
  links.add({ collectionId: vcoll.id, filePath: fdocx, target: { kind: 'docx-table', tag: FTAG }, columns: fcols, view: filterView, lastGrid: Array.from({ length: activeCount + 1 }, () => [null, null, null]) })
  const fplan = planCollectionSyncAll(links.forCollection(vcoll.id), collections.get(vcoll.id)!, null)
  const faction = fplan.toWrite.find((a) => a.link.filePath === fdocx)!
  const fres = await setDocTableCells(fdocx, FTAG, faction.grid)
  ok('filter: docx write ok', fres.ok === true, JSON.stringify(fres))
  const fxml = await docXml(fdocx)
  ok('filter: active Ana present', fxml.includes('>Ana<'))
  ok('filter: active Cy present', fxml.includes('>Cy<'))
  ok('filter: active Di present', fxml.includes('>Di<'))
  ok('filter: inactive Bo absent', !fxml.includes('>Bo<'))
  ok('filter: no inactive status cell', !fxml.includes('>inactive<'))

  process.stdout.write(JSON.stringify(results))
}

main().catch((e) => {
  process.stdout.write(JSON.stringify([{ name: 'harness threw', ok: false, detail: String(e?.stack || e) }]))
})
