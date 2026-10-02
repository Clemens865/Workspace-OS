// Phase AO — comments and tracked changes in the LIVE app on the REAL engine.
// Writer: a comment added from the review panel shows as a thread and lands
// in the saved .docx; reply and resolve round-trip; Record on + typing
// produces a tracked change that Accept removes; the margin anchor opens the
// panel. Calc: a note on a cell shows in the panel and saves to the workbook.
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { launch, newDoc, focusDoc, type, save, docXml, poll, makeReporter, enginePresent, shot, TESTROOT } from './_harness.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

if (!enginePresent()) { console.log('SKIP: engine missing'); process.exit(0) }
const R = makeReporter('AO review')
const { app, win } = await launch()
// The new shell (WorkspaceShell) is the default; WOS_E2E_SHELL=legacy drives the classic layout.
const NEW_SHELL = process.env.WOS_E2E_SHELL !== 'legacy'
await win.evaluate((NEW_SHELL) => {
  const K = 'workspace-os:settings'
  let cur = {}
  try { cur = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* fresh */ }
  localStorage.setItem(K, JSON.stringify({ ...cur, newShell: NEW_SHELL }))
}, NEW_SHELL)
await win.reload()
await win.waitForSelector('#root', { timeout: 20000 })
await win.waitForTimeout(800)
for (let i = 0; i < 20 && await win.locator('[class*=splash]').first().isVisible().catch(() => false); i++) {
  await win.keyboard.press('Enter')
  await win.waitForTimeout(300)
}
const newest = (re) => fs.readdirSync(TESTROOT).filter((f) => re.test(f)).map((f) => path.join(TESTROOT, f))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
const zipPart = (file, inner) => { try { return execSync(`unzip -p '${file}' ${inner}`, { encoding: 'utf8' }) } catch { return '' } }
const panel = win.locator('[data-testid="review-panel"]')
const threads = () => win.locator('[data-testid="review-thread"]').count()

try {
  // ── Writer ─────────────────────────────────────────────────────────────
  await newDoc(win, 'Word')
  await poll(async () => !!newest(/^New Document.*\.docx$/), { timeout: 20000 })
  const docx = newest(/^New Document.*\.docx$/)
  await focusDoc(win)
  await type(win, 'Review this sentence carefully.')
  await win.getByRole('button', { name: 'Review', exact: true }).last().click()
  await win.locator('[data-testid="ribbon-review-panel"]').click()
  R.ok(await panel.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false), 'writer: the Review panel opens from the ribbon')
  await win.locator('[data-testid="review-draft"]').fill('Please double-check the numbers')
  await win.locator('[data-testid="review-add"]').click()
  R.ok(await poll(async () => (await threads()) === 1, { timeout: 8000 }), 'writer: adding a comment shows a thread in the panel')
  const inFile = await poll(async () => { await save(win); return /double-check the numbers/.test(zipPart(docx, 'word/comments.xml')) }, { timeout: 20000, interval: 800 })
  R.ok(inFile, 'writer: the comment is in the saved .docx (word/comments.xml)')
  R.ok((await win.locator('[data-testid="comment-anchor"]').count()) >= 1, 'writer: a margin anchor marks the comment')
  await shot(win, 'AO-writer-comment')
  // Reply → two entries in the thread.
  await win.locator('[data-testid="review-thread"]').first().getByTitle('Reply').click()
  await win.locator('[data-testid="review-thread"] textarea').first().fill('Checked, all good')
  await win.locator('[data-testid="review-thread"]').first().getByRole('button', { name: 'Reply', exact: true }).last().click()
  R.ok(await poll(async () => /Checked, all good/.test(await panel.innerText()), { timeout: 8000 }), 'writer: a reply appears in the thread')
  // Resolve → thread moves under Resolved.
  await win.locator('[data-testid="review-thread"]').first().getByTitle('Resolve').click()
  R.ok(await poll(async () => /Resolved/.test(await panel.innerText()), { timeout: 8000 }), 'writer: Resolve marks the thread resolved')
  // Tracked changes: record, type, see the change, accept it.
  await focusDoc(win)
  await win.getByTitle('Record changes', { exact: true }).click()
  await win.waitForTimeout(300)
  await focusDoc(win)
  await win.keyboard.press('End')
  await type(win, ' Added while recording.')
  R.ok(await poll(async () => (await win.locator('[data-testid="review-change"]').count()) >= 1, { timeout: 10000 }), 'writer: typing with Record on lists a tracked change')
  const tracked = await poll(async () => { await save(win); return /<w:ins\b/.test(docXml(docx)) }, { timeout: 20000, interval: 800 })
  R.ok(tracked, 'writer: the insertion is a tracked change in the saved .docx (<w:ins>)')
  await shot(win, 'AO-writer-changes')
  await win.locator('[data-testid="review-accept"]').first().click()
  R.ok(await poll(async () => (await win.locator('[data-testid="review-change"]').count()) === 0, { timeout: 10000 }), 'writer: Accept removes the change from the list')
  const accepted = await poll(async () => { await save(win); return !/<w:ins\b/.test(docXml(docx)) && /Added while recording/.test(docXml(docx)) }, { timeout: 20000, interval: 800 })
  R.ok(accepted, 'writer: … and the text stays, no longer marked, in the saved .docx')
  await win.getByTitle('Record changes', { exact: true }).click()

  // ── Calc ───────────────────────────────────────────────────────────────
  await newDoc(win, 'Excel')
  await poll(async () => !!newest(/^New Spreadsheet.*\.xlsx$/), { timeout: 20000 })
  const xlsx = newest(/^New Spreadsheet.*\.xlsx$/)
  await focusDoc(win)
  await win.evaluate(() => { const g = document.querySelector('[class*=calcGrid]'); if (g) { g.scrollTop = 0; g.scrollLeft = 0 } })
  await win.locator('[class*=docWrap]').first().click({ position: { x: 30, y: 10 }, force: true })
  await type(win, '42\n')
  await win.locator('[class*=docWrap]').first().click({ position: { x: 30, y: 10 }, force: true })
  await win.getByRole('button', { name: 'Review', exact: true }).last().click()
  if (!(await panel.isVisible().catch(() => false))) await win.locator('[data-testid="ribbon-review-panel"]').click()
  await win.locator('[data-testid="review-draft"]').fill('Verify this total')
  await win.locator('[data-testid="review-add"]').click()
  R.ok(await poll(async () => (await threads()) === 1, { timeout: 8000 }), 'calc: a note on the active cell shows in the panel')
  const noteSaved = await poll(async () => { await save(win); return /Verify this total/.test(zipPart(xlsx, 'xl/comments1.xml')) }, { timeout: 20000, interval: 800 })
  R.ok(noteSaved, 'calc: the note is in the saved .xlsx (xl/comments1.xml)')
  await shot(win, 'AO-calc-note')
} catch (e) {
  R.ok(false, `unexpected: ${e.message}`)
  console.log(e.stack)
} finally {
  await app.close().catch(() => {})
}
process.exit(R.done() ? 0 : 1)
