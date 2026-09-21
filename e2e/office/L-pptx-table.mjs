// Phase L — Live TABLES in PowerPoint: a whole range grid lives in one place and
// appears as a real .pptx slide table that stays in sync (the grid analogue of I,
// completing the trio Calc block + Word table + PPT table = one grid everywhere).
//   author a source block in a companion .xlsx → define range "Regional KPIs"
//   reading LIVE from it → INSERT it as a real slide TABLE whose frame is Named
//   (wos-range-…) → save → the table cells hold the grid in the real .pptx
//   → edit the source ON DISK + refresh → REOPEN → the on-open re-sync stamps the
//     table cells to the new grid (live)
//   → SYNC-ALL into a CLOSED .pptx → the engine-free pptx-table-writer updates it
//   → delete the range → REOPEN → the table STAYS (fail-safe, valid .pptx)
//
// The cells are verified by unzipping the real .pptx each phase (slide1.xml) and
// the file is checked to still be a valid zip.
import * as H from './_harness.mjs'
import { execSync } from 'child_process'
import fs from 'fs'
import ExcelJS from 'exceljs'

const r = H.makeReporter('PHASE L — PowerPoint live tables')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const NAME = 'Regional KPIs ' + Date.now()
const FILE = '/tmp/wos-test/New Presentation.pptx'
const SRC = '/tmp/wos-test/L Source.xlsx'
const FILE_A = '/tmp/wos-test/Closed Deck.pptx'
const readDeck = (f = FILE) => { try { return execSync(`unzip -p '${f}' ppt/slides/slide1.xml`, { encoding: 'utf8' }) } catch { return '' } }
const validPptx = (f = FILE) => { try { execSync(`unzip -t '${f}'`, { stdio: 'ignore' }); return true } catch { return false } }
const count = (hay, needle) => hay.split(needle).length - 1

const GRID = [['Region', 'Rev'], ['EMEA', 12.5]]

async function writeSource(rev) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  ws.getCell('A1').value = 'Region'; ws.getCell('B1').value = 'Rev'
  ws.getCell('A2').value = 'EMEA'; ws.getCell('B2').value = rev
  await wb.xlsx.writeFile(SRC)
}
async function editSource(rev) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(SRC)
  wb.getWorksheet('Sheet1').getCell('B2').value = rev; await wb.xlsx.writeFile(SRC)
}

async function waitEngineDoc(win, budgetMs = 120000) {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    const parts = await win.evaluate(() => window.workspace.lok.parts()).catch(() => null)
    if (parts && parts.parts > 0) return parts
    await win.waitForTimeout(400)
  }
  throw new Error('engine never opened a doc')
}

async function reopenInRenderer(win, budgetMs = 120000) {
  await win.getByText('New Presentation.pptx').first().click()
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (await win.locator('[data-testid=metrics-toggle]').isVisible().catch(() => false)) { await win.waitForTimeout(400); return }
    await win.waitForTimeout(400)
  }
  throw new Error('renderer never became ready for the reopened deck')
}

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

for (const f of fs.readdirSync('/tmp/wos-test')) if (f.startsWith('New Presentation') || f.startsWith('L Source') || f.startsWith('Closed Deck')) fs.rmSync('/tmp/wos-test/' + f)
await writeSource(12.5)

// ---- Phase 1: define the range from the source; INSERT it as a real slide table;
// record the pptx-table link; save. ----
let { app, win } = await H.launch()
await cleanStores(win, [FILE, FILE_A])
await H.newDoc(win, 'PowerPoint')
await waitEngineDoc(win)

const RID = await win.evaluate(({ name, f }) =>
  window.workspace.ranges.createFromSource(name, { kind: 'xlsx-range', filePath: f, sheet: 'Sheet1', ref: 'A1:B2' }).then((x) => x.id),
  { name: NAME, f: SRC })
r.ok(typeof RID === 'string' && RID.startsWith('range-'), `range "${NAME.slice(0, 13)}…" reads live from the source (2×2)`)

// SHORT tag — keep anchors compact so they round-trip verbatim.
const TAG = `wos-range-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const inserted = await win.evaluate(({ tag, values }) =>
  window.workspace.lok.setTable({ macro: 'WosInsertSlideTable', tag, values }), { tag: TAG, values: GRID })
r.ok(inserted === true, 'WosInsertSlideTable inserted a real slide table named with the tag')
await win.evaluate(({ id, f, tag, values }) =>
  window.workspace.rangeLinks.add({ rangeId: id, filePath: f, target: { kind: 'pptx-table', tag, slide: 0 }, lastValues: values }),
  { id: RID, f: FILE, tag: TAG, values: GRID })
await win.evaluate(() => window.workspace.lok.save())
await win.waitForTimeout(1600)

const deck1 = readDeck()
r.ok(deck1.includes(`name="${TAG}"`), 'table frame Name round-tripped into the real .pptx (anchor persisted)')
r.ok(deck1.includes('<a:tbl>'), 'a real slide table (<a:tbl>) is present')
r.ok(deck1.includes('>Region<') && deck1.includes('>EMEA<') && deck1.includes('>12.5<'), 'the grid cells landed in the table (fidelity floor)')
r.ok(validPptx(), 'saved file is a valid .pptx (opens in PowerPoint)')
const links1 = await win.evaluate((f) => window.workspace.rangeLinks.forFile(f), FILE)
r.ok(links1.length === 1 && links1[0].target?.kind === 'pptx-table', 'live pptx-table link recorded')
await app.close()

// ---- Phase 2: edit the source to 99 + refresh, REOPEN → on-open re-sync stamps
// the table cells to the new grid (live). ----
await editSource(99)
;({ app, win } = await H.launch())
const refreshed = await win.evaluate((id) => window.workspace.ranges.refreshFromSource(id), RID)
r.ok(refreshed.status === 'updated' && refreshed.range.values[1][1] === 99, 'store refresh picked up the on-disk edit (B2=99)')
await reopenInRenderer(win)
const synced = await H.poll(async () => { await H.save(win); const s = readDeck(); return count(s, '>99<') >= 1 && !s.includes('>12.5<') }, { timeout: 45000 })
r.ok(synced, 'reopen re-synced the slide table cells to 99 (old 12.5 gone) — live update')
r.ok(validPptx(), 'file still valid after re-sync')
const links2 = await win.evaluate((f) => window.workspace.rangeLinks.forFile(f), FILE)
r.ok(links2[0]?.lastValues?.[1]?.[1] === 99, 'link lastValues advanced to 99')
await app.close()

// ---- Phase 3: SYNC-ALL into a CLOSED .pptx — the engine-free table writer. ----
;({ app, win } = await H.launch())
fs.copyFileSync(FILE, FILE_A)
r.ok(validPptx(FILE_A) && readDeck(FILE_A).includes('>99<'), 'closed FILE_A authored (valid .pptx, table=99)')

await win.evaluate(({ id, f, tag }) =>
  window.workspace.rangeLinks.add({ rangeId: id, filePath: f, target: { kind: 'pptx-table', tag, slide: 0 }, lastValues: [['Region', 'Rev'], ['EMEA', 99]] }),
  { id: RID, f: FILE_A, tag: TAG })

await editSource(123)
await win.evaluate((id) => window.workspace.ranges.refreshFromSource(id), RID)

const preview = await win.evaluate((id) => window.workspace.rangeLinks.previewSyncAll(id, null), RID)
r.ok(preview.willUpdate.some((w) => w.file === FILE_A), 'previewSyncAll reports the closed .pptx would change')

const summary = await win.evaluate((id) => window.workspace.rangeLinks.syncAll(id, null), RID)
r.ok(summary.updated.some((u) => u.file === FILE_A), `syncAll stamped the closed .pptx (updated ${summary.updated.length}, skipped ${summary.skipped.length})`)
r.ok(readDeck(FILE_A).includes('>123<') && !readDeck(FILE_A).includes('>99<'), 'CLOSED .pptx table cell updated to 123 on disk (engine never opened it)')
r.ok(validPptx(FILE_A), 'closed .pptx is STILL a valid, non-corrupt file after the write')

await win.evaluate((f) => window.workspace.rangeLinks.forFile(f).then((ls) =>
  Promise.all(ls.map((l) => window.workspace.rangeLinks.remove(l.id)))), FILE_A)
try { fs.rmSync(FILE_A) } catch { /* best-effort */ }
await app.close()

// ---- Phase 4: DELETE the range, REOPEN → the table must STAY (fail-safe). ----
;({ app, win } = await H.launch())
await win.evaluate((id) => window.workspace.ranges.delete(id), RID)
await reopenInRenderer(win)
await win.waitForTimeout(2500) // give any (wrong) re-sync a chance to misfire
await H.save(win)
const afterDelete = readDeck()
r.ok(afterDelete.includes('<a:tbl>') && afterDelete.includes('>Region<'), 'FAIL-SAFE: deleted range → slide table keeps its last cells (never blanked)')
r.ok(validPptx(), 'file is still a valid, non-corrupt .pptx after a dead link')
await win.evaluate((f) => window.workspace.rangeLinks.forFile(f).then((ls) =>
  Promise.all(ls.map((l) => window.workspace.rangeLinks.remove(l.id)))), FILE)
await app.close()

process.exit(r.done() ? 0 : 1)
