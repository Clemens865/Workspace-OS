// Phase AG — Calc viewport tiling, against the REAL engine.
//
// Proves the fix for the long-standing slowness: paint() must tile only the
// visible scroll WINDOW, not the whole used range. A big sheet used to fetch
// hundreds of tiles (document-sized canvas) on open and again on every sheet
// switch. Here we author a wide/tall fixture, instrument window.workspace.lok
// tile calls, and assert: first paint is BOUNDED, a click deep in the sheet
// maps to the right cell, scrolling fetches fresh tiles, and switching sheets
// stays bounded (no whole-doc re-render).
import * as H from './_harness.mjs'
import fs from 'fs'
import ExcelJS from 'exceljs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const r = H.makeReporter('PHASE AG — Calc viewport tiling')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const FILE = '/tmp/wos-test/AG-calc-viewport.xlsx'
try { fs.mkdirSync('/tmp/wos-test', { recursive: true }) } catch { /* exists */ }
for (const f of fs.readdirSync('/tmp/wos-test')) if (f.startsWith('.~lock') || f.startsWith('AG-calc')) fs.rmSync('/tmp/wos-test/' + f, { force: true })

// A genuinely large used range: 40 cols × 2000 rows on Sheet1, plus a second
// sheet, so the switch path is exercised. Corner cells are marked so we can
// assert what rendered.
{
  const wb = new ExcelJS.Workbook()
  const s1 = wb.addWorksheet('Big')
  for (let row = 1; row <= 2000; row++) {
    for (let col = 1; col <= 40; col++) s1.getCell(row, col).value = row === 1 ? `H${col}` : row * 100 + col
  }
  s1.getCell('A1').value = 'TOPLEFT'
  const s2 = wb.addWorksheet('Second')
  s2.getCell('A1').value = 'SHEET2'
  await wb.xlsx.writeFile(FILE)
}

const { app, win } = await H.launch()
await H.openDoc(win, 'AG-calc-viewport.xlsx', 'Excel')
r.ok(await win.getByRole('button', { name: 'Data', exact: true }).first().isVisible().catch(() => false), 'Calc ribbon shows Data tab')

// The direct, observable proof of windowing: the Calc canvas BACKING STORE. A
// whole-doc paint of 40 cols × 2000 rows is tens of thousands of device px
// tall; a viewport window is a couple thousand. (contextBridge freezes
// window.workspace.lok, so we can't count tiles — the canvas size is the
// unfalsifiable evidence and is what actually drives cost anyway.)
const canvasBox = () => win.evaluate(() => {
  const c = document.querySelector('canvas[class*="pageWindowed"]')
  if (!c) return null
  const cs = getComputedStyle(c)
  return { w: c.width, h: c.height, top: c.style.top, left: c.style.left, position: cs.position }
})
const docBox = () => win.evaluate(() => {
  const d = document.querySelector('[class*="docWrap"]')
  return d ? { w: d.clientWidth, h: d.clientHeight } : null
})

// 1) FIRST PAINT IS WINDOWED. The doc-sized spacer is huge; the canvas is not.
const box0 = await H.poll(async () => { const b = await canvasBox(); return b && b.h > 0 ? b : false }, { timeout: 20000 })
const doc0 = await docBox()
r.ok(box0, `Calc canvas is present and painted (${box0 && box0.h}px tall)`)
r.ok(box0 && box0.position === 'absolute', 'Calc canvas is absolutely positioned (windowed)')
r.ok(box0 && doc0 && box0.h < 6000, `canvas backing is viewport-bounded, not whole-doc (${box0 && box0.h}px < 6000)`)
r.ok(doc0 && doc0.h > 10000, `doc-sized scroll spacer IS the full sheet (${doc0 && doc0.h}px > 10000)`)

// 2) A CLICK/NAV DEEP IN THE SHEET maps to the right cell (coordinate
//    correctness — the class of bug that killed the reverted attempt).
await win.evaluate(() => window.workspace.lok.uno(`.uno:GoToCell {"ToPoint":{"type":"string","value":"$Big.B1500"}}`))
const atFar = await H.poll(async () => {
  const a = await win.evaluate(() => document.querySelector('[data-testid="cell-addr"]')?.textContent || '')
  return /B1500/i.test(a) ? a : false
}, { timeout: 6000 })
r.ok(atFar, `active cell tracks a far navigation (got ${atFar || 'none'})`)

// 3) SCROLLING RE-WINDOWS: the canvas moves to a new origin (top changes) and
//    stays viewport-bounded.
const beforeTop = box0 && box0.top
await win.evaluate(() => { const g = document.querySelector('[class*="calcGrid"]'); if (g) g.scrollTop = 40000 })
const movedBox = await H.poll(async () => { const b = await canvasBox(); return b && b.top !== beforeTop ? b : false }, { timeout: 6000 })
r.ok(movedBox, `scroll re-windowed the canvas (top ${beforeTop} → ${movedBox && movedBox.top})`)
r.ok(movedBox && movedBox.h < 6000, `scroll window stays viewport-bounded (${movedBox && movedBox.h}px < 6000)`)

// 4) SHEET SWITCH renders the other sheet and stays windowed.
await win.evaluate(() => window.workspace.lok.setPart(1))
const box2 = await H.poll(async () => { const b = await canvasBox(); return b && b.h > 0 ? b : false }, { timeout: 8000 })
r.ok(box2 && box2.h < 6000, `sheet switch stays viewport-bounded (${box2 && box2.h}px < 6000)`)

// 5) EDGE AUTO-SCROLL during a drag-select carries the selection past the fold.
//    Back to the big sheet, top; press in a cell, drag to the bottom edge of the
//    grid, hold — the view must auto-scroll (scrollTop grows) and keep rendering.
await win.evaluate(() => { window.workspace.lok.setPart(0); const g = document.querySelector('[class*="calcGrid"]'); if (g) g.scrollTop = 0 })
await H.poll(async () => (await canvasBox())?.top === '0px', { timeout: 6000 })
const scrollTopNow = () => win.evaluate(() => document.querySelector('[class*="calcGrid"]').scrollTop)
const before = await scrollTopNow()
// Dispatch the drag with EXACT coordinates on docWrap. Playwright's mouse
// clamps Y to its cached viewport (which lags the real window), so it can't
// reach the grid's edge zone; synthetic events with a chosen clientY exercise
// the real onMouseDown/onMouseMove + the auto-scroll loop without that clamp.
await win.evaluate(() => {
  const host = document.querySelector('[class*="docWrap"]')
  const grid = document.querySelector('[class*="calcGrid"]')
  const gr = grid.getBoundingClientRect()
  const fire = (type, x, y) => host.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, buttons: 1, button: 0 }))
  fire('mousedown', gr.left + 140, gr.top + 90)
  // Into the bottom edge zone (<32px of the visible bottom) → auto-scroll starts.
  const edgeBottom = Math.min(gr.bottom, window.innerHeight)
  fire('mousemove', gr.left + 140, edgeBottom - 6)
})
// Hold at the edge — the auto-scroll loop runs on its own timer. Wait until it
// has carried well past the prefetch margin so the canvas genuinely re-windows.
const scrolled = await H.poll(async () => (await scrollTopNow()) > before + 2000, { timeout: 8000 })
r.ok(scrolled, `drag to the bottom edge auto-scrolls the sheet (scrollTop ${before} → ${await scrollTopNow()})`)
// The selection extended across rows (the engine emitted selection rects).
const selRows = await win.evaluate(() => document.querySelectorAll('[class*="selRect"]').length)
r.ok(selRows > 0, `a multi-row selection exists after the auto-scroll drag (${selRows} selection rect(s))`)
// And the newly-exposed region is rendered, not blank (canvas re-windowed down).
const afterTop = await canvasBox()
r.ok(afterTop && afterTop.top !== '0px', `canvas re-windowed to the scrolled region (top now ${afterTop && afterTop.top})`)

// 6) NO STUCK: move the pointer OUT of the edge zone (loop must idle, not die),
//    then BACK to the edge — auto-scroll must resume without a re-press. This is
//    the "gets stuck" regression the always-on loop fixes.
const moveTo = (yFrac) => win.evaluate((f) => {
  const host = document.querySelector('[class*="docWrap"]')
  const gr = document.querySelector('[class*="calcGrid"]').getBoundingClientRect()
  const eb = Math.min(gr.bottom, window.innerHeight)
  const y = f === 'edge' ? eb - 6 : gr.top + (eb - gr.top) * 0.4 // 'edge' or mid-viewport
  host.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: gr.left + 140, clientY: y, buttons: 1 }))
}, yFrac)
await moveTo('mid')                 // leave the edge zone → idle
const idleAt = await scrollTopNow()
await win.waitForTimeout(500)
const stillIdle = await scrollTopNow()
r.ok(Math.abs(stillIdle - idleAt) < 60, `pointer off the edge idles the scroll (${idleAt} → ${stillIdle})`)
await moveTo('edge')                // re-enter the edge zone → resume
const resumed = await H.poll(async () => (await scrollTopNow()) > stillIdle + 600, { timeout: 6000 })
r.ok(resumed, `auto-scroll RESUMES after leaving and re-entering the edge (no stuck) — ${stillIdle} → ${await scrollTopNow()}`)

await win.evaluate(() => document.querySelector('[class*="docWrap"]').dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))

// 7) EDIT-THROUGH-CACHE: with tiles cached, an edit must still visibly land —
//    the engine's invalidation evicts the touched tiles and the settle paints
//    fresh ones. (The cache's one dangerous failure mode is stale pixels.)
await win.evaluate(() => { const g = document.querySelector('[class*="calcGrid"]'); if (g) g.scrollTop = 0 })
await H.poll(async () => (await canvasBox())?.top === '0px', { timeout: 6000 })
await win.evaluate(() => window.workspace.lok.uno(`.uno:GoToCell {"ToPoint":{"type":"string","value":"$Big.C3"}}`))
await win.waitForTimeout(300)
await H.focusDoc(win)
const sigBefore = await H.canvasSig(win)
await H.type(win, '424242\n')
const sigChanged = await H.poll(async () => (await H.canvasSig(win)) !== sigBefore, { timeout: 6000 })
r.ok(sigChanged, 'a cell edit repaints through the cache (pixels changed, no staleness)')

await H.shot(win, 'AG-calc-viewport')
await app.close()
process.exit(r.done() ? 0 : 1)
