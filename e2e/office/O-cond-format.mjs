// Phase O — Calc conditional formatting through the REAL engine.
//
// A real .xlsx fixture (A1..A6 = 10/20/30/40/50/60) is authored with exceljs and
// OPENED from the file tree (the proven G/J/M/D render path — the New-doc menu
// races the ~27s engine cold boot on this machine). The WosCondFormat macro is
// then driven exactly as the product wires it (window.workspace.lok.macro), the
// doc saved via window.workspace.lok.save(), and the SAVED .xlsx unzipped to
// prove the rule is really there: xl/worksheets/sheet1.xml carries
// <conditionalFormatting> + <cfRule operator="…"> and xl/styles.xml carries the
// referenced <dxf> fill. ok:true is NOT proof — every assertion below reads the
// bytes on disk.
import * as H from './_harness.mjs'
import { execSync } from 'child_process'
import fs from 'fs'
import ExcelJS from 'exceljs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const r = H.makeReporter('PHASE O — Calc conditional formatting')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const FILE = '/tmp/wos-test/O-cond-format.xlsx'
for (const f of fs.readdirSync('/tmp/wos-test')) if (f.startsWith('.~lock') || f.startsWith('O-cond-format')) fs.rmSync('/tmp/wos-test/' + f, { force: true })

// Author the fixture: A1..A6 = 10..60 (numbers) so a >25 rule hits A3..A6 and a
// <25 rule hits A1..A2 — deterministic thresholds for the persisted formula.
{
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  for (let i = 1; i <= 6; i++) ws.getCell(`A${i}`).value = i * 10
  await wb.xlsx.writeFile(FILE)
}

const sheetXml = () => { try { return execSync(`unzip -p '${FILE}' xl/worksheets/sheet1.xml`, { encoding: 'utf8' }) } catch { return '' } }
const stylesXml = () => { try { return execSync(`unzip -p '${FILE}' xl/styles.xml`, { encoding: 'utf8' }) } catch { return '' } }

const { app, win } = await H.launch()
await H.openDoc(win, 'O-cond-format.xlsx', 'Excel')
r.ok(await win.getByRole('button', { name: 'Data', exact: true }).first().isVisible().catch(() => false), 'Calc ribbon loaded')
r.ok(sheetXml().includes('>10<') && sheetXml().includes('>60<'), 'fixture values present (10..60)')

// Selects a range then runs WosCondFormat with the given op/values/color. Color
// 16711680 = red (0xFF0000). The macro applies to CurrentController.getSelection().
const selectRange = (a1) => win.evaluate((a) => window.workspace.lok.uno(`.uno:GoToCell {"ToPoint":{"type":"string","value":"$Sheet1.${a}"}}`), a1)
const runCf = (args) => win.evaluate((a) => window.workspace.lok.macro('WosCondFormat', a), args)
const save = () => win.evaluate(() => window.workspace.lok.save())

// --- Rule 1: greater-than 25, red fill, on A1:A6 ---
await selectRange('A1:A6'); await win.waitForTimeout(300)
await runCf('gt|25||16711680'); await win.waitForTimeout(300)
await H.shot(win, 'O-cf-gt')
const gtOk = await H.poll(async () => { await save(); const x = sheetXml(); return /<conditionalFormatting/i.test(x) && /operator="greaterThan"/.test(x) })
r.ok(gtOk, 'greater-than rule persisted: <conditionalFormatting> + operator="greaterThan"')
{
  const x = sheetXml()
  r.ok(/<cfRule[^>]*type="cellIs"/.test(x), 'greater-than: cfRule is a cellIs rule')
  r.ok(/<formula>\s*25\s*<\/formula>/.test(x), 'greater-than: threshold 25 persisted as the cfRule formula')
  r.ok(/<dxf>/i.test(stylesXml()), 'greater-than: referenced <dxf> exists in styles.xml')
  r.ok(/patternFill|fgColor|bgColor/i.test(stylesXml()), 'greater-than: dxf carries a fill')
}

// --- Rule 2: less-than 25 (a second operator), green fill, on A1:A6 ---
await selectRange('A1:A6'); await win.waitForTimeout(300)
await runCf('lt|25||65280'); await win.waitForTimeout(300)
await H.shot(win, 'O-cf-lt')
const ltOk = await H.poll(async () => { await save(); const x = sheetXml(); return /operator="lessThan"/.test(x) })
r.ok(ltOk, 'less-than rule persisted: operator="lessThan"')
r.ok((sheetXml().match(/<cfRule/g) || []).length >= 2, 'both rules coexist (>=2 cfRule elements)')

// --- Clear path: remove all CF from the selection ---
await selectRange('A1:A6'); await win.waitForTimeout(300)
await runCf('clear|||'); await win.waitForTimeout(300)
await H.shot(win, 'O-cf-clear')
const cleared = await H.poll(async () => { await save(); return !/<conditionalFormatting/i.test(sheetXml()) })
r.ok(cleared, 'clear path removed all <conditionalFormatting> from the sheet')

await app.close()
process.exit(r.done() ? 0 : 1)
