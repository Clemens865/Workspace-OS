// Phase AQ — contextual ribbon tabs and view modes, LIVE app on the REAL engine.
// Writer: a table under the cursor opens the Table tab; "row below" grows the
// saved table. Impress: a selected shape opens the Shape tab; Flip lands in
// the saved .pptx; Notes and Master views change what the engine renders.
// Writer Web layout and Calc Page Break reshape the document.
import fs from 'node:fs'
import path from 'node:path'
import { launch, newDoc, focusDoc, type, save, docXml, poll, makeReporter, enginePresent, shot, TESTROOT } from './_harness.mjs'

if (!enginePresent()) { console.log('SKIP: engine missing'); process.exit(0) }
const R = makeReporter('AQ context + modes')
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
const wrap = win.locator('[class*=docWrap]').first()
const docSize = () => wrap.boundingBox().then((b) => ({ w: Math.round(b.width), h: Math.round(b.height) }))
const tab = (name) => win.getByRole('button', { name, exact: true }).last()

try {
  // ── Writer: Table tab ──────────────────────────────────────────────────
  await newDoc(win, 'Word')
  await poll(async () => !!newest(/^New Document.*\.docx$/), { timeout: 20000 })
  const docx = newest(/^New Document.*\.docx$/)
  await focusDoc(win)
  await tab('Insert').click()
  await win.getByTitle('Insert table', { exact: false }).first().click()
  await win.getByRole('button', { name: /^Insert$/ }).first().click().catch(async () => { await win.keyboard.press('Enter') })
  const tableTab = win.locator('[data-testid="ribbon-context-tab"]')
  R.ok(await poll(async () => (await tableTab.innerText().catch(() => '')) === 'Table', { timeout: 8000 }), 'writer: a table under the cursor adds a Table tab')
  R.ok(await win.locator('[data-testid="ribbon-table-tab"]').isVisible().catch(() => false), 'writer: … and switches to it')
  const rowsBefore = (docXml(docx).match(/<w:tr[ >]/g) ?? []).length
  await win.locator('[data-testid="table-row-below"]').click()
  const grew = await poll(async () => { await save(win); return (docXml(docx).match(/<w:tr[ >]/g) ?? []).length > Math.max(rowsBefore, 1) }, { timeout: 20000, interval: 800 })
  R.ok(grew, 'writer: Table ▸ row below grows the saved table')
  await shot(win, 'AQ-table-tab')
  // Web layout reshapes the page.
  await tab('View').click()
  const normal = await docSize()
  await win.locator('[data-testid="mode-web"]').click()
  R.ok(await poll(async () => (await docSize()).w !== normal.w, { timeout: 8000 }), 'writer: View ▸ Web changes the layout')
  await win.locator('[data-testid="mode-normal"]').click()
  R.ok(await poll(async () => (await docSize()).w === normal.w, { timeout: 8000 }), 'writer: View ▸ Normal restores it')

  // ── Calc: Page Break view ─────────────────────────────────────────────
  await newDoc(win, 'Excel')
  await tab('View').click()
  const cn = await docSize()
  await win.locator('[data-testid="mode-pagebreak"]').click()
  R.ok(await poll(async () => (await docSize()).h !== cn.h, { timeout: 8000 }), 'calc: View ▸ Page break changes the sheet view')
  await win.locator('[data-testid="mode-normal"]').click()
  await poll(async () => (await docSize()).h === cn.h, { timeout: 8000 })

  // ── Impress: Shape tab, Notes and Master views ────────────────────────
  await newDoc(win, 'PowerPoint')
  await poll(async () => !!newest(/^New Presentation.*\.pptx$/), { timeout: 20000 })
  const pptx = newest(/^New Presentation.*\.pptx$/)
  await tab('Design').click()
  // An arrow, not a rectangle: a mirrored rectangle is symmetric and exports without flipH.
  await win.getByTitle('Arrow', { exact: true }).first().click()
  await win.waitForTimeout(700)
  if (!(await win.locator('[data-testid="graphic-sel"]').isVisible().catch(() => false))) {
    const b = await wrap.boundingBox()
    await wrap.click({ position: { x: b.width / 2, y: b.height / 2 }, force: true })
  }
  const shapeTab = win.locator('[data-testid="ribbon-context-tab"]')
  R.ok(await poll(async () => /Shape|Picture/.test(await shapeTab.innerText().catch(() => '')), { timeout: 8000 }), 'impress: a selected shape adds a Shape tab')
  R.ok(await win.locator('[data-testid="ribbon-shape-tab"]').isVisible().catch(() => false), 'impress: … and switches to it')
  await win.getByTitle('Flip horizontally', { exact: true }).click()
  const flipped = await poll(async () => { await save(win); return /flipH="1"/.test(docXml(pptx, 'PowerPoint')) }, { timeout: 20000, interval: 800 })
  R.ok(flipped, 'impress: Shape ▸ Flip horizontally lands in the saved .pptx')
  await shot(win, 'AQ-shape-tab')
  await tab('View').click()
  const slide = await docSize()
  await win.locator('[data-testid="mode-notes"]').click()
  R.ok(await poll(async () => (await docSize()).h > slide.h * 1.3, { timeout: 8000 }), 'impress: View ▸ Notes renders the notes page (taller than the slide)')
  await shot(win, 'AQ-notes-view')
  await win.locator('[data-testid="mode-normal"]').click()
  await poll(async () => Math.abs((await docSize()).h - slide.h) < 4, { timeout: 8000 })
  await win.locator('[data-testid="mode-master"]').click()
  R.ok(await poll(async () => (await win.locator('[data-testid="mode-master"]').getAttribute('class'))?.includes('Active') ?? false, { timeout: 8000 }), 'impress: View ▸ Master enters master editing (engine state lit)')
  await win.locator('[data-testid="mode-master"]').click()
  await win.waitForTimeout(500)
} catch (e) {
  R.ok(false, `unexpected: ${e.message}`)
  console.log(e.stack)
} finally {
  await app.close().catch(() => {})
}
process.exit(R.done() ? 0 : 1)
