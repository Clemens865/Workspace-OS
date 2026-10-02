// Phase D — Calc everyday functions through the ribbon, against the REAL engine.
//
// The doc is authored as a real .xlsx fixture with exceljs and OPENED from the
// file tree (openDoc) — the proven-reliable render path G/J/M depend on. The
// New-document MENU flow cold-boot-races the file write on this machine (~27s
// engine boot), so it's avoided here. Cell values (10/20/30) are baked into the
// fixture; the RIBBON BUTTONS under test (AutoSum, Currency, Wrap text) then act
// on cells positioned deterministically via the engine's .uno:GoToCell. Those
// buttons fire the exact .uno: dispatches the product wires up. Proof: the saved
// .xlsx, unzipped and asserted.
import * as H from './_harness.mjs'
import { execSync } from 'child_process'
import fs from 'fs'
import ExcelJS from 'exceljs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const r = H.makeReporter('PHASE D — Calc everyday')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const FILE = '/tmp/wos-test/D-calc.xlsx'
for (const f of fs.readdirSync('/tmp/wos-test')) if (f.startsWith('.~lock') || f.startsWith('D-calc')) fs.rmSync('/tmp/wos-test/' + f, { force: true })

// Author the fixture: A1..A3 = 10/20/30 (numbers), A4 left empty for the SUM.
{
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  ws.getCell('A1').value = 10; ws.getCell('A2').value = 20; ws.getCell('A3').value = 30
  await wb.xlsx.writeFile(FILE)
}

const { app, win } = await H.launch()
await H.openDoc(win, 'D-calc.xlsx', 'Excel')
r.ok(await win.getByRole('button', { name: 'Data', exact: true }).first().isVisible().catch(() => false), 'Calc ribbon shows Data tab')

const readSheet = () => { try { return execSync(`unzip -p '${FILE}' xl/worksheets/sheet1.xml`, { encoding: 'utf8' }) } catch { return '' } }
const readStyles = () => { try { return execSync(`unzip -p '${FILE}' xl/styles.xml`, { encoding: 'utf8' }) } catch { return '' } }
const goToCell = (addr) => win.evaluate((a) => window.workspace.lok.uno(`.uno:GoToCell {"ToPoint":{"type":"string","value":"$Sheet1.${a}"}}`), addr)

r.ok(readSheet().includes('>10<') && readSheet().includes('>20<') && readSheet().includes('>30<'), 'fixture values present (10/20/30)')

// --- AutoSum into A4 via the ribbon button ---
await goToCell('A4')                    // position the cursor on the empty total cell
await win.waitForTimeout(300)
await win.getByTitle('AutoSum').first().click()   // the real AutoSum ribbon button
await win.waitForTimeout(300)
await win.evaluate(() => window.workspace.lok.uno('.uno:AcceptFormula')).catch(() => {}) // commit the SUM
await win.waitForTimeout(300)
await H.shot(win, 'D-autosum')
await H.poll(async () => {
  await win.evaluate(() => window.workspace.lok.save()); const x = readSheet()
  return /SUM/i.test(x) && x.includes('>60<')
})
let xml = readSheet()
r.ok(/SUM/i.test(xml) && /<f[ >]/.test(xml), 'AutoSum inserted a SUM formula')
r.ok(xml.includes('>60<'), 'SUM computed to 60')

// --- Number format (currency) + wrap text on A1, verified in the saved file ---
await goToCell('A1')
await win.waitForTimeout(300)
await win.getByTitle('Currency').click(); await win.waitForTimeout(300)
await goToCell('A1')
await win.getByTitle('Wrap text').click(); await win.waitForTimeout(300)
await H.shot(win, 'D-format')
await H.poll(async () => { await win.evaluate(() => window.workspace.lok.save()); const s = readStyles(); return /\$/.test(s) && /wrapText="(1|true)"/.test(s) })
const styles = readStyles()
r.ok(/\$/.test(styles), 'currency number format applied (currency code in styles.xml)')
r.ok(/wrapText="(1|true)"/.test(styles), 'wrap text applied')

await app.close()
process.exit(r.done() ? 0 : 1)
