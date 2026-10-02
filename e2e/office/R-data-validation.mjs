// Phase R — Calc data validation through the REAL engine.
//
// A real .xlsx fixture (A1..A6 = 10/20/30/40/50/60) is authored with exceljs and
// OPENED from the file tree (the proven G/J/M/D render path — the New-doc menu
// races the ~27s engine cold boot on this machine). The WosDataValidation macro
// is then driven exactly as the product wires it (window.workspace.lok.macro),
// the doc saved via window.workspace.lok.save(), and the SAVED .xlsx unzipped to
// prove the rule is really there: xl/worksheets/sheet1.xml carries
// <dataValidations><dataValidation type="…" sqref="…"><formula1>…</formula1>.
// ok:true is NOT proof — every assertion below reads the bytes on disk.
import * as H from './_harness.mjs'
import { execSync } from 'child_process'
import fs from 'fs'
import ExcelJS from 'exceljs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const r = H.makeReporter('PHASE R — Calc data validation')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const FILE = '/tmp/wos-test/R-data-validation.xlsx'
for (const f of fs.readdirSync('/tmp/wos-test')) if (f.startsWith('.~lock') || f.startsWith('R-data-validation')) fs.rmSync('/tmp/wos-test/' + f, { force: true })

// Author the fixture: A1..A6 = 10..60 (numbers) — a benign grid for validation.
{
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  for (let i = 1; i <= 6; i++) ws.getCell(`A${i}`).value = i * 10
  await wb.xlsx.writeFile(FILE)
}

const sheetXml = () => { try { return execSync(`unzip -p '${FILE}' xl/worksheets/sheet1.xml`, { encoding: 'utf8' }) } catch { return '' } }

const { app, win } = await H.launch()
await H.openDoc(win, 'R-data-validation.xlsx', 'Excel')
r.ok(await win.getByRole('button', { name: 'Data', exact: true }).first().isVisible().catch(() => false), 'Calc ribbon loaded')
r.ok(sheetXml().includes('>10<') && sheetXml().includes('>60<'), 'fixture values present (10..60)')

// Selects a range then runs WosDataValidation with the given kind/args. The macro
// applies to CurrentController.getSelection().
const selectRange = (a1) => win.evaluate((a) => window.workspace.lok.uno(`.uno:GoToCell {"ToPoint":{"type":"string","value":"$Sheet1.${a}"}}`), a1)
const runDv = (args) => win.evaluate((a) => window.workspace.lok.macro('WosDataValidation', a), args)
const save = () => win.evaluate(() => window.workspace.lok.save())

// --- Rule 1: LIST dropdown (Yes,No,Maybe) on B1:B3 ---
await selectRange('B1:B3'); await win.waitForTimeout(300)
await runDv('list|Yes,No,Maybe|'); await win.waitForTimeout(300)
await H.shot(win, 'R-dv-list')
const listOk = await H.poll(async () => { await save(); const x = sheetXml(); return /<dataValidation[^>]*type="list"/.test(x) })
r.ok(listOk, 'LIST validation persisted: <dataValidation type="list">')
{
  const x = sheetXml()
  r.ok(/<dataValidations/i.test(x), 'LIST: <dataValidations> container present')
  // Extract the list dataValidation element and inspect its formula1 + sqref.
  const m = x.match(/<dataValidation[^>]*type="list"[\s\S]*?<\/dataValidation>/)
  const block = m ? m[0] : ''
  const attr = (x.match(/<dataValidation[^>]*type="list"[^>]*>/) || [''])[0]
  r.ok(/Yes/.test(block) && /No/.test(block) && /Maybe/.test(block), 'LIST: formula1 carries the values (Yes/No/Maybe)')
  r.ok(/sqref="[^"]*B1:B3[^"]*"/.test(attr) || /B1:B3/.test(attr), 'LIST: sqref covers the selected range B1:B3')
}

// --- Rule 2: WHOLE-number between 1 and 100 on C1:C3 ---
await selectRange('C1:C3'); await win.waitForTimeout(300)
await runDv('whole|1|100'); await win.waitForTimeout(300)
await H.shot(win, 'R-dv-whole')
const wholeOk = await H.poll(async () => { await save(); const x = sheetXml(); return /<dataValidation[^>]*type="whole"/.test(x) })
r.ok(wholeOk, 'WHOLE-number validation persisted: <dataValidation type="whole">')
{
  const x = sheetXml()
  const m = x.match(/<dataValidation[^>]*type="whole"[\s\S]*?<\/dataValidation>/)
  const block = m ? m[0] : ''
  const attr = (x.match(/<dataValidation[^>]*type="whole"[^>]*>/) || [''])[0]
  r.ok(/operator="between"/.test(attr), 'WHOLE: operator="between"')
  r.ok(/<formula1>\s*1\s*<\/formula1>/.test(block), 'WHOLE: min 1 in <formula1>')
  r.ok(/<formula2>\s*100\s*<\/formula2>/.test(block), 'WHOLE: max 100 in <formula2>')
  r.ok((x.match(/<dataValidation/g) || []).length >= 2, 'both rules coexist (>=2 dataValidation elements)')
}

// --- Clear path: strip validation from the LIST range ---
await selectRange('B1:B3'); await win.waitForTimeout(300)
await runDv('clear||'); await win.waitForTimeout(300)
await H.shot(win, 'R-dv-clear')
const cleared = await H.poll(async () => { await save(); const x = sheetXml(); return !/<dataValidation[^>]*type="list"/.test(x) })
r.ok(cleared, 'clear path removed the LIST validation from B1:B3')

await app.close()
process.exit(r.done() ? 0 : 1)
