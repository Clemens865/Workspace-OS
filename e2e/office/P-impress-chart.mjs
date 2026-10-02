// Phase P — Persistent native CHART on a slide (Impress / PowerPoint). The
// definition of done, mirroring the Calc charts (E-charts): a chart inserted via
// the model-API macro (WosInsertSlideChart) must round-trip as REAL chart XML in
// the saved .pptx — an embedded chart part (ppt/charts/chart1.xml) carrying a
// <c:ser> data series, referenced from the slide by a graphicFrame — and it must
// NOT be a rasterized image.
//
// Proof is by unzipping the real .pptx each phase (never ok:true): the chart part
// exists, a <c:ser> series is present, the slide references the chart part
// (graphicFrame → chart relationship), the .pptx stays a valid zip, and no
// image/media was emitted for the chart. Column is proven end to end (insert →
// reopen in a fresh engine → still a bound chart part).
//
// Reliability notes: (1) author the deck via H.newDoc(PowerPoint) — Impress
// renders in the harness (unlike the Calc New-doc race); (2) SAVE via
// window.workspace.lok.save() (the ribbon Save no-ops after a macro-only edit);
// (3) poll SAVE until the chart part + <c:ser> are on disk (the embedded chart
// flushes a beat after the macro returns); (4) keep saves FEW — Impress save
// storms can wedge the engine (a lone wedge is not a failure — re-run).
import * as H from './_harness.mjs'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const r = H.makeReporter('PHASE P — Persistent chart on a slide (Impress)')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const TESTROOT = '/tmp/wos-test'

/** Creates a fresh PowerPoint deck, waits on the ENGINE (a slide part exists —
 * NOT the "Design" ribbon tab, a slow ~20s secondary signal that flakes under
 * multi-launch load), then PERSISTS the empty deck to disk. That first save is
 * the real Impress New-doc flake point (proven: when the empty deck's first save
 * lands, the chart insert+export is 100% reliable; when it never lands the engine
 * is wedged from the start — re-run). Returns the deck's file path, or throws
 * (a wedged first-save is not a chart-macro failure). */
async function newDeck(win) {
  for (const f of fs.readdirSync(TESTROOT)) if (f.startsWith('New Presentation')) fs.rmSync(path.join(TESTROOT, f))
  await win.getByRole('button', { name: 'New document', exact: true }).click()
  await win.waitForTimeout(400)
  await win.getByText('PowerPoint').click()
  const file = path.join(TESTROOT, 'New Presentation.pptx')
  const ok = await H.poll(async () => {
    const p = await win.evaluate(() => window.workspace.lok.parts()).catch(() => null)
    return p && p.parts > 0
  }, { timeout: 60000, interval: 500 })
  if (!ok) throw new Error('newDeck: engine never reported a slide')
  await win.waitForTimeout(800)
  // Persist the empty deck so the embedded chart later has a real doc storage on
  // disk (the un-persisted new doc is what makes the chart export crash headless).
  const saved = await H.poll(async () => {
    await win.evaluate(() => window.workspace.lok.save())
    await win.waitForTimeout(600)
    return validPptx(file)
  }, { timeout: 40000, interval: 900 })
  if (!saved) throw new Error('newDeck: empty deck never persisted (engine wedged on first save — re-run)')
  return file
}

/** Opens a deck from the tree and waits on the engine (a slide part). */
async function openDeck(win, fileName) {
  await win.getByText(fileName).first().click()
  const ok = await H.poll(async () => {
    const p = await win.evaluate(() => window.workspace.lok.parts()).catch(() => null)
    return p && p.parts > 0
  }, { timeout: 60000, interval: 500 })
  if (!ok) throw new Error('openDeck: engine never reported a slide')
  await win.waitForTimeout(800)
}

// List the chart parts inside the .pptx (ppt/charts/chartN.xml).
const chartParts = (f) => {
  try { return execSync(`unzip -l '${f}' | grep -oE 'ppt/charts/chart[0-9]+\\.xml' | sort -u`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean) } catch { return [] }
}
const chartXml = (f, part) => { try { return execSync(`unzip -p '${f}' '${part}'`, { encoding: 'utf8' }) } catch { return '' } }
const chartPartExists = (f) => chartParts(f).length > 0
const slideRefsChart = (f) => {
  // The slide's graphicFrame must reference a chart via the drawingML chart
  // namespace (either inline in the slide, or via the slide's rels → chart).
  try {
    const slide = execSync(`unzip -p '${f}' ppt/slides/slide1.xml`, { encoding: 'utf8' })
    if (/graphicframe/i.test(slide) && /schemas\.openxmlformats\.org\/drawingml\/2006\/chart/i.test(slide)) return true
    const rels = execSync(`unzip -p '${f}' ppt/slides/_rels/slide1.xml.rels`, { encoding: 'utf8' })
    return /relationships\/chart/i.test(rels) && /graphicframe/i.test(slide)
  } catch { return false }
}
// A rasterized chart would emit ppt/media/imageN.* and NO chart part. Guard: the
// chart must be native, so a media image is NOT the mechanism here.
const hasChartImage = (f) => {
  try { return execSync(`unzip -l '${f}' | grep -cE 'ppt/media/image[0-9]+'`, { encoding: 'utf8' }).trim() !== '0' } catch { return false }
}
const validPptx = (f) => { try { execSync(`unzip -t '${f}'`, { stdio: 'ignore' }); return true } catch { return false } }

/** Runs the slide-chart macro, then SAVE-polls until the chart part is fully
 * written (valid zip + a <c:ser>). Returns the first chart part's XML. */
async function insertChartAndSave(win, file, ctype) {
  await win.evaluate((ctype) => window.workspace.lok.macro('WosInsertSlideChart', ctype), ctype)
  await H.poll(async () => {
    await win.evaluate(() => window.workspace.lok.save())
    await win.waitForTimeout(600)
    if (!validPptx(file) || !chartPartExists(file)) return false
    return chartXml(file, chartParts(file)[0]).includes('<c:ser>')
  }, { timeout: 40000, interval: 900 })
  const parts = chartParts(file)
  return parts.length ? chartXml(file, parts[0]) : ''
}

const CASES = [
  { t: 'column', assert: (x) => x.includes('<c:barChart>') && /barDir val="col"/.test(x), label: 'barChart barDir="col"' },
  { t: 'bar', assert: (x) => x.includes('<c:barChart>') && /barDir val="bar"/.test(x), label: 'barChart barDir="bar"' },
  { t: 'line', assert: (x) => x.includes('<c:lineChart>'), label: 'lineChart' },
  { t: 'pie', assert: (x) => x.includes('<c:pieChart>'), label: 'pieChart' },
  { t: 'area', assert: (x) => x.includes('<c:areaChart>'), label: 'areaChart' },
]

/** Launches a fresh engine and creates a persisted empty deck, RETRYING on a
 * wedged first-save (a documented Impress New-doc throughput wedge — a lone wedge
 * is not a chart-macro failure, so relaunch a fresh engine rather than fail the
 * whole run). Returns { app, win, file }. */
async function launchWithDeck(tries = 3) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    const { app, win } = await H.launch()
    try { return { app, win, file: await newDeck(win) } }
    catch (e) { lastErr = e; try { await app.close() } catch { /* */ } }
  }
  throw lastErr
}

// ---- COLUMN: prove end to end, incl. reopen in a fresh engine ----
{
  const { app, win, file } = await launchWithDeck()
  const x = await insertChartAndSave(win, file, 'column')
  r.ok(chartPartExists(file), 'COLUMN: ppt/charts/chart1.xml persisted to the saved .pptx')
  r.ok(x.includes('<c:ser>'), 'COLUMN: a data series (<c:ser>) is present')
  r.ok(/barDir val="col"/.test(x), 'COLUMN: persisted as a column chart (barChart barDir="col")')
  r.ok(slideRefsChart(file), 'COLUMN: the slide references the chart via a graphicFrame')
  r.ok(!hasChartImage(file), 'COLUMN: it is a NATIVE chart, not a rasterized image (no ppt/media/image*)')
  r.ok(validPptx(file), 'COLUMN: file is a valid, non-corrupt .pptx')
  await app.close()

  // Reopen in a fresh engine — the chart part + series must survive.
  const { app: app2, win: win2 } = await H.launch()
  const base = file.split('/').pop()
  await openDeck(win2, base)
  await win2.waitForTimeout(1500)
  await win2.evaluate(() => window.workspace.lok.save())
  await win2.waitForTimeout(1500)
  const reXml = chartParts(file).length ? chartXml(file, chartParts(file)[0]) : ''
  r.ok(chartPartExists(file), 'REOPEN: chart part still present after close + reopen')
  r.ok(reXml.includes('<c:ser>'), 'REOPEN: the data series survived the round-trip')
  r.ok(/barDir val="col"/.test(reXml), 'REOPEN: still a column chart')
  await app2.close()
}

// ---- Other types: each persists as the right native plot type ----
for (const c of CASES.filter((c) => c.t !== 'column')) {
  const { app, win, file } = await launchWithDeck()
  const x = await insertChartAndSave(win, file, c.t)
  r.ok(chartPartExists(file), `${c.t.toUpperCase()}: chart part persisted to the saved .pptx`)
  r.ok(x.includes('<c:ser>'), `${c.t.toUpperCase()}: a data series (<c:ser>) is present`)
  r.ok(c.assert(x), `${c.t.toUpperCase()}: persisted as the right plot type (${c.label})`)
  r.ok(!hasChartImage(file), `${c.t.toUpperCase()}: native chart, not an image`)
  r.ok(validPptx(file), `${c.t.toUpperCase()}: file is a valid .pptx`)
  await app.close()
}

// ---- FAIL-SAFE: the macro on a non-Impress-safe path must not crash ----
{
  const { app, win } = await launchWithDeck()
  const okMacro = await win.evaluate(() => window.workspace.lok.macro('WosInsertSlideChart', ''))
  r.ok(okMacro === true, 'FAIL-SAFE: chart macro with an empty type returned without throwing')
  await app.close()
}

process.exit(r.done() ? 0 : 1)
