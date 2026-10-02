// Phase AS — B6c + B8 affordances, LIVE app on the REAL engine.
// Calc: outline +/− bar from Data ▸ Group (hide collapses rows in the saved
// file). Writer: ruler shows page margins and indents, a dragged indent lands
// in the .docx; table grips appear on a table, the + inserts a column; print
// preview shows every page. Impress: smart guides during a shape drag;
// slide sorter and outline view (an outline edit lands in the .pptx).
import fs from 'node:fs'
import path from 'node:path'
import { launch, newDoc, focusDoc, type, save, docXml, poll, makeReporter, enginePresent, shot, TESTROOT } from './_harness.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

if (!enginePresent()) { console.log('SKIP: engine missing'); process.exit(0) }
const R = makeReporter('AS affordances 3')
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
const tab = (name) => win.getByRole('button', { name, exact: true }).last()
const menuClick = (labels) => app.evaluate(({ Menu }, labels) => {
  let items = Menu.getApplicationMenu()?.items ?? []
  let item = null
  for (const l of labels) { item = items.find((i) => i.label === l); if (!item) return `missing: ${l}`; items = item.submenu?.items ?? [] }
  item.click()
  return 'ok'
}, labels)
const macro = (name, args) => win.evaluate(([n, a]) => window.workspace.lok.officeMacro(n, a).then((r) => r.raw), [name, args])

try {
  // ── Calc: outline bar ───────────────────────────────────────────────────
  await newDoc(win, 'Excel')
  await poll(async () => !!newest(/^New Spreadsheet.*\.xlsx$/), { timeout: 20000 })
  const xlsx = newest(/^New Spreadsheet.*\.xlsx$/)
  await focusDoc(win)
  await type(win, '1\n2\n3\n4\n5\n')
  // Select A2:A4 and group it from the Data tab.
  await win.keyboard.press('Control+Home')
  await win.keyboard.press('ArrowDown')
  await win.keyboard.press('Shift+ArrowDown'); await win.keyboard.press('Shift+ArrowDown')
  await win.waitForTimeout(300)
  await tab('Data').click()
  await win.locator('[data-testid="outline-group"]').click()
  const minus = win.locator('[data-testid^="outline-row-"]').first()
  R.ok(await poll(async () => (await minus.count()) > 0, { timeout: 10000 }), 'calc: Data ▸ Group draws a − button beside the row headers')
  R.ok((await minus.innerText().catch(() => '')) === '−', '… showing the group is expanded')
  await minus.click()
  R.ok(await poll(async () => (await minus.innerText().catch(() => '')) === '+', { timeout: 10000 }), 'clicking it collapses the group (button flips to +)')
  const collapsed = await poll(async () => { await save(win); return /<row r="\d+"[^>]*hidden="(1|true)"/.test(docXml(xlsx, 'Excel')) }, { timeout: 20000, interval: 800 })
  R.ok(collapsed, 'the saved .xlsx hides the grouped rows')
  await shot(win, 'AS-outline')

  // ── Writer: ruler, table grips, print preview ───────────────────────────
  await newDoc(win, 'Word')
  await poll(async () => !!newest(/^New Document.*\.docx$/), { timeout: 20000 })
  const docx = newest(/^New Document.*\.docx$/)
  await focusDoc(win)
  await type(win, 'Ruler paragraph')
  R.ok(await poll(async () => win.locator('[data-testid="ruler"]').isVisible().catch(() => false), { timeout: 10000 }), 'writer: a ruler above the page')
  const left = win.locator('[data-testid="ruler-left"]')
  const lb = await left.boundingBox()
  await win.mouse.move(lb.x + lb.width / 2, lb.y + 3)
  await win.mouse.down()
  await win.mouse.move(lb.x + 60, lb.y + 3, { steps: 6 })
  await win.mouse.up()
  const indented = await poll(async () => { await save(win); return /<w:ind [^>]*w:(start|left)="\d{3,}"/.test(docXml(docx)) }, { timeout: 20000, interval: 800 })
  R.ok(indented, 'dragging the left indent lands in the saved .docx')
  R.ok(await poll(async () => { const b = await left.boundingBox(); return b && b.x > lb.x + 20 }, { timeout: 8000 }), '… and the marker follows the paragraph')
  await shot(win, 'AS-ruler')
  await win.keyboard.press('End'); await win.keyboard.press('Enter')
  await tab('Insert').click()
  await win.getByTitle('Insert table', { exact: false }).first().click()
  await win.getByRole('button', { name: /^Insert$/ }).first().click().catch(async () => { await win.keyboard.press('Enter') })
  R.ok(await poll(async () => win.locator('[data-testid="table-grips"]').isVisible().catch(() => false), { timeout: 10000 }), 'writer: grips appear around the table under the cursor')
  const colsBefore = (docXml(docx).match(/<w:gridCol /g) ?? []).length
  const grip = win.locator('[data-testid="table-col-grip"]').first()
  await grip.hover()
  await win.locator('[data-testid="table-col-insert"]').first().click({ force: true })
  const grew = await poll(async () => { await save(win); return (docXml(docx).match(/<w:gridCol /g) ?? []).length > Math.max(colsBefore, 1) }, { timeout: 20000, interval: 800 })
  R.ok(grew, 'the + on a column grip inserts a column into the saved table')
  await shot(win, 'AS-table-grips')
  await tab('View').click()
  await win.locator('[data-testid="mode-preview"]').click()
  R.ok(await poll(async () => (await win.locator('[data-testid="preview-page"]').count()) >= 1, { timeout: 10000 }), 'View ▸ Print preview shows the page(s)')
  await shot(win, 'AS-print-preview')
  await win.locator('[data-testid="view-close"]').click()

  // ── Impress: smart guides, sorter, outline ──────────────────────────────
  await newDoc(win, 'PowerPoint')
  await poll(async () => !!newest(/^New Presentation.*\.pptx$/), { timeout: 20000 })
  const pptx = newest(/^New Presentation.*\.pptx$/)
  await tab('Design').click()
  await win.getByTitle('Rectangle', { exact: true }).first().click()
  await poll(async () => win.locator('[data-testid="graphic-sel"]').isVisible().catch(() => false), { timeout: 8000 })
  await win.waitForTimeout(1000)
  // A real click on the shape first: a drag only arms on an engine-owned selection.
  const sel0 = await win.locator('[data-testid="graphic-sel"]').boundingBox()
  const wrap0 = await win.locator('[class*=docWrap]').first().boundingBox()
  await win.keyboard.press('Escape')
  await win.mouse.click(wrap0.x + wrap0.width - 20, wrap0.y + wrap0.height - 20) // empty slide corner: deselect
  await win.waitForTimeout(500)
  await win.mouse.click(sel0.x + sel0.width / 2, sel0.y + sel0.height / 2)
  await win.waitForTimeout(800)
  const sel = await win.locator('[data-testid="graphic-sel"]').boundingBox()
  const wrap = await win.locator('[class*=docWrap]').first().boundingBox()
  // Drag the shape so its centre approaches the slide's vertical centre line.
  const targetX = wrap.x + wrap.width / 2
  await win.mouse.move(sel.x + sel.width / 2, sel.y + sel.height / 2)
  await win.mouse.down()
  await win.mouse.move(sel.x + sel.width / 2 + 30, sel.y + sel.height / 2 + 30, { steps: 4 })
  await win.mouse.move(targetX + 3, sel.y + sel.height / 2 + 30, { steps: 8 })
  const guideShown = await win.locator('[class*=guideV]').count()
  await win.mouse.up()
  R.ok(guideShown > 0, 'impress: a smart guide appears when the dragged shape meets the slide centre')
  await win.waitForTimeout(800)
  const after = await win.locator('[data-testid="graphic-sel"]').boundingBox()
  const off = after ? Math.abs((after.x + after.width / 2) - targetX) : 999
  R.ok(off <= 3, `… and the shape snaps onto the centre line (off by ${off.toFixed(1)} px)`)
  await shot(win, 'AS-smart-guides')
  await win.keyboard.press('Escape')
  await tab('View').click()
  await win.locator('[data-testid="mode-sorter"]').click()
  R.ok(await poll(async () => (await win.locator('[data-testid="sorter-slide"]').count()) === 1, { timeout: 10000 }), 'View ▸ Sorter shows every slide as a card')
  await win.locator('[data-testid="view-close"]').click()
  await win.locator('[data-testid="mode-outline"]').click()
  R.ok(await poll(async () => (await win.locator('[data-testid="outline-slide"]').count()) === 1, { timeout: 10000 }), 'View ▸ Outline lists the slides')
  const title = win.locator('[data-testid="outline-title"]').first()
  await title.fill('Quarterly review')
  await title.press('Enter')
  await win.waitForTimeout(800)
  const body = win.locator('[data-testid="outline-body"]').first()
  await body.fill('Revenue up\nCosts flat')
  await body.blur()
  const inFile = await poll(async () => { await save(win); const x = docXml(pptx, 'PowerPoint'); return /Quarterly review/.test(x) && /Costs flat/.test(x) }, { timeout: 20000, interval: 800 })
  R.ok(inFile, 'outline edits (title + bullets) land in the saved .pptx')
  await shot(win, 'AS-outline-view')
  await win.locator('[data-testid="view-close"]').click()
} catch (e) {
  R.ok(false, `unexpected: ${e.message}`)
  console.log(e.stack)
} finally {
  await app.close().catch(() => {})
}
process.exit(R.done() ? 0 : 1)
