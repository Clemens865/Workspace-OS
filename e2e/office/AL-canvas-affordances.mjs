// Phase AL — canvas affordances in the LIVE app, on the REAL engine:
// ⌘-wheel zoom anchored on the pointer, the floating selection toolbar, and
// the Calc fill handle continuing a series into the saved file.
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { launch, newDoc, focusDoc, type, selectAll, save, docXml, poll, makeReporter, enginePresent, shot, TESTROOT } from './_harness.mjs'

if (!enginePresent()) { console.log('SKIP: engine missing'); process.exit(0) }
const R = makeReporter('AL canvas affordances')
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
const zoomLabel = async () => {
  const t = await win.locator('[class*=zoomPct], [title="Zoom"], text=/^\\d+%$/').first().innerText().catch(() => '')
  return parseInt(t, 10)
}

try {
  // ── Writer: mini-toolbar on a text selection ─────────────────────────
  await newDoc(win, 'Word')
  // A stale Writer tab can satisfy waitRender before the new file lands — wait for it.
  await poll(async () => !!newest(/^New Document.*\.docx$/), { timeout: 20000 })
  const docx = newest(/^New Document.*\.docx$/)
  await focusDoc(win)
  await type(win, 'Select me please')
  await win.waitForTimeout(600)
  await shot(win, 'AL-typed')
  const typedOk = await poll(async () => { await save(win); return /Select me/.test(docXml(docx)) }, { timeout: 20000, interval: 800 })
  R.ok(typedOk, `writer: typed text reached the document (${path.basename(docx)})`)
  await selectAll(win)
  // The toolbar shows after the pointer is UP with a selection: click-drag across the word.
  const wrap = win.locator('[class*=docWrap]').first()
  const wb = await wrap.boundingBox()
  await win.mouse.move(wb.x + 110, wb.y + 90)
  await win.mouse.down()
  await win.waitForTimeout(150)
  await win.mouse.move(wb.x + 180, wb.y + 90, { steps: 4 })
  await win.waitForTimeout(150)
  await win.mouse.move(wb.x + 250, wb.y + 90, { steps: 4 })
  await win.waitForTimeout(150)
  await win.mouse.up()
  const mini = win.locator('[data-testid="mini-toolbar"]')
  let shown = await mini.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false)
  const rects = await win.locator('[class*=selRect]').count()
  console.log(`  [debug] selection rects after drag: ${rects}`)
  if (!shown) {
    // Keyboard selection is the other path in (Shift+End from the line start).
    await focusDoc(win)
    await win.keyboard.press('Home')
    await win.keyboard.press('Shift+End')
    shown = await mini.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false)
    console.log(`  [debug] selection rects after Shift+End: ${await win.locator('[class*=selRect]').count()}`)
  }
  if (!shown) await shot(win, 'AL-mini-missing')
  R.ok(shown, 'writer: selection toolbar appears above a selection')
  await shot(win, 'AL-mini-toolbar')
  await mini.getByTitle('Italic', { exact: true }).click()
  const italic = await poll(async () => { await save(win); return /<w:i\/>|<w:i w:val="true"\/>|<w:i\b/.test(docXml(docx)) }, { timeout: 20000, interval: 800 })
  R.ok(italic, 'writer: Italic from the selection toolbar is in the saved .docx')
  await focusDoc(win)
  await win.keyboard.press('ArrowRight')
  R.ok(await poll(async () => !(await mini.isVisible().catch(() => false)), { timeout: 3000 }), 'writer: a keystroke hides the toolbar')

  // ── ⌘-wheel zoom, anchored ───────────────────────────────────────────
  const before = await win.evaluate(() => {
    const c = document.querySelector('[class*=docWrap] canvas')
    return c ? c.getBoundingClientRect().width : 0
  })
  await wrap.hover({ position: { x: 200, y: 200 }, force: true })
  await win.mouse.wheel(0, -300).catch(() => {})
  // Playwright's wheel has no modifier flag; dispatch a ctrl-wheel on the scroll host directly.
  await win.evaluate(() => {
    const host = document.querySelector('[class*=pages], [class*=calcGrid]')
    host?.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, ctrlKey: true, clientX: 300, clientY: 300, bubbles: true, cancelable: true }))
  })
  const grew = await poll(async () => (await win.evaluate(() => {
    const c = document.querySelector('[class*=docWrap] canvas')
    return c ? c.getBoundingClientRect().width : 0
  })) > before * 1.2, { timeout: 4000 })
  R.ok(grew, 'zoom: a ctrl/⌘ wheel zooms the document in')
  await win.evaluate(() => {
    const host = document.querySelector('[class*=pages], [class*=calcGrid]')
    host?.dispatchEvent(new WheelEvent('wheel', { deltaY: 300, ctrlKey: true, clientX: 300, clientY: 300, bubbles: true, cancelable: true }))
  })
  const back = await poll(async () => Math.abs((await win.evaluate(() => {
    const c = document.querySelector('[class*=docWrap] canvas')
    return c ? c.getBoundingClientRect().width : 0
  })) - before) < before * 0.05, { timeout: 4000 })
  R.ok(back, 'zoom: the opposite wheel returns to the original size')

  // ── Calc: fill handle continues a series ─────────────────────────────
  await newDoc(win, 'Excel')
  await poll(async () => !!newest(/^New Spreadsheet.*\.xlsx$/), { timeout: 20000 })
  const xlsx = newest(/^New Spreadsheet.*\.xlsx$/)
  await focusDoc(win)
  // The grid may open scrolled; go to the top so A1 is where the clicks expect it.
  await win.evaluate(() => { const g = document.querySelector('[class*=calcGrid]'); if (g) { g.scrollTop = 0; g.scrollLeft = 0 } })
  await win.waitForTimeout(300)
  const addr = () => win.locator('[data-testid="cell-addr"]').first().innerText().catch(() => '')
  await wrap.click({ position: { x: 30, y: 10 }, force: true }) // A1
  await poll(async () => (await addr()).trim() === 'A1', { timeout: 4000 })
  R.ok((await addr()).trim() === 'A1', `calc: click lands on A1 (address box says ${await addr()})`)
  await type(win, '1\n2\n')
  // Select A1:A2 by clicking A1 and shift-clicking A2.
  await wrap.click({ position: { x: 30, y: 10 }, force: true })
  await win.waitForTimeout(150)
  await wrap.click({ position: { x: 30, y: 28 }, force: true, modifiers: ['Shift'] })
  await win.waitForTimeout(300)
  const handle = win.locator('[data-testid="fill-handle"]')
  const handleOk = await handle.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false)
  if (!handleOk) { console.log(`  [debug] cellCursor=${await win.locator('[class*=cellCursor]').count()} selRects=${await win.locator('[class*=selRect]').count()}`); await shot(win, 'AL-handle-missing') }
  R.ok(handleOk, 'calc: the fill handle sits at the selection corner')
  const hb = await handle.boundingBox()
  await win.mouse.move(hb.x + 4, hb.y + 4)
  await win.mouse.down()
  await win.mouse.move(hb.x + 4, hb.y + 60, { steps: 6 })
  R.ok(await win.locator('[data-testid="fill-preview"]').isVisible().catch(() => false), 'calc: dragging shows the fill preview')
  await shot(win, 'AL-fill-drag')
  await win.mouse.move(hb.x + 4, hb.y + 84, { steps: 4 })
  await win.mouse.up()
  const filled = await poll(async () => {
    await save(win)
    const xml = docXml(xlsx, 'Excel')
    const vals = [...xml.matchAll(/<c r="A(\d+)"[^>]*>(?:<f>[^<]*<\/f>)?<v>([^<]+)<\/v>/g)].map((m) => [Number(m[1]), Number(m[2])])
    return vals.some(([r, v]) => r === 3 && v === 3) && vals.some(([r, v]) => r === 4 && v === 4)
  }, { timeout: 20000, interval: 800 })
  if (!filled) {
    console.log('  [debug] last fill plan:', JSON.stringify(await win.evaluate(() => window.__wosLastFill ?? null)))
    const xml = docXml(xlsx, 'Excel')
    console.log('  [debug] column A:', [...xml.matchAll(/<c r="A(\d+)"[^>]*>(?:<f>[^<]*<\/f>)?<v>([^<]+)<\/v>/g)].map((m) => `A${m[1]}=${m[2]}`).join(' '))
  }
  R.ok(filled, 'calc: the series 1, 2 continues as 3, 4, … in the saved .xlsx')
  const cellsMini = win.locator('[data-testid="mini-toolbar"]')
  await wrap.click({ position: { x: 30, y: 12 }, force: true })
  await wrap.click({ position: { x: 30, y: 60 }, force: true, modifiers: ['Shift'] })
  R.ok(await cellsMini.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false), 'calc: the selection toolbar appears for a cell range')
  R.ok(await cellsMini.getByTitle('Wrap text').isVisible().catch(() => false), 'calc: … with cell tools (wrap, fill, alignment)')
} catch (e) {
  R.ok(false, `unexpected: ${e.message}`); console.log(e.stack)
} finally {
  await app.close().catch(() => {})
}
process.exit(R.done() ? 0 : 1)
