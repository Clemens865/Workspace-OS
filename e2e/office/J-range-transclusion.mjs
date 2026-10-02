// Phase J — Live RANGES: the grid-sized transclusion demo, end to end (the
// range sibling of G-transclusion).
//   author a source block A1:B3 (headers + numbers) → define range "Regional
//   KPIs" reading LIVE from it → insert the block at E1 (literal grid + link)
//   → edit a source cell → panel ↻ refresh → the mirrored block updates LIVE
//   → edit the source ON DISK while closed → REOPEN → on-open re-sync stamps
//   the block → delete the range → REOPEN → block STAYS (fail-safe)
//   → sync-all stamps a block into a CLOSED file via the engine-free writer.
//
// Literal values are verified by unzipping the real .xlsx each phase (numbers
// live in sheet1.xml, strings in sharedStrings.xml) — the proof that liveness
// fails safe to a correct file.
import * as H from './_harness.mjs'
import { execSync } from 'child_process'
import fs from 'fs'
import ExcelJS from 'exceljs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const r = H.makeReporter('PHASE J — Live ranges')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const NAME = 'Regional KPIs ' + Date.now()
const FILE = '/tmp/wos-test/New Spreadsheet.xlsx'
const SHEET = 'Sheet1'
// Source block A1:B3; mirrored block anchored at E1 (covers E1:F3 — disjoint).
const GRID = [['Region', 'Rev'], ['EMEA', 12.5], ['APAC', 7]]

const readSheet = (f = FILE) => { try { return execSync(`unzip -p '${f}' xl/worksheets/sheet1.xml`, { encoding: 'utf8' }) } catch { return '' } }
const readStrings = (f = FILE) => { try { return execSync(`unzip -p '${f}' xl/sharedStrings.xml`, { encoding: 'utf8' }) } catch { return '' } }
const validXlsx = (f = FILE) => { try { execSync(`unzip -t '${f}'`, { stdio: 'ignore' }); return true } catch { return false } }
const count = (hay, needle) => hay.split(needle).length - 1

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

/** Removes ranges + range links left by earlier runs so re-runs start clean. */
async function cleanStores(win, files) {
  await win.evaluate(async ({ files: fl, prefix }) => {
    for (const f of fl) {
      const links = await window.workspace.rangeLinks.forFile(f)
      await Promise.all(links.map((l) => window.workspace.rangeLinks.remove(l.id)))
    }
    const all = await window.workspace.ranges.list()
    await Promise.all(all.filter((x) => x.name.startsWith(prefix)).map((x) => window.workspace.ranges.delete(x.id)))
  }, { files, prefix: 'Regional KPIs ' })
}

for (const f of fs.readdirSync('/tmp/wos-test')) if (f.startsWith('New Spreadsheet')) fs.rmSync('/tmp/wos-test/' + f)

// ---- Phase 1: author the source block, define the range, insert it at E1 ----
let { app, win } = await H.launch()
await cleanStores(win, [FILE, '/tmp/wos-test/Closed Range Book.xlsx'])
await win.getByRole('button', { name: 'New document', exact: true }).click()
const prim = win.getByText('Excel document')
if (await prim.isVisible().catch(() => false)) await prim.click()
else await win.getByText('Excel spreadsheet').click()
await waitEngineDoc(win)

// Author the source data via the same block-stamp macro the Insert path uses.
const stamped = await win.evaluate(({ sheet, values }) =>
  window.workspace.lok.setRangeBlock({ sheet, cell: 'A1', values }), { sheet: SHEET, values: GRID })
r.ok(stamped === true, 'WosSetRangeBlock stamped the 3×2 source block at A1')
await win.evaluate(() => window.workspace.lok.save())
await win.waitForTimeout(1200)
r.ok(readSheet().includes('>12.5<') && readSheet().includes('>7<'), 'source numbers landed in the real .xlsx')
r.ok(readStrings().includes('EMEA') && readStrings().includes('Region'), 'source texts landed (shared strings)')

// Define the range reading LIVE from the saved block on disk.
const rangeId = await win.evaluate(({ name, f, sheet }) =>
  window.workspace.ranges.createFromSource(name, { kind: 'xlsx-range', filePath: f, sheet, ref: 'A1:B3' })
    .then((x) => x.id), { name: NAME, f: FILE, sheet: SHEET })
r.ok(typeof rangeId === 'string' && rangeId.startsWith('range-'), `range "${NAME.slice(0, 13)}…" reads live from ${SHEET}!A1:B3`)

// Transclude: stamp the literal grid at E1 (the Insert button's exact calls),
// record the live link, then save.
await win.evaluate(({ sheet, values }) =>
  window.workspace.lok.setRangeBlock({ sheet, cell: 'E1', values }), { sheet: SHEET, values: GRID })
await win.evaluate(({ id, f, sheet, values }) =>
  window.workspace.rangeLinks.add({ rangeId: id, filePath: f, target: { kind: 'xlsx-block', sheet, cell: 'E1' }, lastValues: values }),
  { id: rangeId, f: FILE, sheet: SHEET, values: GRID })
await win.evaluate(() => window.workspace.lok.save())
await win.waitForTimeout(1200)

r.ok(count(readSheet(), '>12.5<') === 2, 'literal grid mirrored at E1 (12.5 appears twice — fidelity floor)')
r.ok(validXlsx(), 'saved file is a valid .xlsx (opens in Excel)')
const links1 = await win.evaluate((f) => window.workspace.rangeLinks.forFile(f), FILE)
r.ok(links1.length === 1 && links1[0].target?.cell === 'E1' && links1[0].lastValues.length === 3,
  'live range link recorded {range → E1, 3×2 lastValues}')
await app.close()

// ---- Phase 2: LIVE — edit a source cell, ↻ refresh in the panel → the
// mirrored block updates immediately, with NO reopen. Exercises the renderer's
// refreshRange → applyRangeRefreshResults → propagate path through the real UI.
;({ app, win } = await H.launch())
await reopenInRenderer(win) // on-open resync is a no-op (block in sync)
await win.evaluate(({ sheet }) => window.workspace.lok.macro('WosSetCell', `${sheet}|B2|40`), { sheet: SHEET })
// Save through the ENGINE directly (like G does after macro writes): a macro
// edit never sets the renderer's dirty flag, so the ribbon Save button is
// disabled and H.save() would silently no-op — the classic macro-save trap.
await win.evaluate(() => window.workspace.lok.save())
await win.waitForTimeout(1200)
r.ok(readSheet().includes('>40<'), 'source cell B2=40 saved to disk (the read source of truth)')
await win.locator('[data-testid=metrics-toggle]').click()
await win.waitForTimeout(600)
await win.locator('[data-testid=range-refresh]').first().click()
const live = await H.poll(async () => {
  await win.evaluate(() => window.workspace.lok.save())
  await win.waitForTimeout(400)
  const s = readSheet()
  return count(s, '>40<') === 2 && !s.includes('>12.5<')
}, { timeout: 40000 })
r.ok(live, 'LIVE: source B2→40, panel ↻ refresh → mirrored F2 updated to 40 WITHOUT reopen')
const linksLive = await win.evaluate((f) => window.workspace.rangeLinks.forFile(f), FILE)
r.ok(linksLive[0]?.lastValues?.[1]?.[1] === 40, 'live link lastValues advanced to the refreshed grid')
await app.close()

// ---- Phase 3: change the source ON DISK while closed, refresh the store,
// REOPEN → the on-open re-sync stamps the block (mirrors G's phase 2). ----
{
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(FILE)
  wb.getWorksheet(SHEET).getCell('B2').value = 99
  await wb.xlsx.writeFile(FILE)
}
;({ app, win } = await H.launch())
const refreshed = await win.evaluate((id) => window.workspace.ranges.refreshFromSource(id), rangeId)
r.ok(refreshed.status === 'updated' && refreshed.range.values[1][1] === 99, 'store refresh picked up the on-disk edit (B2=99)')
await reopenInRenderer(win)
// The on-open resync effect stamps 99 into the block + marks dirty; save + verify.
const synced = await H.poll(async () => { await H.save(win); const s = readSheet(); return count(s, '>99<') === 2 && !s.includes('>40<') }, { timeout: 40000 })
r.ok(synced, 'reopen re-synced the E1 block to 99 (old 40 gone) — live update')
r.ok(validXlsx(), 'file still valid after re-sync')
const links2 = await win.evaluate((f) => window.workspace.rangeLinks.forFile(f), FILE)
r.ok(links2[0]?.lastValues?.[1]?.[1] === 99, 'link lastValues advanced to 99')
await app.close()

// ---- Phase 4: DELETE the range, REOPEN → block must STAY (fail-safe) ----
;({ app, win } = await H.launch())
await win.evaluate((id) => window.workspace.ranges.delete(id), rangeId)
await reopenInRenderer(win)
await win.waitForTimeout(2500) // give any (wrong) re-sync a chance to misfire
await H.save(win)
const afterDelete = readSheet()
r.ok(count(afterDelete, '>99<') === 2, 'FAIL-SAFE: deleted range → block keeps its literals (never blanked)')
r.ok(readStrings().includes('EMEA'), 'texts intact too')
r.ok(validXlsx(), 'file is still a valid, non-corrupt .xlsx after a dead link')
// Cleanup: drop the orphan link so re-runs start clean.
await win.evaluate((f) => window.workspace.rangeLinks.forFile(f).then((ls) =>
  Promise.all(ls.map((l) => window.workspace.rangeLinks.remove(l.id)))), FILE)
await app.close()

// ---- Phase 5: SYNC-ALL into a CLOSED file — the engine-free BLOCK writer ----
// FILE_A is a valid .xlsx that is NEVER opened in the engine. We link a fresh
// range to it at H1, then push the grid with rangeLink:syncAll (main process,
// exceljs, no engine). Proof: the closed file's block changed on disk AND the
// file is still a valid, re-openable .xlsx.
const FILE_A = '/tmp/wos-test/Closed Range Book.xlsx'
;({ app, win } = await H.launch())
fs.copyFileSync(FILE, FILE_A)
r.ok(validXlsx(FILE_A), 'closed FILE_A authored (valid .xlsx copy)')

const rId = await win.evaluate(({ name, f, sheet }) =>
  window.workspace.ranges.createFromSource(name, { kind: 'xlsx-range', filePath: f, sheet, ref: 'A1:B3' })
    .then((x) => x.id), { name: NAME + ' sync', f: FILE, sheet: SHEET })
await win.evaluate(({ id, f, sheet }) =>
  window.workspace.rangeLinks.add({ rangeId: id, filePath: f, target: { kind: 'xlsx-block', sheet, cell: 'H1' }, lastValues: [[null]] }),
  { id: rId, f: FILE_A, sheet: SHEET })

// Preview first (the UX's confirm data) — must report exactly one closed-file change.
const preview = await win.evaluate((id) => window.workspace.rangeLinks.previewSyncAll(id, null), rId)
r.ok(preview.willUpdate.length === 1 && preview.willUpdate[0].file === FILE_A, 'previewSyncAll reports the closed file would change')

// Apply. openFilePath = null → FILE_A is treated as closed → engine-free writer.
const summary = await win.evaluate((id) => window.workspace.rangeLinks.syncAll(id, null), rId)
r.ok(summary.updated.length === 1 && summary.skipped.length === 0, 'syncAll stamped 1 closed file, skipped none')
{
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(FILE_A)
  const ws = wb.getWorksheet(SHEET)
  r.ok(ws.getCell('H1').value === 'Region' && ws.getCell('H2').value === 'EMEA' && ws.getCell('I2').value === 99,
    'CLOSED file block H1:I3 stamped on disk (engine never opened it)')
}
r.ok(validXlsx(FILE_A), 'closed file is STILL a valid, non-corrupt .xlsx after the write')
const linksA = await win.evaluate((f) => window.workspace.rangeLinks.forFile(f), FILE_A)
r.ok(linksA[0]?.lastValues?.[1]?.[1] === 99, 'closed-file link lastValues advanced')

// Cleanup Phase 5.
await win.evaluate((id) => window.workspace.ranges.delete(id), rId)
await win.evaluate((f) => window.workspace.rangeLinks.forFile(f).then((ls) =>
  Promise.all(ls.map((l) => window.workspace.rangeLinks.remove(l.id)))), FILE_A)
try { fs.rmSync(FILE_A) } catch { /* best-effort */ }
await app.close()

process.exit(r.done() ? 0 : 1)
