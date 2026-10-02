// Phase G — Live transclusion: the north-star demo moment, end to end.
//   define "Q3 Revenue"=23.4 → write it into a real Calc cell → ⌘S
//   → change the metric to 21.9 → REOPEN the sheet → cell auto-updates to 21.9
//   → delete the metric → REOPEN → cell STAYS 21.9 (fail-safe, valid file)
//
// The literal value is verified by unzipping the real .xlsx each phase — the
// proof that liveness fails safe to a correct file. The two re-sync phases open
// the file through the REAL renderer, so the on-open resync effect is exercised.
//
// The very first cell write goes through the same WosSetCell macro the Insert
// button calls (window.workspace.lok.macro), driven via the API rather than the
// button: this machine's engine cold-boots ~27s and the New-document menu flow
// races the file write (a pre-existing flake affecting baseline tests too), so
// we author a valid fixture deterministically, then reopen it — reopen is the
// path the demo actually depends on.
import * as H from './_harness.mjs'
import { execSync } from 'child_process'
import fs from 'fs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const r = H.makeReporter('PHASE G — Live transclusion')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const NAME = 'Q3 Revenue ' + Date.now()
const FILE = '/tmp/wos-test/New Spreadsheet.xlsx'
const CELL = 'A1'
const SHEET = 'Sheet1'
const readSheet = () => { try { return execSync(`unzip -p '${FILE}' xl/worksheets/sheet1.xml`, { encoding: 'utf8' }) } catch { return '' } }
const validXlsx = () => { try { execSync(`unzip -t '${FILE}'`, { stdio: 'ignore' }); return true } catch { return false } }

/** Poll the engine until a doc is actually open (parts reported). */
async function waitEngineDoc(win, budgetMs = 120000) {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    const parts = await win.evaluate(() => window.workspace.lok.parts()).catch(() => null)
    if (parts && parts.parts > 0) return parts
    await win.waitForTimeout(400)
  }
  throw new Error('engine never opened a doc')
}

/** Open the file through the file tree and wait for the renderer to be READY
 * (the ∑ Metrics toggle renders only when loading has cleared) — this is what
 * lets the on-open re-sync effect run. */
async function reopenInRenderer(win, budgetMs = 120000) {
  await win.getByText('New Spreadsheet.xlsx').first().click()
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (await win.locator('[data-testid=metrics-toggle]').isVisible().catch(() => false)) { await win.waitForTimeout(400); return }
    await win.waitForTimeout(400)
  }
  throw new Error('renderer never became ready for the reopened sheet')
}

for (const f of fs.readdirSync('/tmp/wos-test')) if (f.startsWith('New Spreadsheet')) fs.rmSync('/tmp/wos-test/' + f)

// ---- Phase 1: define "Q3 Revenue"=23.4, write the LITERAL into A1, link + save ----
let { app, win } = await H.launch()
await win.getByRole('button', { name: 'New document', exact: true }).click()
const prim = win.getByText('Excel document')
if (await prim.isVisible().catch(() => false)) await prim.click()
else await win.getByText('Excel spreadsheet').click()
await waitEngineDoc(win)

const metricId = await win.evaluate((name) => window.workspace.metrics.create(name, 23.4).then((m) => m.id), NAME)
r.ok(typeof metricId === 'string' && metricId.startsWith('metric-'), 'metric "Q3 Revenue"=23.4 created')

// Transclude: write the literal via WosSetCell (the Insert button's exact call),
// record the live link, then save. Save persists the engine's doc to the path.
const wrote = await win.evaluate(({ sheet, cell }) =>
  window.workspace.lok.macro('WosSetCell', `${sheet}|${cell}|23.4`), { sheet: SHEET, cell: CELL })
r.ok(wrote === true, 'WosSetCell wrote the literal 23.4 into the cell')
await win.evaluate(({ id, f, sheet, cell }) =>
  window.workspace.transclusions.add({ metricId: id, filePath: f, sheet, cell, lastValue: 23.4 }),
  { id: metricId, f: FILE, sheet: SHEET, cell: CELL })
await win.evaluate(() => window.workspace.lok.save())
await win.waitForTimeout(1200)

r.ok(readSheet().includes('>23.4<'), 'literal 23.4 written into the real .xlsx (fidelity floor)')
r.ok(validXlsx(), 'saved file is a valid .xlsx (opens in Excel)')
const links1 = await win.evaluate((f) => window.workspace.transclusions.forFile(f), FILE)
r.ok(links1.length === 1 && links1[0].lastValue === 23.4 && links1[0].target?.cell === CELL, 'live link recorded {metric → A1}, lastValue 23.4')
await app.close()

// ---- Phase 1b: LIVE — with the file OPEN in the renderer, edit the metric via
// the panel Save button → the open cell updates immediately, with NO further
// reopen. This exercises the renderer's updateMetric → applyLinksToOpenDoc
// propagation through the real UI. We reopen first (the deterministic way to get
// a renderer-ready window — the fresh New-document flow cold-boot-races on this
// machine), then prove the edit lands live WITHOUT reopening again.
;({ app, win } = await H.launch())
await reopenInRenderer(win) // on-open resync is a no-op here (cell already in sync at 23.4)
await win.locator('[data-testid=metrics-toggle]').click()
await win.locator('[data-testid=metric-value]').first().fill('55.5')
await win.locator('[data-testid=metric-save]').first().click()
// Save the doc and read the real .xlsx back — WITHOUT reopening the file.
const live = await H.poll(async () => {
  await H.save(win)
  const s = readSheet()
  return s.includes('>55.5<') && !s.includes('>23.4<')
}, { timeout: 40000 })
r.ok(live, 'LIVE: metric edited while open → cell A1 updated to 55.5 WITHOUT reopen')
const linksLive = await win.evaluate((f) => window.workspace.transclusions.forFile(f), FILE)
r.ok(linksLive[0]?.lastValue === 55.5, 'live link lastValue advanced to 55.5 (no reopen)')
await app.close()

// ---- Phase 2: change the metric to 21.9, REOPEN → renderer re-syncs the cell ----
;({ app, win } = await H.launch())
await win.evaluate((id) => window.workspace.metrics.update(id, { value: 21.9 }), metricId)
await reopenInRenderer(win)
// The on-open resync effect writes 21.9 + marks dirty; save + verify.
const synced = await H.poll(async () => { await H.save(win); const s = readSheet(); return s.includes('>21.9<') && !s.includes('>23.4<') }, { timeout: 40000 })
r.ok(synced, 'reopen re-synced A1 to 21.9 (old 23.4 gone) — live update')
r.ok(validXlsx(), 'file still valid after re-sync')
const links2 = await win.evaluate((f) => window.workspace.transclusions.forFile(f), FILE)
r.ok(links2[0]?.lastValue === 21.9, 'link lastValue advanced to 21.9')
await app.close()

// ---- Phase 3: DELETE the metric, REOPEN → cell must STAY 21.9 (fail-safe) ----
;({ app, win } = await H.launch())
await win.evaluate((id) => window.workspace.metrics.delete(id), metricId)
await reopenInRenderer(win)
await win.waitForTimeout(2500) // give any (wrong) re-sync a chance to misfire
await H.save(win)
const afterDelete = readSheet()
r.ok(afterDelete.includes('>21.9<'), 'FAIL-SAFE: deleted metric → cell keeps 21.9 (never blanked)')
r.ok(!afterDelete.includes('>23.4<'), 'no stale value resurrected')
r.ok(validXlsx(), 'file is still a valid, non-corrupt .xlsx after a dead link')

// Cleanup: drop the orphan link so re-runs start clean.
await win.evaluate((f) => window.workspace.transclusions.forFile(f).then((ls) =>
  Promise.all(ls.map((l) => window.workspace.transclusions.remove(l.id)))), FILE)
await app.close()

// ---- Phase 4: SYNC-ALL into a CLOSED file — the engine-free disk writer ----
// FILE_A is a valid .xlsx that is NEVER opened in the engine. We link a fresh
// metric to it, then push the value into it with transclusion:syncAll (which
// runs in the main process via exceljs, no engine). Proof: the closed file's
// cell changed on disk AND the file is still a valid, re-openable .xlsx.
const FILE_A = '/tmp/wos-test/Closed Book.xlsx'
const readSheetOf = (f) => { try { return execSync(`unzip -p '${f}' xl/worksheets/sheet1.xml`, { encoding: 'utf8' }) } catch { return '' } }
const validXlsxOf = (f) => { try { execSync(`unzip -t '${f}'`, { stdio: 'ignore' }); return true } catch { return false } }

;({ app, win } = await H.launch())
// Author FILE_A by copying the known-valid FILE (holds 21.9 in A1) — a real,
// closed workbook on disk that the engine has never touched.
fs.copyFileSync(FILE, FILE_A)
r.ok(validXlsxOf(FILE_A) && readSheetOf(FILE_A).includes('>21.9<'), 'closed FILE_A authored (valid .xlsx, A1=21.9)')

const mId = await win.evaluate((name) => window.workspace.metrics.create(name, 77.7).then((m) => m.id), 'SyncAll ' + Date.now())
await win.evaluate(({ id, f, sheet }) =>
  window.workspace.transclusions.add({ metricId: id, filePath: f, sheet, cell: 'A1', lastValue: 21.9 }),
  { id: mId, f: FILE_A, sheet: SHEET })

// Preview first (the UX's confirm data) — must report exactly one closed-file change.
const preview = await win.evaluate((id) => window.workspace.transclusions.previewSyncAll(id, null), mId)
r.ok(preview.willUpdate.length === 1 && preview.willUpdate[0].file === FILE_A, 'previewSyncAll reports the closed file would change')

// Apply. openFilePath = null → FILE_A is treated as closed → engine-free writer.
const summary = await win.evaluate((id) => window.workspace.transclusions.syncAll(id, null), mId)
r.ok(summary.updated.length === 1 && summary.skipped.length === 0, 'syncAll updated 1 closed file, skipped none')
r.ok(readSheetOf(FILE_A).includes('>77.7<') && !readSheetOf(FILE_A).includes('>21.9<'), 'CLOSED file A1 updated to 77.7 on disk (engine never opened it)')
r.ok(validXlsxOf(FILE_A), 'closed file is STILL a valid, non-corrupt .xlsx after the write')
const linksA = await win.evaluate((f) => window.workspace.transclusions.forFile(f), FILE_A)
r.ok(linksA[0]?.lastValue === 77.7, 'closed-file link lastValue advanced to 77.7')

// Cleanup Phase 4.
await win.evaluate((id) => window.workspace.metrics.delete(id), mId)
await win.evaluate((f) => window.workspace.transclusions.forFile(f).then((ls) =>
  Promise.all(ls.map((l) => window.workspace.transclusions.remove(l.id)))), FILE_A)
try { fs.rmSync(FILE_A) } catch { /* best-effort */ }
await app.close()

process.exit(r.done() ? 0 : 1)
