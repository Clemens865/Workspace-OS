// Phase H — Word transclusion: the SAME metric lives in a real .docx and stays
// in sync (cross-app liveness, the north-star). Mirrors G (Excel) for Writer:
//   insert a metric as a tagged content control (w:sdt) in a Word doc → ⌘S
//   → change the metric → the OPEN doc's control updates live (no reopen)
//   → REOPEN a second doc → its control re-syncs on open
//   → SYNC-ALL into a CLOSED .docx → the engine-free writer updates it on disk
//   → delete the metric → the value STAYS (fail-safe, valid .docx)
//
// The value is verified by unzipping the real .docx each phase (docXml → the
// document.xml), and the file is checked to still be a valid zip. The content
// control is the stable Word anchor: LibreOffice inserts it as <w:sdt> with a
// <w:tag w:val="wos-metric-…"> that round-trips MS Word, and its value lives in
// <w:sdtContent> — clean to locate + replace in both the open and closed paths.
//
// Like G, the very first insert is driven via the API (the same macro the Insert
// button calls) because this machine's engine cold-boots ~27s and the New-doc
// menu flow races the file write; reopen is the path the demo depends on.
import * as H from './_harness.mjs'
import { execSync } from 'child_process'
import fs from 'fs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const r = H.makeReporter('PHASE H — Word transclusion')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const NAME = 'Headcount ' + Date.now()
const FILE = '/tmp/wos-test/New Document.docx'
const readDoc = () => H.docXml(FILE, 'Word')
const validDocx = () => { try { execSync(`unzip -t '${FILE}'`, { stdio: 'ignore' }); return true } catch { return false } }
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
  await win.getByText('New Document.docx').first().click()
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (await win.locator('[data-testid=metrics-toggle]').isVisible().catch(() => false)) { await win.waitForTimeout(400); return }
    await win.waitForTimeout(400)
  }
  throw new Error('renderer never became ready for the reopened doc')
}

for (const f of fs.readdirSync('/tmp/wos-test')) if (f.startsWith('New Document')) fs.rmSync('/tmp/wos-test/' + f)

// ---- Phase 1: new Word doc; define "Headcount"=42; INSERT it as a tagged
// content control; record the docx-cc link; save. ----
let { app, win } = await H.launch()
await win.getByRole('button', { name: 'New document', exact: true }).click()
const prim = win.getByText('Word document')
if (await prim.isVisible().catch(() => false)) await prim.click()
else await win.getByText('Word').first().click()
await waitEngineDoc(win)

// Place a cursor with some surrounding text so the anchor sits inside real content.
await H.focusDoc(win)
await H.type(win, 'Team headcount is ')

const metricId = await win.evaluate((name) => window.workspace.metrics.create(name, 42).then((m) => m.id), NAME)
r.ok(typeof metricId === 'string' && metricId.startsWith('metric-'), 'metric "Headcount"=42 created')

// Insert via the SAME macro the writer Insert button calls, then record the link.
const inserted = await win.evaluate(({ tag, name }) =>
  window.workspace.lok.macro('WosInsertContentControl', `${tag}|42|${name}`), { tag: TAG, name: NAME })
r.ok(inserted === true, 'WosInsertContentControl wrapped the value 42 in a tagged control')
await win.evaluate(({ id, f, tag }) =>
  window.workspace.transclusions.add({ metricId: id, filePath: f, target: { kind: 'docx-cc', tag }, lastValue: 42 }),
  { id: metricId, f: FILE, tag: TAG })
await win.evaluate(() => window.workspace.lok.save())
await win.waitForTimeout(1400)

r.ok(readDoc().includes(TAG), 'content control tagged into the real .docx (anchor persisted)')
r.ok(readDoc().includes('>42<'), 'literal 42 written into the .docx (fidelity floor)')
r.ok(validDocx(), 'saved file is a valid .docx (opens in Word)')
const links1 = await win.evaluate((f) => window.workspace.transclusions.forFile(f), FILE)
r.ok(links1.length === 1 && links1[0].target?.kind === 'docx-cc' && links1[0].lastValue === 42, 'live docx-cc link recorded, lastValue 42')
await app.close()

// ---- Phase 2: LIVE — with the doc OPEN, edit the metric via the panel Save
// button → the open control updates immediately, WITHOUT reopening. ----
;({ app, win } = await H.launch())
await reopenInRenderer(win) // on-open resync is a no-op here (already in sync at 42)
await win.locator('[data-testid=metrics-toggle]').click()
await win.locator('[data-testid=metric-value]').first().fill('58')
await win.locator('[data-testid=metric-save]').first().click()
const live = await H.poll(async () => {
  await H.save(win)
  const s = readDoc()
  return s.includes('>58<') && !s.includes('>42<')
}, { timeout: 40000 })
r.ok(live, 'LIVE: metric edited while open → control updated to 58 WITHOUT reopen')
r.ok(validDocx(), 'file still valid after the live update')
const linksLive = await win.evaluate((f) => window.workspace.transclusions.forFile(f), FILE)
r.ok(linksLive[0]?.lastValue === 58, 'live link lastValue advanced to 58 (no reopen)')
await app.close()

// ---- Phase 3: change the metric to 63, REOPEN → the renderer re-syncs on open. ----
;({ app, win } = await H.launch())
await win.evaluate((id) => window.workspace.metrics.update(id, { value: 63 }), metricId)
await reopenInRenderer(win)
const synced = await H.poll(async () => { await H.save(win); const s = readDoc(); return s.includes('>63<') && !s.includes('>58<') }, { timeout: 40000 })
r.ok(synced, 'reopen re-synced the control to 63 (old 58 gone) — live update')
r.ok(validDocx(), 'file still valid after re-sync')
await app.close()

// ---- Phase 4: SYNC-ALL into a CLOSED .docx — the engine-free disk writer. ----
const FILE_A = '/tmp/wos-test/Closed Doc.docx'
const readDocOf = (f) => { try { return execSync(`unzip -p '${f}' word/document.xml`, { encoding: 'utf8' }) } catch { return '' } }
const validDocxOf = (f) => { try { execSync(`unzip -t '${f}'`, { stdio: 'ignore' }); return true } catch { return false } }

;({ app, win } = await H.launch())
// Author FILE_A by copying the known-valid FILE (holds 63) — a real, closed .docx.
fs.copyFileSync(FILE, FILE_A)
r.ok(validDocxOf(FILE_A) && readDocOf(FILE_A).includes('>63<'), 'closed FILE_A authored (valid .docx, control=63)')

const mId = await win.evaluate((name) => window.workspace.metrics.create(name, 88).then((m) => m.id), 'WordSyncAll ' + Date.now())
await win.evaluate(({ id, f, tag }) =>
  window.workspace.transclusions.add({ metricId: id, filePath: f, target: { kind: 'docx-cc', tag }, lastValue: 63 }),
  { id: mId, f: FILE_A, tag: TAG })

const preview = await win.evaluate((id) => window.workspace.transclusions.previewSyncAll(id, null), mId)
r.ok(preview.willUpdate.length === 1 && preview.willUpdate[0].file === FILE_A, 'previewSyncAll reports the closed .docx would change')

const summary = await win.evaluate((id) => window.workspace.transclusions.syncAll(id, null), mId)
r.ok(summary.updated.length === 1 && summary.skipped.length === 0, 'syncAll updated 1 closed .docx, skipped none')
r.ok(readDocOf(FILE_A).includes('>88<') && !readDocOf(FILE_A).includes('>63<'), 'CLOSED .docx control updated to 88 on disk (engine never opened it)')
r.ok(validDocxOf(FILE_A), 'closed .docx is STILL a valid, non-corrupt file after the write')

// Cleanup Phase 4.
await win.evaluate((id) => window.workspace.metrics.delete(id), mId)
await win.evaluate((f) => window.workspace.transclusions.forFile(f).then((ls) =>
  Promise.all(ls.map((l) => window.workspace.transclusions.remove(l.id)))), FILE_A)
try { fs.rmSync(FILE_A) } catch { /* best-effort */ }
await app.close()

// ---- Phase 5: DELETE the metric, REOPEN → the control must STAY 63 (fail-safe). ----
;({ app, win } = await H.launch())
await win.evaluate((id) => window.workspace.metrics.delete(id), metricId)
await reopenInRenderer(win)
await win.waitForTimeout(2500) // give any (wrong) re-sync a chance to misfire
await H.save(win)
const afterDelete = readDoc()
r.ok(afterDelete.includes('>63<'), 'FAIL-SAFE: deleted metric → control keeps 63 (never blanked)')
r.ok(validDocx(), 'file is still a valid, non-corrupt .docx after a dead link')
await win.evaluate((f) => window.workspace.transclusions.forFile(f).then((ls) =>
  Promise.all(ls.map((l) => window.workspace.transclusions.remove(l.id)))), FILE)
await app.close()

process.exit(r.done() ? 0 : 1)
