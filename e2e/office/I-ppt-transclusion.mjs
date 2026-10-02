// Phase I — PowerPoint transclusion: the SAME metric lives in a real .pptx and
// stays in sync — completing the trio (Excel + Word + PPT = one number, right
// everywhere). Mirrors H (Word) for Impress:
//   insert a metric as a named text shape (<p:cNvPr name="wos-metric-…">) on a
//   slide → ⌘S
//   → change the metric → the OPEN deck's shape updates live (no reopen)
//   → REOPEN → its shape re-syncs on open
//   → SYNC-ALL into a CLOSED .pptx → the engine-free writer updates it on disk
//   → delete the metric → the value STAYS (fail-safe, valid .pptx)
//
// The value is verified by unzipping the real .pptx each phase (docXml → the
// slide1.xml), and the file is checked to still be a valid zip. The shape Name is
// the stable PPT anchor: LibreOffice writes the shape's UNO Name to the pptx
// <p:cNvPr name>, which round-trips PowerPoint, and its value lives in the txBody
// <a:t> run — clean to locate + replace in both the open and closed paths.
//
// Like G/H, the first insert is driven via the API (the same macro the Insert
// button calls) because this machine's engine cold-boots slowly and the New-doc
// menu flow races the file write; reopen is the path the demo depends on.
import * as I from './_harness.mjs'
import { execSync } from 'child_process'
import fs from 'fs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const r = I.makeReporter('PHASE I — PowerPoint transclusion')
if (!I.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const NAME = 'Attendees ' + Date.now()
const FILE = '/tmp/wos-test/New Presentation.pptx'
const readDeck = () => I.docXml(FILE, 'PowerPoint')
const validPptx = () => { try { execSync(`unzip -t '${FILE}'`, { stdio: 'ignore' }); return true } catch { return false } }
const TAG = `wos-metric-e2e-${Date.now()}`

async function waitEngineDoc(win, budgetMs = 120000) {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    const parts = await win.evaluate(() => window.workspace.lok.parts()).catch(() => null)
    if (parts && parts.parts > 0) return parts
    await win.waitForTimeout(400)
  }
  throw new Error('engine never opened a doc')
}

/** Open the file via the tree and wait until the renderer is READY (the ∑ Metrics
 * toggle renders only when loading has cleared) — lets the on-open re-sync run. */
async function reopenInRenderer(win, budgetMs = 120000) {
  await win.getByText('New Presentation.pptx').first().click()
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (await win.locator('[data-testid=metrics-toggle]').isVisible().catch(() => false)) { await win.waitForTimeout(400); return }
    await win.waitForTimeout(400)
  }
  throw new Error('renderer never became ready for the reopened deck')
}

for (const f of fs.readdirSync('/tmp/wos-test')) if (f.startsWith('New Presentation')) fs.rmSync('/tmp/wos-test/' + f)

// ---- Phase 1: new deck; define "Attendees"=42; INSERT it as a named shape;
// record the pptx-shape link; save. ----
let { app, win } = await I.launch()
await win.getByRole('button', { name: 'New document', exact: true }).click()
const prim = win.getByText('PowerPoint presentation')
if (await prim.isVisible().catch(() => false)) await prim.click()
else await win.getByText('PowerPoint').first().click()
await waitEngineDoc(win)

const metricId = await win.evaluate((name) => window.workspace.metrics.create(name, 42).then((m) => m.id), NAME)
r.ok(typeof metricId === 'string' && metricId.startsWith('metric-'), 'metric "Attendees"=42 created')

// Insert via the SAME macro the Impress Insert button calls, then record the link.
const inserted = await win.evaluate(({ tag }) =>
  window.workspace.lok.macro('WosInsertMetricShape', `${tag}|42`), { tag: TAG })
r.ok(inserted === true, 'WosInsertMetricShape placed the value 42 in a named shape')
await win.evaluate(({ id, f, tag }) =>
  window.workspace.transclusions.add({ metricId: id, filePath: f, target: { kind: 'pptx-shape', tag, slide: 0 }, lastValue: 42 }),
  { id: metricId, f: FILE, tag: TAG })
await win.evaluate(() => window.workspace.lok.save())
await win.waitForTimeout(1400)

r.ok(readDeck().includes(TAG), 'named shape tagged into the real .pptx (anchor persisted)')
r.ok(readDeck().includes('>42<'), 'literal 42 written into the .pptx (fidelity floor)')
r.ok(validPptx(), 'saved file is a valid .pptx (opens in PowerPoint)')
const links1 = await win.evaluate((f) => window.workspace.transclusions.forFile(f), FILE)
r.ok(links1.length === 1 && links1[0].target?.kind === 'pptx-shape' && links1[0].lastValue === 42, 'live pptx-shape link recorded, lastValue 42')
await app.close()

// ---- Phase 2: LIVE — with the deck OPEN, edit the metric via the panel Save
// button → the open shape updates immediately, WITHOUT reopening. ----
;({ app, win } = await I.launch())
await reopenInRenderer(win) // on-open resync is a no-op here (already in sync at 42)
await win.locator('[data-testid=metrics-toggle]').click()
await win.locator('[data-testid=metric-value]').first().fill('58')
await win.locator('[data-testid=metric-save]').first().click()
const live = await I.poll(async () => {
  await I.save(win)
  const s = readDeck()
  return s.includes('>58<') && !s.includes('>42<')
}, { timeout: 40000 })
r.ok(live, 'LIVE: metric edited while open → shape updated to 58 WITHOUT reopen')
r.ok(validPptx(), 'file still valid after the live update')
const linksLive = await win.evaluate((f) => window.workspace.transclusions.forFile(f), FILE)
r.ok(linksLive[0]?.lastValue === 58, 'live link lastValue advanced to 58 (no reopen)')
await app.close()

// ---- Phase 3: change the metric to 63, REOPEN → the renderer re-syncs on open. ----
;({ app, win } = await I.launch())
await win.evaluate((id) => window.workspace.metrics.update(id, { value: 63 }), metricId)
await reopenInRenderer(win)
const synced = await I.poll(async () => { await I.save(win); const s = readDeck(); return s.includes('>63<') && !s.includes('>58<') }, { timeout: 40000 })
r.ok(synced, 'reopen re-synced the shape to 63 (old 58 gone) — live update')
r.ok(validPptx(), 'file still valid after re-sync')
await app.close()

// ---- Phase 4: SYNC-ALL into a CLOSED .pptx — the engine-free disk writer. ----
const FILE_A = '/tmp/wos-test/Closed Deck.pptx'
const readDeckOf = (f) => { try { return execSync(`unzip -p '${f}' ppt/slides/slide1.xml`, { encoding: 'utf8' }) } catch { return '' } }
const validPptxOf = (f) => { try { execSync(`unzip -t '${f}'`, { stdio: 'ignore' }); return true } catch { return false } }

;({ app, win } = await I.launch())
// Author FILE_A by copying the known-valid FILE (holds 63) — a real, closed .pptx.
fs.copyFileSync(FILE, FILE_A)
r.ok(validPptxOf(FILE_A) && readDeckOf(FILE_A).includes('>63<'), 'closed FILE_A authored (valid .pptx, shape=63)')

const mId = await win.evaluate((name) => window.workspace.metrics.create(name, 88).then((m) => m.id), 'PptSyncAll ' + Date.now())
await win.evaluate(({ id, f, tag }) =>
  window.workspace.transclusions.add({ metricId: id, filePath: f, target: { kind: 'pptx-shape', tag, slide: 0 }, lastValue: 63 }),
  { id: mId, f: FILE_A, tag: TAG })

const preview = await win.evaluate((id) => window.workspace.transclusions.previewSyncAll(id, null), mId)
r.ok(preview.willUpdate.length === 1 && preview.willUpdate[0].file === FILE_A, 'previewSyncAll reports the closed .pptx would change')

const summary = await win.evaluate((id) => window.workspace.transclusions.syncAll(id, null), mId)
r.ok(summary.updated.length === 1 && summary.skipped.length === 0, 'syncAll updated 1 closed .pptx, skipped none')
r.ok(readDeckOf(FILE_A).includes('>88<') && !readDeckOf(FILE_A).includes('>63<'), 'CLOSED .pptx shape updated to 88 on disk (engine never opened it)')
r.ok(validPptxOf(FILE_A), 'closed .pptx is STILL a valid, non-corrupt file after the write')

// Cleanup Phase 4.
await win.evaluate((id) => window.workspace.metrics.delete(id), mId)
await win.evaluate((f) => window.workspace.transclusions.forFile(f).then((ls) =>
  Promise.all(ls.map((l) => window.workspace.transclusions.remove(l.id)))), FILE_A)
try { fs.rmSync(FILE_A) } catch { /* best-effort */ }
await app.close()

// ---- Phase 5: DELETE the metric, REOPEN → the shape must STAY 63 (fail-safe). ----
;({ app, win } = await I.launch())
await win.evaluate((id) => window.workspace.metrics.delete(id), metricId)
await reopenInRenderer(win)
await win.waitForTimeout(2500) // give any (wrong) re-sync a chance to misfire
await I.save(win)
const afterDelete = readDeck()
r.ok(afterDelete.includes('>63<'), 'FAIL-SAFE: deleted metric → shape keeps 63 (never blanked)')
r.ok(validPptx(), 'file is still a valid, non-corrupt .pptx after a dead link')
await win.evaluate((f) => window.workspace.transclusions.forFile(f).then((ls) =>
  Promise.all(ls.map((l) => window.workspace.transclusions.remove(l.id)))), FILE)
await app.close()

process.exit(r.done() ? 0 : 1)
