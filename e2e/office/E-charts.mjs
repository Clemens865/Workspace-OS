// Phase E — Persistent native CHARTS (Calc). The definition of done for office
// charts: a chart inserted via the model-API macro (WosInsertChart) must
// round-trip as REAL chart XML in the saved .xlsx — xl/charts/chart1.xml with a
// <c:ser> data series BOUND to the source cell range — and SURVIVE a reopen.
//
// Proof is by unzipping the real .xlsx each phase (never ok:true): the chart
// part exists, a series is bound to Sheet1!$…, the plot type matches
// (column→barChart barDir="col", bar→barDir="bar", line→lineChart,
// pie→pieChart, area→areaChart), and the file stays a valid xlsx. Column is
// proven end to end (insert → reopen in a fresh engine → still a bound chart);
// all five types are proven to persist.
//
// Reliability notes (learned the hard way): (1) author the data files with
// ExcelJS engine-free — creating a doc via "New document" and then relaunching
// hit an alternating read-only engine race that silently dropped the edits;
// (2) open the pre-authored file through the tree and wait on the ENGINE
// (parts>0), not a painted canvas; (3) give each type its own file so a reused
// path never yields a stale chart part; (4) poll SAVE until <c:ser> is on disk
// (the embedded chart flushes a beat after the macro returns).
import * as H from './_harness.mjs'
import { execSync } from 'child_process'
import fs from 'fs'
import ExcelJS from 'exceljs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const r = H.makeReporter('PHASE E — Persistent charts (Calc)')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const chartXml = (f) => { try { return execSync(`unzip -p '${f}' xl/charts/chart1.xml`, { encoding: 'utf8' }) } catch { return '' } }
const chartPartExists = (f) => { try { execSync(`unzip -p '${f}' xl/charts/chart1.xml > /dev/null 2>&1`, { stdio: 'ignore' }); return true } catch { return false } }
const validXlsx = (f) => { try { execSync(`unzip -t '${f}'`, { stdio: 'ignore' }); return true } catch { return false } }

/** Writes a fresh A1:B4 numeric data file (engine-free — always deterministic). */
async function authorDataFile(file) {
  try { fs.rmSync(file) } catch { /* none */ }
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  const vals = [[10, 15], [20, 25], [30, 35], [25, 20]]
  vals.forEach((row, i) => { ws.getCell(`A${i + 1}`).value = row[0]; ws.getCell(`B${i + 1}`).value = row[1] })
  await wb.xlsx.writeFile(file)
}

/** Opens `fileName` from the tree and waits until the ENGINE reports a doc. */
async function openInEngine(win, fileName) {
  await win.getByText(fileName).first().click()
  for (let i = 0; i < 120; i++) {
    const p = await win.evaluate(() => window.workspace.lok.parts()).catch(() => null)
    if (p && p.parts > 0) { await win.waitForTimeout(700); return true }
    await win.waitForTimeout(400)
  }
  return false
}

/** Runs the chart macro over `range`, then SAVE-polls until the chart part is
 * fully written (valid zip + a bound <c:ser>). Returns the chart XML. */
async function insertChartAndSave(win, file, ctype, range = 'A1:B4') {
  await win.evaluate(({ ctype, range }) => window.workspace.lok.macro('WosInsertChart', `${ctype}|${range}`), { ctype, range })
  await H.poll(async () => {
    await win.evaluate(() => window.workspace.lok.save())
    await win.waitForTimeout(500)
    return validXlsx(file) && chartPartExists(file) && chartXml(file).includes('<c:ser>')
  }, { timeout: 30000, interval: 700 })
  return chartXml(file)
}

const CASES = [
  { t: 'column', assert: (x) => x.includes('<c:barChart>') && /barDir val="col"/.test(x), label: 'barChart barDir="col"' },
  { t: 'bar', assert: (x) => x.includes('<c:barChart>') && /barDir val="bar"/.test(x), label: 'barChart barDir="bar"' },
  { t: 'line', assert: (x) => x.includes('<c:lineChart>'), label: 'lineChart' },
  { t: 'pie', assert: (x) => x.includes('<c:pieChart>'), label: 'pieChart' },
  { t: 'area', assert: (x) => x.includes('<c:areaChart>'), label: 'areaChart' },
]

// ---- Each chart type: a native chart persists, bound to the range ----
for (const c of CASES) {
  const FILE = `/tmp/wos-test/Chart ${c.t}.xlsx`
  const NAME = `Chart ${c.t}.xlsx`
  await authorDataFile(FILE)
  const { app, win } = await H.launch()
  const opened = await openInEngine(win, NAME)
  r.ok(opened, `${c.t.toUpperCase()}: data file opened in the engine`)
  const x = await insertChartAndSave(win, FILE, c.t)
  r.ok(chartPartExists(FILE), `${c.t.toUpperCase()}: xl/charts/chart1.xml persisted to the saved .xlsx`)
  r.ok(c.assert(x), `${c.t.toUpperCase()}: persisted as the right plot type (${c.label})`)
  r.ok(x.includes('<c:ser>'), `${c.t.toUpperCase()}: a data series (<c:ser>) is present`)
  r.ok(/<c:f>Sheet1![^<]+<\/c:f>/.test(x), `${c.t.toUpperCase()}: series is BOUND to the cell range (Sheet1!$…)`)
  r.ok(validXlsx(FILE), `${c.t.toUpperCase()}: file is a valid, non-corrupt .xlsx`)
  await app.close()

  // Column: prove it SURVIVES a close + reopen in a fresh engine.
  if (c.t === 'column') {
    const { app: app2, win: win2 } = await H.launch()
    const reopened = await openInEngine(win2, NAME)
    r.ok(reopened, 'REOPEN: the saved chart file re-opened in a fresh engine')
    await win2.evaluate(() => window.workspace.lok.save())
    await win2.waitForTimeout(1000)
    const reXml = chartXml(FILE)
    r.ok(chartPartExists(FILE), 'REOPEN: chart part still present after close + reopen')
    r.ok(reXml.includes('<c:ser>') && /<c:f>Sheet1![^<]+<\/c:f>/.test(reXml), 'REOPEN: series + range binding survived the round-trip')
    r.ok(/barDir val="col"/.test(reXml), 'REOPEN: still a column chart')
    await app2.close()
  }
  try { fs.rmSync(FILE) } catch { /* best-effort */ }
}

// ---- FAIL-SAFE: an empty/garbage range must not crash the engine or corrupt
// the file, and must not poison the macro module for later valid inserts. ----
{
  const FILE = '/tmp/wos-test/Chart failsafe.xlsx'
  const NAME = 'Chart failsafe.xlsx'
  await authorDataFile(FILE)
  const { app, win } = await H.launch()
  await openInEngine(win, NAME)
  const okMacro = await win.evaluate(() => window.workspace.lok.macro('WosInsertChart', 'column|ZZ998:ZZ1000'))
  await win.evaluate(() => window.workspace.lok.save())
  await win.waitForTimeout(1000)
  r.ok(okMacro === true, 'FAIL-SAFE: chart macro over an empty range returned without throwing')
  r.ok(validXlsx(FILE), 'FAIL-SAFE: the .xlsx is still valid after a no-data chart attempt')
  const stillWorks = await insertChartAndSave(win, FILE, 'column')
  r.ok(chartPartExists(FILE) && stillWorks.includes('<c:ser>'), 'FAIL-SAFE: a subsequent valid chart still inserts (module not poisoned)')
  await app.close()
  try { fs.rmSync(FILE) } catch { /* best-effort */ }
}

process.exit(r.done() ? 0 : 1)
