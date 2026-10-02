// Human-journey e2e — drives the app the way a person does and asserts at every
// step. Unlike the snapshot tests, this opens several documents, switches
// between them, edits, and resizes, to surface stability bugs (stuck renders,
// lost cursor, dead resize) that only appear under real multi-doc usage.
//
// Runs against the dev build via the shared harness. Continues past failures so
// one run maps every broken step. Exit non-zero if any step fails.
import * as H from './_harness.mjs'
import fs from 'fs'
import { execSync } from 'child_process'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const TESTROOT = '/tmp/wos-test'
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}
// Runs a step body with its own timeout so a single hang (a real bug!) is
// recorded as a failure and the journey continues mapping the rest.
async function step(name, fn, ms = 30000) {
  let timer
  try {
    const r = await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`step timed out after ${ms}ms`)), ms) }),
    ])
    clearTimeout(timer)
    check(name, r?.ok ?? !!r, r?.detail ?? '')
  } catch (e) {
    clearTimeout(timer)
    check(name, false, e.message)
  }
}

// Fresh, deterministic copies so re-runs are clean.
function seed(src, dst) { fs.copyFileSync(`${TESTROOT}/${src}`, `${TESTROOT}/${dst}`); return dst }

const guard = setTimeout(() => { console.log('JOURNEY HUNG'); process.exit(2) }, 280000)

const xlsx = seed('test-sheet.xlsx', 'journey-sheet.xlsx')
const pptx = fs.existsSync(`${TESTROOT}/test-deck.pptx`) ? seed('test-deck.pptx', 'journey-deck.pptx') : null
const docx = fs.existsSync(`${TESTROOT}/test-document.docx`) ? seed('test-document.docx', 'journey-doc.docx') : null

const { app, win } = await H.launch()
win.on('pageerror', (e) => console.log('  [pageerror]', e.message.split('\n')[0]))

// helper: is the active doc actually painted (not stuck on "Rendering…")?
const isPainted = () => win.evaluate(() =>
  [...document.querySelectorAll('canvas')].some((c) => c.width > 400 && c.height > 400) &&
  !document.body.innerText.includes('Rendering…'))

// Robust open: click the file in the tree, poll until painted. Never throws.
async function openFile(name) {
  await win.getByText(name).first().click()
  return H.poll(isPainted, { timeout: 14000 })
}

// ---- 1. open spreadsheet ----
await step('1. xlsx renders with headers', async () => {
  const r = await openFile(xlsx)
  await win.waitForTimeout(600)
  return r && (await win.evaluate(() => !!document.querySelector('[class*="calcGrid"]')))
})

// ---- 2. click a cell → cursor/selection should appear ----
await step('2. clicking a cell shows a cursor/selection', async () => {
  // Click the DOCUMENT canvas (inside docWrap), not the small header canvases.
  await win.locator('[class*="docWrap"] canvas').first().click({ position: { x: 90, y: 60 }, force: true })
  const got = await H.poll(() => win.evaluate(() =>
    document.querySelectorAll('[class*="cellCursor"]').length +
    document.querySelectorAll('[class*="selRect"]').length +
    document.querySelectorAll('[class*="caret"]').length), { timeout: 5000 })
  return { ok: got > 0, detail: `cursor elements=${got}` }
})

// ---- 3. type into the cell → persists to disk ----
await step('3. typed text persists to the .xlsx', async () => {
  await H.focusDoc(win)
  await win.keyboard.type('Hello42', { delay: 40 })
  await win.keyboard.press('Enter')
  return H.poll(async () => {
    await H.save(win)
    try { return execSync(`unzip -p '${TESTROOT}/${xlsx}' xl/sharedStrings.xml`, { encoding: 'utf8' }).includes('Hello42') } catch { return false }
  })
})

// ---- 4. drag a column border to resize ----
await step('4. drag-resize changes a column width', async () => {
  const before = await win.evaluate(() => window.workspace.lok.sheetGeometry())
  const box = await win.evaluate(() => { const c = document.querySelector('[class*="colHeader"]'); const r = c?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, h: r.height } : null })
  if (!box) return { ok: false, detail: 'no colHeader element' }
  let bx = null
  for (let gx = 95; gx < 240; gx += 3) {
    await win.mouse.move(box.x + gx, box.y + box.h / 2)
    const cur = await win.evaluate(() => { const c = document.querySelector('[class*="colHeader"]'); return c ? getComputedStyle(c).cursor : '' })
    if (cur === 'col-resize') { bx = gx; break }
  }
  if (bx == null) return { ok: false, detail: 'never found a col-resize boundary' }
  await win.mouse.move(box.x + bx, box.y + box.h / 2)
  await win.mouse.down()
  await win.mouse.move(box.x + bx + 80, box.y + box.h / 2, { steps: 8 })
  await win.mouse.up()
  await win.waitForTimeout(1500)
  const after = await win.evaluate(() => window.workspace.lok.sheetGeometry())
  const changed = JSON.stringify(after?.columns?.sizes) !== JSON.stringify(before?.columns?.sizes)
  return { ok: changed, detail: `before=${before?.columns?.sizes?.slice(0, 16)} after=${after?.columns?.sizes?.slice(0, 16)}` }
}, 40000)

// ---- 5/6. open 2nd + 3rd documents ----
if (pptx) await step('5. opening a 2nd doc (pptx) renders', () => openFile(pptx))
if (docx) await step('6. opening a 3rd doc (docx) renders', () => openFile(docx))

// ---- 7. switch BACK to the spreadsheet — must still render ----
await step('7. switching back to the 1st doc still renders', () => openFile(xlsx))

// ---- 8. returned spreadsheet keeps its Calc layout ----
await step('8. returned spreadsheet keeps its Calc layout',
  () => win.evaluate(() => !!document.querySelector('[class*="calcGrid"]')))

// ---- 9. round-trip a few more switches for stability ----
await step('9. rapid tab switching stays stable', async () => {
  let ok = true
  for (let i = 0; i < 3 && (pptx || docx); i++) {
    if (!(await openFile(pptx || docx))) ok = false
    if (!(await openFile(xlsx))) ok = false
  }
  return ok
}, 90000)

await app.close().catch(() => {})
clearTimeout(guard)
const failed = results.filter((r) => !r.ok)
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`)
process.exit(failed.length ? 1 : 0)
