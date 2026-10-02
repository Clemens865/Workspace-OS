// Phase AN — the native menu bar mirrors LibreOffice per app, in the LIVE
// app on the REAL engine: Writer gets Styles/Table/Tools, Calc gets
// Sheet/Data, Impress gets Slide/Slide Show; a deep item (Format ▸ Text ▸
// Double Underline) dispatches and lands in the saved file; toggles carry
// the engine's check mark; the ⌘K palette runs the same commands.
import fs from 'node:fs'
import path from 'node:path'
import { launch, newDoc, focusDoc, type, selectAll, save, docXml, poll, makeReporter, enginePresent, shot, TESTROOT } from './_harness.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

if (!enginePresent()) { console.log('SKIP: engine missing'); process.exit(0) }
const R = makeReporter('AN menubar')
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

/** Top-level menu labels of the application menu. */
const topLabels = () => app.evaluate(({ Menu }) => (Menu.getApplicationMenu()?.items ?? []).map((i) => i.label))
/** Walk a label path and click the item (runs its click handler in main). */
const clickPath = (labels) => app.evaluate(({ Menu }, labels) => {
  let items = Menu.getApplicationMenu()?.items ?? []
  let item = null
  for (const l of labels) {
    item = items.find((i) => i.label === l)
    if (!item) return `missing: ${l}`
    items = item.submenu?.items ?? []
  }
  item.click()
  return 'ok'
}, labels)
const itemState = (labels) => app.evaluate(({ Menu }, labels) => {
  let items = Menu.getApplicationMenu()?.items ?? []
  let item = null
  for (const l of labels) { item = items.find((i) => i.label === l); if (!item) return null; items = item.submenu?.items ?? [] }
  return { checked: item.checked, enabled: item.enabled, type: item.type }
}, labels)

try {
  // ── Writer ─────────────────────────────────────────────────────────────
  await newDoc(win, 'Word')
  await poll(async () => !!newest(/^New Document.*\.docx$/), { timeout: 20000 })
  const docx = newest(/^New Document.*\.docx$/)
  await poll(async () => (await topLabels()).includes('Table'), { timeout: 8000 })
  const wl = await topLabels()
  R.ok(['Edit', 'View', 'Insert', 'Format', 'Styles', 'Table', 'Tools'].every((l) => wl.includes(l)), `writer: menu bar has ${wl.filter((l) => ['Styles', 'Table', 'Tools'].includes(l)).join(', ')}`)
  R.ok(!wl.includes('Sheet') && !wl.includes('Slide'), 'writer: no Sheet/Slide menus')
  await focusDoc(win)
  await type(win, 'Menu bar text')
  await selectAll(win)
  R.ok((await clickPath(['Format', 'Text', 'Double Underline'])) === 'ok', 'writer: Format ▸ Text ▸ Double Underline is a menu item')
  const dbl = await poll(async () => { await save(win); return /<w:u w:val="double"/.test(docXml(docx)) }, { timeout: 20000, interval: 800 })
  R.ok(dbl, 'writer: the double underline from the menu is in the saved .docx')
  // A deep toggle shows the engine's state: View ▸ Formatting Marks flips its check mark.
  const before = (await itemState(['View', 'Formatting Marks']))?.checked
  await clickPath(['View', 'Formatting Marks'])
  const flipped = await poll(async () => (await itemState(['View', 'Formatting Marks']))?.checked === !before, { timeout: 6000 })
  R.ok(flipped, `writer: View ▸ Formatting Marks check mark follows the engine (${before} → ${!before})`)
  await clickPath(['View', 'Formatting Marks'])
  // Table menu: Insert Table… opens our dialog.
  await clickPath(['Table', 'Insert Table…'])
  R.ok(await win.getByText('Insert table', { exact: false }).first().waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false), 'writer: Table ▸ Insert Table… opens the table dialog')
  await win.keyboard.press('Escape')
  await win.waitForTimeout(200)
  // ⌘K palette runs the same commands.
  await selectAll(win)
  await win.keyboard.press('Meta+k')
  const palette = win.locator('input[placeholder*="Search files"]').first()
  R.ok(await palette.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false), 'palette: ⌘K opens')
  await palette.fill('overline')
  const cmd = win.locator('[data-testid="palette-command"]').first()
  R.ok(await cmd.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false), 'palette: typing "overline" lists the Format ▸ Text command')
  await shot(win, 'AN-palette')
  await win.keyboard.press('Enter')
  R.ok(await poll(async () => !(await palette.isVisible().catch(() => false)), { timeout: 4000 }), 'palette: Enter runs the command and closes the palette')
  const ov = await poll(async () => { await save(win); return /<w:u w:val="double"/.test(docXml(docx)) }, { timeout: 12000, interval: 800 })
  R.ok(ov, 'palette: the document still saves cleanly afterwards')

  // ── Calc ───────────────────────────────────────────────────────────────
  await newDoc(win, 'Excel')
  await poll(async () => (await topLabels()).includes('Sheet'), { timeout: 8000 })
  const cl = await topLabels()
  R.ok(cl.includes('Sheet') && cl.includes('Data') && !cl.includes('Table'), `calc: menu bar has Sheet and Data (${cl.length} menus)`)
  await focusDoc(win)
  R.ok((await clickPath(['Data', 'Sort…'])) === 'ok', 'calc: Data ▸ Sort… is a menu item')
  const sortDlg = win.locator('[data-testid="jsdialog"]').first()
  R.ok(await sortDlg.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false), 'calc: … and opens the engine Sort dialog')
  await win.keyboard.press('Escape')
  await win.waitForTimeout(300)
  R.ok((await itemState(['File', 'Save']))?.enabled === true, 'calc: File ▸ Save is present for an office document')
  R.ok((await itemState(['File', 'Export', 'Excel (.xlsx)']))?.enabled === true, 'calc: File ▸ Export lists the spreadsheet formats')

  // ── Impress ────────────────────────────────────────────────────────────
  await newDoc(win, 'PowerPoint')
  await poll(async () => (await topLabels()).includes('Slide Show'), { timeout: 8000 })
  const pl = await topLabels()
  R.ok(pl.includes('Slide') && pl.includes('Slide Show') && !pl.includes('Data'), 'impress: menu bar has Slide and Slide Show')
  const slides = () => win.locator('[data-slide-tab]').count()
  await clickPath(['Slide', 'Duplicate Slide'])
  R.ok(await poll(async () => (await slides()) === 2, { timeout: 8000 }), 'impress: Slide ▸ Duplicate Slide adds a slide')
  await clickPath(['Slide Show', 'Start from First Slide'])
  R.ok(await win.locator('[class*=present]').first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false), 'impress: Slide Show ▸ Start from First Slide presents')
  await win.keyboard.press('Escape')
} catch (e) {
  R.ok(false, `unexpected: ${e.message}`)
  console.log(e.stack)
} finally {
  await app.close().catch(() => {})
}
process.exit(R.done() ? 0 : 1)
