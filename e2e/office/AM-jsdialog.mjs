// Phase AM — engine dialogs rendered from their JSDialog trees, in the LIVE
// app on the REAL engine. The Calc Sort dialog opens as our own dialog (no
// bitmap tunnel), its widgets drive the engine (Descending → OK), and the
// sorted result is in the saved file. Then a Writer dialog with tabs
// (Paragraph) opens and cancels cleanly.
import fs from 'node:fs'
import path from 'node:path'
import { launch, newDoc, focusDoc, type, save, docXml, poll, makeReporter, enginePresent, shot, TESTROOT } from './_harness.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

if (!enginePresent()) { console.log('SKIP: engine missing'); process.exit(0) }
const R = makeReporter('AM jsdialog')
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
const DLG = '[data-testid="jsdialog"]'
const TUNNEL = '[class*=backdrop] canvas'

try {
  // ── Calc: Sort via the Data tab ──────────────────────────────────────
  await newDoc(win, 'Excel')
  await poll(async () => !!newest(/^New Spreadsheet.*\.xlsx$/), { timeout: 20000 })
  const xlsx = newest(/^New Spreadsheet.*\.xlsx$/)
  await focusDoc(win)
  await win.evaluate(() => { const g = document.querySelector('[class*=calcGrid]'); if (g) { g.scrollTop = 0; g.scrollLeft = 0 } })
  const wrap = win.locator('[class*=docWrap]').first()
  await wrap.click({ position: { x: 30, y: 10 }, force: true })
  await poll(async () => (await win.locator('[data-testid="cell-addr"]').first().innerText().catch(() => '')).trim() === 'A1', { timeout: 4000 })
  await type(win, '1\n2\n3\n')
  // Select A1:A3, then open Sort (the ribbon Home ▸ Data group has it).
  await wrap.click({ position: { x: 30, y: 10 }, force: true })
  await wrap.click({ position: { x: 30, y: 46 }, force: true, modifiers: ['Shift'] })
  await win.waitForTimeout(200)
  await win.getByTitle('Sort…', { exact: false }).first().click().catch(async () => { await win.getByRole('button', { name: /^Sort/ }).first().click() })
  const dlg = win.locator(DLG).first()
  const opened = await dlg.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false)
  if (!opened) await shot(win, 'AM-sort-missing')
  R.ok(opened, 'calc: Sort opens as a JSDialog rendered by us')
  R.ok((await dlg.getAttribute('data-dialogid')) === 'SortDialog', 'calc: it is the engine\'s SortDialog tree')
  R.ok((await win.locator(TUNNEL).count()) === 0, 'calc: no bitmap tunnel window for the same dialog')
  await shot(win, 'AM-sort')
  // Descending, then OK.
  const desc = dlg.locator('[data-wid="down"]').first()
  R.ok(await desc.isVisible().catch(() => false), 'calc: the Descending radio is there')
  await desc.check().catch(async () => { await desc.click() })
  await win.waitForTimeout(250)
  await dlg.locator('[data-wid="ok"]').first().click()
  R.ok(await poll(async () => !(await dlg.isVisible().catch(() => false)), { timeout: 6000 }), 'calc: OK closes the dialog (engine close message)')
  const sorted = await poll(async () => {
    await save(win)
    const xml = docXml(xlsx, 'Excel')
    const a = (r) => { const m = xml.match(new RegExp(`<c r="A${r}"[^>]*>(?:<f>[^<]*</f>)?<v>([^<]+)</v>`)); return m ? Number(m[1]) : null }
    return a(1) === 3 && a(3) === 1
  }, { timeout: 20000, interval: 800 })
  R.ok(sorted, 'calc: the column is sorted descending in the saved .xlsx (3, 2, 1)')

  // ── Writer: Paragraph dialog from the context menu (tabs) ───────────
  await newDoc(win, 'Word')
  await focusDoc(win)
  await type(win, 'Paragraph dialog test')
  await wrap.click({ button: 'right', position: { x: 140, y: 90 }, force: true })
  const menu = win.locator('[data-testid="context-menu"]').first()
  await menu.waitFor({ state: 'visible', timeout: 4000 })
  await menu.locator('[role=menuitem]', { hasText: 'Paragraph' }).first().hover()
  await menu.locator('[role=menuitem]', { hasText: 'Paragraph…' }).first().waitFor({ state: 'visible', timeout: 3000 })
  await menu.locator('[role=menuitem]', { hasText: 'Paragraph…' }).first().click()
  const pdlg = win.locator(DLG).first()
  let popened = await pdlg.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)
  if (!popened) {
    // A pointer path across the submenu can close the menu without a pick; retry once.
    await wrap.click({ button: 'right', position: { x: 140, y: 90 }, force: true })
    await menu.waitFor({ state: 'visible', timeout: 4000 })
    await menu.locator('[role=menuitem]', { hasText: 'Paragraph' }).first().hover()
    const sub = menu.locator('[role=menuitem]', { hasText: 'Paragraph…' }).first()
    await sub.waitFor({ state: 'visible', timeout: 3000 })
    await sub.evaluate((el) => el.click())
    popened = await pdlg.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false)
  }
  if (!popened) await shot(win, 'AM-paragraph-missing')
  R.ok(popened, 'writer: Paragraph… from the context menu opens as a JSDialog')
  const tabs = await pdlg.locator('[role=tab]').count()
  R.ok(tabs >= 3, `writer: the dialog shows its tab pages (${tabs})`)
  await pdlg.locator('[role=tab]').nth(1).click()
  await win.waitForTimeout(400)
  const widgets = await pdlg.locator('[role=tabpanel], [class*=tabpage]').first().locator('input, select, label').count()
  R.ok(widgets >= 3, `writer: the Alignment page shows its controls after the switch (${widgets})`)
  await shot(win, 'AM-paragraph')
  await win.keyboard.press('Escape')
  R.ok(await poll(async () => !(await pdlg.isVisible().catch(() => false)), { timeout: 5000 }), 'writer: Escape closes it')
} catch (e) {
  R.ok(false, `unexpected: ${e.message}`)
  console.log(e.stack)
} finally {
  await app.close().catch(() => {})
}
process.exit(R.done() ? 0 : 1)
