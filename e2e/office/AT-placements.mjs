// Phase AT — the leftover §4–§6 placements, LIVE app on the REAL engine.
// Writer: References ▸ Table of Contents (one click) and Layout ▸ Watermark
// land in the .docx. Calc: Home ▸ cell style gallery, Layout ▸ Landscape,
// Formulas ▸ Show formulas, Data ▸ Text to columns (engine dialog). Impress:
// find & replace through the engine, Insert ▸ Slide number field,
// Shape ▸ Duplicate.
import fs from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { launch, newDoc, focusDoc, type, save, docXml, poll, makeReporter, enginePresent, shot, TESTROOT } from './_harness.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

if (!enginePresent()) { console.log('SKIP: engine missing'); process.exit(0) }
const R = makeReporter('AT placements')
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
const zipPart = (file, part) => { try { return execSync(`unzip -p '${file}' ${part}`, { encoding: 'utf8' }) } catch { return '' } }

try {
  // ── Writer ──────────────────────────────────────────────────────────────
  await newDoc(win, 'Word')
  await poll(async () => !!newest(/^New Document.*\.docx$/), { timeout: 20000 })
  const docx = newest(/^New Document.*\.docx$/)
  await focusDoc(win)
  await tab('Home').click()
  await win.locator('select[title="Paragraph style"], select[title*="style" i]').first().selectOption({ label: 'Heading 1' }).catch(() => {})
  await type(win, 'Introduction\n')
  await win.keyboard.press('Control+Home')
  await tab('References').click()
  R.ok(await win.locator('[data-testid="ribbon-references-tab"]').isVisible(), 'writer: a References tab')
  await win.locator('[data-testid="toc-insert"]').click()
  const toc = await poll(async () => { await save(win); return /Table of Contents/.test(docXml(docx)) }, { timeout: 20000, interval: 800 })
  R.ok(toc, 'References ▸ Table of Contents inserts one into the saved .docx')
  await tab('Layout').click()
  await win.locator('[data-testid="watermark"]').selectOption('office.watermark:DRAFT')
  const wm = await poll(async () => { await save(win); const h = [1, 2, 3].map((i) => zipPart(docx, `word/header${i}.xml`)).join(''); return /DRAFT/.test(h) || /Watermark/i.test(h) }, { timeout: 20000, interval: 800 })
  R.ok(wm, 'Layout ▸ Watermark ▸ Draft lands in the saved header')
  await shot(win, 'AT-writer')

  // ── Calc ────────────────────────────────────────────────────────────────
  await newDoc(win, 'Excel')
  await poll(async () => !!newest(/^New Spreadsheet.*\.xlsx$/), { timeout: 20000 })
  const xlsx = newest(/^New Spreadsheet.*\.xlsx$/)
  await focusDoc(win)
  await type(win, '42\n')
  await win.keyboard.press('ArrowUp')
  await tab('Home').click()
  await win.locator('[data-testid="cell-styles"]').selectOption({ label: 'Accent 1' })
  const styled = await poll(async () => { await save(win); return /<c r="A1" s="[1-9]\d*"/.test(docXml(xlsx, 'Excel')) }, { timeout: 20000, interval: 800 })
  R.ok(styled, 'Home ▸ Cell styles ▸ Accent 1 styles the saved cell')
  await tab('Layout').click()
  R.ok(await win.locator('[data-testid="ribbon-calc-layout-tab"]').isVisible(), 'calc: a Layout tab')
  await win.getByTitle('Landscape', { exact: true }).last().click()
  const landscape = await poll(async () => { await save(win); return /orientation="landscape"/.test(docXml(xlsx, 'Excel')) }, { timeout: 20000, interval: 800 })
  R.ok(landscape, 'Layout ▸ Landscape lands in the saved sheet')
  await tab('Formulas').click()
  R.ok(await win.locator('[data-testid="ribbon-formulas-tab"]').isVisible(), 'calc: a Formulas tab')
  const showF = win.locator('[data-testid="show-formulas"]')
  await showF.click()
  R.ok(await poll(async () => /Active/.test((await showF.getAttribute('class')) ?? ''), { timeout: 8000 }), 'Formulas ▸ Show formulas toggles (engine state lit)')
  await showF.click()
  await tab('Data').click()
  await win.locator('[data-testid="text-to-columns"]').click()
  R.ok(await poll(async () => (await win.locator('[data-testid="jsdialog"]').count()) > 0, { timeout: 10000 }), 'Data ▸ Text to columns opens the engine dialog as ours')
  await shot(win, 'AT-calc')
  await win.keyboard.press('Escape')
  await poll(async () => (await win.locator('[data-testid="jsdialog"]').count()) === 0, { timeout: 8000 })

  // ── Impress ─────────────────────────────────────────────────────────────
  await newDoc(win, 'PowerPoint')
  await poll(async () => !!newest(/^New Presentation.*\.pptx$/), { timeout: 20000 })
  const pptx = newest(/^New Presentation.*\.pptx$/)
  await win.evaluate(() => window.workspace.lok.officeMacro('WosSlideText', 'set|0|Sales review|alpha beta\talpha gamma'))
  await win.waitForTimeout(500)
  await tab('Review').click()
  await win.getByTitle('Find & replace', { exact: false }).first().click().catch(async () => { await win.keyboard.press('Meta+F') })
  const findBox = win.locator('input[placeholder*="Find" i]').first()
  await findBox.fill('alpha')
  const replBox = win.locator('input[placeholder*="Replace" i]').first()
  await replBox.fill('omega')
  await win.getByTitle('Replace all matches').click()
  const replaced = await poll(async () => { await save(win); return /omega beta/.test(docXml(pptx, 'PowerPoint')) && !/alpha/.test(docXml(pptx, 'PowerPoint')) }, { timeout: 20000, interval: 800 })
  R.ok(replaced, 'impress: Replace all through the engine changes the saved .pptx')
  await win.keyboard.press('Escape')
  // A field goes into text: enter the title placeholder first.
  const wrapI = await win.locator('[class*=docWrap]').first().boundingBox()
  await win.mouse.dblclick(wrapI.x + wrapI.width / 2, wrapI.y + wrapI.height * 0.16)
  await win.waitForTimeout(600)
  await win.keyboard.type('Slide ')
  await tab('Insert').click()
  await win.locator('[data-testid="slide-number"]').click()
  const fld = await poll(async () => { await save(win); return /type="slidenum"/.test(docXml(pptx, 'PowerPoint')) }, { timeout: 20000, interval: 800 })
  R.ok(fld, 'Insert ▸ Slide number inserts a slide-number field')
  await win.keyboard.press('Escape'); await win.keyboard.press('Escape')
  await win.waitForTimeout(400)
  await tab('Design').click()
  await win.getByTitle('Rectangle', { exact: true }).first().click()
  await poll(async () => win.locator('[data-testid="graphic-sel"]').isVisible().catch(() => false), { timeout: 8000 })
  await win.waitForTimeout(800)
  await tab('Shape').click().catch(() => {})
  const shapesBefore = (docXml(pptx, 'PowerPoint').match(/<p:sp>/g) ?? []).length
  await win.locator('[data-testid="shape-duplicate"]').click()
  await win.waitForTimeout(1200)
  await win.keyboard.press('Enter')
  const dup = await poll(async () => { await save(win); return (docXml(pptx, 'PowerPoint').match(/<p:sp>/g) ?? []).length > shapesBefore }, { timeout: 20000, interval: 800 })
  R.ok(dup, 'Shape ▸ Duplicate… → OK adds a copy to the saved slide')
  await shot(win, 'AT-impress')
} catch (e) {
  R.ok(false, `unexpected: ${e.message}`)
  console.log(e.stack)
} finally {
  await app.close().catch(() => {})
}
process.exit(R.done() ? 0 : 1)
