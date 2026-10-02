// Phase AR — Impress transitions and animations, LIVE app on the REAL engine.
// Animations tab adds engine presets to the selected shape; the Animation pane
// lists, reorders and removes them; the saved .pptx carries PowerPoint preset
// ids and node types. Transitions tab sets a slide transition with automatic
// advance, applies it to all slides, and the slideshow honours the advance.
import fs from 'node:fs'
import path from 'node:path'
import { launch, newDoc, save, docXml, poll, makeReporter, enginePresent, shot, TESTROOT } from './_harness.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

if (!enginePresent()) { console.log('SKIP: engine missing'); process.exit(0) }
const R = makeReporter('AR transitions + animations')
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
const rows = () => win.locator('[data-testid="animation-row"]')
const rowNames = async () => rows().locator('[title^="ooo-"]').allInnerTexts()

try {
  await newDoc(win, 'PowerPoint')
  await poll(async () => !!newest(/^New Presentation.*\.pptx$/), { timeout: 20000 })
  const pptx = newest(/^New Presentation.*\.pptx$/)
  const slide = () => docXml(pptx, 'PowerPoint')

  // ── Animations ─────────────────────────────────────────────────────────
  await tab('Design').click()
  await win.getByTitle('Rectangle', { exact: true }).first().click()
  await poll(async () => win.locator('[data-testid="graphic-sel"]').isVisible().catch(() => false), { timeout: 8000 })
  await tab('Animations').click()
  R.ok(await win.locator('[data-testid="ribbon-animations-tab"]').isVisible(), 'impress: an Animations tab with entrance / emphasis / exit presets')
  await win.locator('[data-testid="anim-ooo-entrance-fly-in"]').click()
  R.ok(await poll(async () => (await rows().count()) === 1, { timeout: 10000 }), 'Fly in on the selected shape opens the Animation pane with one effect')
  await win.locator('[data-testid="ribbon-animations-tab"] select').selectOption('2')
  await win.locator('[data-testid="anim-ooo-emphasis-spin"]').click()
  R.ok(await poll(async () => (await rows().count()) === 2, { timeout: 10000 }), 'Spin (with previous) makes two effects')
  R.ok((await rowNames()).join(',') === 'Fly in,Spin', `pane lists them in play order (${(await rowNames()).join(',')})`)
  await rows().nth(1).getByTitle('Move up').click()
  R.ok(await poll(async () => (await rowNames())[0] === 'Spin', { timeout: 10000 }), 'Move up reorders the sequence in the engine')
  await shot(win, 'AR-animation-pane')
  const saved = await poll(async () => { await save(win); return /presetID="8" presetClass="emph"/.test(slide()) && /presetID="2" presetClass="entr"/.test(slide()) }, { timeout: 20000, interval: 800 })
  R.ok(saved, 'the saved .pptx carries both effects as PowerPoint presets (spin 8, fly in 2)')
  R.ok(/nodeType="clickEffect"/.test(slide()) && /nodeType="withEffect"/.test(slide()), '… with their triggers (click, with previous)')
  await rows().first().locator('[data-testid="animation-remove"]').click()
  R.ok(await poll(async () => (await rows().count()) === 1, { timeout: 10000 }), 'Remove drops one effect')
  const one = await poll(async () => { await save(win); return (slide().match(/presetID=/g) ?? []).length === 1 }, { timeout: 20000, interval: 800 })
  R.ok(one, '… and the saved file keeps only the other')

  // ── Transitions ────────────────────────────────────────────────────────
  await tab('Transitions').click()
  R.ok(await win.locator('[data-testid="ribbon-transitions-tab"]').isVisible(), 'a Transitions tab with a gallery and timing')
  await win.locator('[data-testid="transition-fade"]').click()
  R.ok(await poll(async () => /Active/.test((await win.locator('[data-testid="transition-fade"]').getAttribute('class')) ?? ''), { timeout: 8000 }), 'Fade reads back as the slide\'s transition')
  // Controlled checkbox: the state flips once the engine reads the slide back.
  await win.locator('[data-testid="transition-auto"]').click()
  R.ok(await poll(async () => win.locator('[data-testid="transition-auto"]').isChecked(), { timeout: 8000 }), 'Advance ▸ After reads back as automatic')
  const adv = win.locator('[data-testid="transition-advance"]')
  await adv.fill('1')
  await adv.blur()
  await win.waitForTimeout(500)
  await win.locator('[data-testid="transition-all"]').click()
  const trans = await poll(async () => { await save(win); return /<p:fade\/>/.test(slide()) && /advTm="1000"/.test(slide()) }, { timeout: 20000, interval: 800 })
  R.ok(trans, 'saved .pptx: <p:fade/> with advTm="1000"')
  await shot(win, 'AR-transitions-tab')

  // A second slide inherits the "apply to all" transition; the slideshow advances by itself.
  await tab('Home').click()
  await win.getByTitle('New slide', { exact: true }).first().click()
  await poll(async () => /Slide 2 of 2/.test(await win.locator('[data-testid="status-bar"]').innerText().catch(() => '')), { timeout: 10000 })
  await tab('Transitions').click()
  await win.locator('[data-testid="transition-all"]').click()
  await win.waitForTimeout(600)
  await win.locator('[class*=thumb]').first().click().catch(() => {})
  await poll(async () => /Slide 1 of 2/.test(await win.locator('[data-testid="status-bar"]').innerText().catch(() => '')), { timeout: 10000 })
  // Slide Show ▸ Start from First Slide through the native menu (as AN does).
  await app.evaluate(({ Menu }) => {
    const top = Menu.getApplicationMenu()?.items.find((i) => i.label === 'Slide Show')
    const item = top?.submenu?.items.find((i) => i.label === 'Start from First Slide')
    item?.click()
  })
  const idx = () => win.evaluate(() => document.querySelector('[data-testid="present-index"]')?.textContent ?? null)
  await poll(async () => (await idx()) !== null, { timeout: 8000 })
  const start = await idx()
  R.ok(await poll(async () => (await idx()) === '1', { timeout: 6000 }), `slideshow advances on its own after 1 s (from ${start})`)
  await win.keyboard.press('Escape')
} catch (e) {
  R.ok(false, `unexpected: ${e.message}`)
  console.log(e.stack)
} finally {
  await app.close().catch(() => {})
}
process.exit(R.done() ? 0 : 1)
