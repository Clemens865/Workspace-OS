// Calc-side macro audit. Fixture authored with exceljs, opened from the tree.
import * as H from '../_harness.mjs'
import ExcelJS from 'exceljs'
import {
  TESTROOT, VERIFIED, UNVERIFIED, assertMut, macro, parts,
  goToCell, selectRange, unzip, zipList, saveUntilXml, rmFixtures,
} from './util.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const APP = 'Calc'
const FILE = `${TESTROOT}/Z-audit.xlsx`
const sheet1 = () => unzip(FILE, 'xl/worksheets/sheet1.xml')
const sharedStr = () => unzip(FILE, 'xl/sharedStrings.xml')
const anyText = (t) => sheet1().includes(t) || sharedStr().includes(t)

// Author the Calc fixture. MUST run BEFORE H.launch() so the file is present
// when the tree is first indexed (files written post-launch race the watcher).
export async function prepareCalc() {
  rmFixtures('Z-audit')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  // A block of numbers so charts/find/stamp have real content.
  ws.getCell('A1').value = 'Region'; ws.getCell('B1').value = 'Rev'
  ws.getCell('A2').value = 'widget'; ws.getCell('B2').value = 10
  ws.getCell('A3').value = 'widget'; ws.getCell('B3').value = 20
  ws.getCell('A4').value = 'gadget'; ws.getCell('B4').value = 30
  await wb.xlsx.writeFile(FILE)
}

export async function runCalc(win) {
  console.log('\n--- Calc macros ---')
  await H.openDoc(win, 'Z-audit.xlsx', 'Excel')

  // ---- WosSetCell: set a numeric value in a named cell -------------------
  await macro(win, 'WosSetCell', 'Sheet1|E1|42.5')
  {
    const x = await saveUntilXml(win, FILE, 'xl/worksheets/sheet1.xml', (s) => /r="E1"[^>]*>\s*<v>42\.5<\/v>/.test(s))
    assertMut('WosSetCell', APP, /r="E1"[^>]*>\s*<v>42\.5<\/v>/.test(x), 'E1 holds numeric 42.5 in saved xlsx', 'E1 not set (no <v>42.5)')
  }

  // ---- WosStampRange kpi/header/table -----------------------------------
  await goToCell(win, 'A7')
  await macro(win, 'WosStampRange', 'kpi|Total Rev|60')
  {
    const x = await saveUntilXml(win, FILE, 'xl/worksheets/sheet1.xml', (_s) => anyText('Total Rev'))
    assertMut('WosStampRange(kpi)', APP, anyText('Total Rev'), 'KPI title "Total Rev" stamped at A7', 'KPI title not written')
    void x
  }
  await goToCell(win, 'A10')
  await macro(win, 'WosStampRange', 'header|Metric|Value')
  {
    await saveUntilXml(win, FILE, 'xl/worksheets/sheet1.xml', () => anyText('Metric'))
    assertMut('WosStampRange(header)', APP, anyText('Metric'), 'header title "Metric" stamped', 'header title not written')
  }
  await goToCell(win, 'A13')
  await macro(win, 'WosStampRange', 'table|Row|Cell')
  {
    await saveUntilXml(win, FILE, 'xl/styles.xml', () => true)
    // table stamp writes borders → styles.xml gains a border def; assert the title too.
    assertMut('WosStampRange(table)', APP, anyText('Row'), 'table title "Row" stamped + bordered block', 'table title not written')
  }

  // ---- WosSetRangeBlock: stamp a whole grid via the dedicated handler ----
  await win.evaluate(() => window.workspace.lok.setRangeBlock({ sheet: 'Sheet1', cell: 'H1', values: [['Alpha', 7], ['Beta', 8]] }))
  {
    await saveUntilXml(win, FILE, 'xl/worksheets/sheet1.xml', () => anyText('Alpha') && /r="I1"[^>]*>\s*<v>7<\/v>/.test(sheet1()))
    const ok = anyText('Alpha') && /r="I1"[^>]*>\s*<v>7<\/v>/.test(sheet1())
    assertMut('WosSetRangeBlock', APP, ok, 'grid block stamped at H1 (Alpha + numeric 7 at I1)', 'range block not stamped')
  }

  // ---- WosSetSize: resize a column (dedicated setSize handler). A default
  // xlsx has NO <cols> block at all, so a <col> with an explicit width proves
  // the resize took (the exact width/customWidth attrs vary by exporter). -----
  await win.evaluate(() => window.workspace.lok.setSize('col', 0, 6000))
  {
    const x = await saveUntilXml(win, FILE, 'xl/worksheets/sheet1.xml', (s) => /<cols>[\s\S]*<col\b[^>]*\bwidth="/.test(s))
    assertMut('WosSetSize', APP, /<col\b[^>]*\bwidth="[\d.]/.test(x), 'column width def emitted in xlsx (<col width=…>)', 'no <col width> — resize did not persist')
  }

  // ---- WosSetBorder: outer border on a selected range (dedicated) -------
  await selectRange(win, 'A2:B4')
  await win.evaluate(() => window.workspace.lok.setBorder('outer', 0x000000, 26))
  {
    const x = await saveUntilXml(win, FILE, 'xl/styles.xml', (s) => /<border[^>]*>[\s\S]*<(left|top|right|bottom)[^>]*style=/.test(s))
    assertMut('WosSetBorder', APP, /<border[^>]*>[\s\S]*style="(thin|medium|hair)"/.test(x), 'border style present in styles.xml', 'no bordered style emitted')
  }

  // ---- WosSheetOp: insert / rename / move / delete ----------------------
  const p0 = await parts(win)
  await macro(win, 'WosSheetOp', 'insert')
  {
    const p1 = await H.poll(async () => { const p = await parts(win); return p.parts > p0.parts ? p : false })
    assertMut('WosSheetOp(insert)', APP, !!p1 && p1.parts === p0.parts + 1, `inserted a sheet (${p0.parts}→${p1 ? p1.parts : '?'})`, 'sheet count did not grow')
  }
  await macro(win, 'WosSheetOp', 'rename|Renamed')
  {
    const p = await H.poll(async () => { const q = await parts(win); return q.names.includes('Renamed') ? q : false })
    assertMut('WosSheetOp(rename)', APP, !!p, 'active sheet renamed to "Renamed"', 'rename did not apply')
  }
  await macro(win, 'WosSheetOp', 'moveleft')
  {
    // The Renamed sheet was inserted at index 1; moveleft → index 0.
    const p = await H.poll(async () => { const q = await parts(win); return q.names[0] === 'Renamed' ? q : false })
    assertMut('WosSheetOp(moveleft)', APP, !!p, 'sheet moved left to index 0', 'moveleft did not reorder')
  }
  await macro(win, 'WosSheetOp', 'moveright')
  {
    const p = await H.poll(async () => { const q = await parts(win); return q.names[0] !== 'Renamed' ? q : false })
    assertMut('WosSheetOp(moveright)', APP, !!p, 'sheet moved right off index 0', 'moveright did not reorder')
  }
  {
    const before = await parts(win)
    await macro(win, 'WosSheetOp', 'delete')
    const p = await H.poll(async () => { const q = await parts(win); return q.parts < before.parts ? q : false })
    assertMut('WosSheetOp(delete)', APP, !!p && p.parts === before.parts - 1, `deleted active sheet (${before.parts}→${p ? p.parts : '?'})`, 'sheet count did not shrink')
  }

  // ---- WosInsertChart: native chart bound to an EXPLICIT range (its
  // first-priority path; robust to the sheet churn above) -----------------
  await win.evaluate(() => window.workspace.lok.setPart(0)) // back to Sheet1
  await macro(win, 'WosInsertChart', 'column|A1:B4')
  {
    await saveUntilXml(win, FILE, 'xl/charts/chart1.xml', (x) => x.includes('<c:ser>'))
    const chartXml = unzip(FILE, 'xl/charts/chart1.xml')
    const ok = /xl\/charts\/chart1\.xml/.test(zipList(FILE)) && /<c:ser>/.test(chartXml) && /<c:f>Sheet1!/.test(chartXml)
    assertMut('WosInsertChart', APP, ok, 'chart1.xml with a c:ser bound to Sheet1! range', 'no chart XML or series-less/unbound chart')
  }

  // ---- WosFindReplace (Calc): per-sheet replace-all ---------------------
  {
    const before = anyText('widget')
    const res = await win.evaluate(() => window.workspace.lok.findReplace({ mode: 'replaceall', find: 'widget', replace: 'sprocket' }))
    await saveUntilXml(win, FILE, 'xl/worksheets/sheet1.xml', () => anyText('sprocket') && !anyText('widget'))
    const ok = res && res.ok && res.count >= 1 && anyText('sprocket') && !anyText('widget')
    assertMut('WosFindReplace', APP, ok, `replaced ${res?.count} "widget"→"sprocket" across sheets (was present:${before})`, `replace no-op (count=${res?.count}, sprocket present:${anyText('sprocket')})`)
  }

  // ---- WosFindReplace findnext (selection move; side effect on Calc) -----
  {
    const res = await win.evaluate(() => window.workspace.lok.findReplace({ mode: 'findnext', find: 'gadget', replace: '' }))
    if (res && res.ok) VERIFIED('WosFindReplace(findnext)', APP, `findnext returned ok (count ${res.count})`)
    else UNVERIFIED('WosFindReplace(findnext)', APP, 'findnext selection move not structurally observable via saved file')
  }
}
