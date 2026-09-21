// PPTX align/distribute — PowerPoint parity semantics for WosArrange.
// (a) MULTI-select align top → tops meet the selection bbox top (the higher
//     shape's top), NOT the slide edge.
// (b) SINGLE-select align top → slide edge (old behavior kept).
// (c) three shapes with uneven gaps → disth → equal gaps, first/last fixed.
// Drives the production paths: menu:run-action → LokRenderer.runOfficeAction
// → useLokActions.arrange → WosArrange; verifies via WosCapture geometry
// (1/100 mm) plus canvas pixel probes.
import { launch, newDoc, makeReporter, enginePresent, poll, shot } from './_harness.mjs'

if (!enginePresent()) { console.log('SKIP: engine or host not present'); process.exit(0) }

const { app, win } = await launch()
const r = makeReporter('PPTX ALIGN')

// ---- helpers (same patterns as pptx-suite) ----------------------------------
/** Fire an office.* action through the native-menu channel (production path). */
const act = (id) => app.evaluate(({ BrowserWindow }, aid) => {
  BrowserWindow.getAllWindows()[0].webContents.send('menu:run-action', aid)
}, id)
/** Run a seeded macro directly (the same call useLokActions makes). */
const M = (name, args) => win.evaluate(([n, a]) => window.workspace.lok.macro(n, a), [name, args])
const selInfo = () => win.evaluate(() => window.workspace.lok.selInfo())
const capture = () => win.evaluate(() => window.workspace.lok.capture())
const sleep = (ms) => win.waitForTimeout(ms)
const deselect = async () => { await win.keyboard.press('Escape'); await sleep(250) }

/** Page coordinates of a slide-fraction point (fx,fy in 0..1 of slide area). */
const slidePoint = (fx, fy) => win.evaluate(([fx, fy]) => {
  const c = [...document.querySelectorAll('canvas')].reduce((a, b) => (b.width * b.height > (a?.width * a?.height || 0) ? b : a), null)
  const rect = c.getBoundingClientRect()
  return { x: rect.left + rect.width * fx, y: rect.top + rect.height * fy }
}, [fx, fy])
/** RGB long at a slide-fraction point. */
const colorAt = (fx, fy) => win.evaluate(([fx, fy]) => {
  const c = [...document.querySelectorAll('canvas')].reduce((a, b) => (b.width * b.height > (a?.width * a?.height || 0) ? b : a), null)
  const d = c.getContext('2d').getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data
  return (d[0] << 16) | (d[1] << 8) | d[2]
}, [fx, fy])

const RED = 16711680, BLUE = 255, GREEN = 65280
const near = (c, rgb, tol = 60) =>
  Math.abs(((c >> 16) & 255) - ((rgb >> 16) & 255)) < tol &&
  Math.abs(((c >> 8) & 255) - ((rgb >> 8) & 255)) < tol &&
  Math.abs((c & 255) - (rgb & 255)) < tol

/** Parse a WosCapture element line: kind|relX|relY|w|h|fill|… (1/100 mm). */
const parseEl = (line) => {
  const p = line.split('|')
  return { kind: p[0], x: Number(p[1]), y: Number(p[2]), w: Number(p[3]), h: Number(p[4]) }
}

/** Drag with real mouse events from one slide-fraction point to another. */
const drag = async (f1, f2) => {
  const a = await slidePoint(f1.x, f1.y)
  const b = await slidePoint(f2.x, f2.y)
  await win.mouse.move(a.x, a.y)
  await win.mouse.down()
  await win.mouse.move(b.x, b.y, { steps: 16 })
  await sleep(150)
  await win.mouse.up()
  await sleep(500)
}

// ---- setup: fresh deck + real slide size ------------------------------------
await newDoc(win, 'PowerPoint')
// setPart on the current part reports the slide size in TWIPS → 1/100 mm.
const dims = await win.evaluate(async () => {
  const p = await window.workspace.lok.parts()
  return window.workspace.lok.setPart(p.cur)
})
const SW = dims?.w ? Math.round(dims.w * 2540 / 1440) : 28000
const SH = dims?.h ? Math.round(dims.h * 2540 / 1440) : 15750
console.log(`  [align] slide ${SW}x${SH} (1/100 mm)`)
// WosShapeInsert places shapes at (5000,5000), 7000x4500 → center x fraction:
const CX = (5000 + 3500) / SW

// ============ (b) SINGLE shape: align top → slide edge (parity kept) =========
await act('office.shape:rect')
let si = await poll(selInfo)
r.ok(!!si, `B: rectangle inserted + selected (${si && si.name})`)
await act(`office.shapefill:${RED}`)
await sleep(300)
await act('office.arrange:top')
await sleep(400)
// Red must reach the very top row of the slide (y≈300 of 0..4500).
const bTop = await poll(async () => { const c = await colorAt(CX, 300 / SH); return near(c, RED) ? c : false })
r.ok(bTop !== false, `B: single align-top puts the shape at the SLIDE edge (probe=${bTop && bTop.toString(16)})`)
await act('office.arrange:delete')
await sleep(400)

// ============ (a) MULTI select: align top → selection bbox, not slide ========
// Rect (red) stays at insert position → top y=5000 (the higher shape).
await act('office.shape:rect')
await poll(selInfo)
await act(`office.shapefill:${RED}`)
await sleep(300)
await deselect()
// Ellipse (blue) parked at the slide bottom via SINGLE align → top y=SH-4500.
await act('office.shape:ellipse')
await poll(selInfo)
await act(`office.shapefill:${BLUE}`)
await act('office.arrange:bottom')
await sleep(400)
// Shift-click both (ellipse first, then add the rect) — the SEL-05 gesture.
const eC = await slidePoint(8500 / SW, (SH - 2250) / SH)
const rC = await slidePoint(8500 / SW, 7250 / SH)
await win.mouse.click(eC.x, eC.y)
await poll(selInfo)
await win.keyboard.down('Shift')
await win.mouse.click(rC.x, rC.y)
await win.keyboard.up('Shift')
const multi = await poll(async () => { const c = await capture(); return (c?.elements?.length ?? 0) >= 2 ? c : false })
r.ok(multi !== false, `A: shift-click multi-selects both shapes (${multi && multi.elements.length} captured, bbox h=${multi && multi.h})`)
r.ok(multi && multi.h > 9000, `A: pre-align bbox spans both shapes (h=${multi && multi.h})`)
await act('office.arrange:top')
await sleep(500)
const aligned = await poll(async () => {
  const c = await capture()
  if (!c || (c.elements?.length ?? 0) < 2) return false
  const els = c.elements.map(parseEl)
  // equal tops ⇔ every relY = 0 and the bbox collapses to one shape height
  return els.every((e) => Math.abs(e.y) <= 10) && Math.abs(c.h - 4500) <= 10 ? c : false
})
r.ok(aligned !== false, `A: multi align-top → both tops EQUAL (relY=0,0; bbox h=${aligned && aligned.h})`)
// Bracket the shared top at y≈5000 (the higher shape's top), NOT the slide edge:
// pixels just below 5000 are shape-colored, pixels above 5000 are not.
const inside = await poll(async () => { const c = await colorAt(8500 / SW, 5900 / SH); return near(c, RED) || near(c, BLUE) ? c : false })
r.ok(inside !== false, `A: shape pixels just below the higher shape's top (probe=${inside && inside.toString(16)})`)
const outside = await colorAt(8500 / SW, 3800 / SH)
const topRow = await colorAt(8500 / SW, 300 / SH)
r.ok(!near(outside, RED) && !near(outside, BLUE) && !near(topRow, RED) && !near(topRow, BLUE),
  `A: NO shape pixels above it / at the slide edge → aligned to selection, not slide (${outside.toString(16)}, ${topRow.toString(16)})`)
await deselect()

// ============ (c) DISTRIBUTE horizontally: uneven → equal gaps ===============
// Fresh slide so earlier shapes don't disturb probes or the selection.
await act('office.slide:.uno:InsertPage')
await sleep(700)
// Shape 1 (red, 3000x3000) pinned to the left edge via SINGLE align → x=0.
await act('office.shape:rect')
await poll(selInfo)
await M('WosShapeSize', '3000|3000')
await act(`office.shapefill:${RED}`)
await act('office.arrange:left')
await sleep(400)
// Shape 2 (green) dragged to ~x-center 9000; shape 3 (blue) to ~13500. All
// targets stay under ~0.5 of the slide width — the window CLIPS the slide's
// right side, and clicks beyond it land outside the canvas (silent no-ops).
// Exact landing doesn't matter — geometry is read back from WosCapture; it
// only needs to keep the order 1<2<3 with clearly UNEVEN gaps.
const CY = 6500 / SH // all three sit at y 5000..8000 after the resize
await act('office.shape:rect')
await poll(selInfo)
await M('WosShapeSize', '3000|3000')
await act(`office.shapefill:${GREEN}`)
await sleep(300)
await win.mouse.click((await slidePoint(6500 / SW, CY)).x, (await slidePoint(6500 / SW, CY)).y)
await poll(selInfo)
await drag({ x: 6500 / SW, y: CY }, { x: 9000 / SW, y: CY })
await deselect()
await act('office.shape:rect')
await poll(selInfo)
await M('WosShapeSize', '3000|3000')
await act(`office.shapefill:${BLUE}`)
await sleep(300)
await win.mouse.click((await slidePoint(6500 / SW, CY)).x, (await slidePoint(6500 / SW, CY)).y)
await poll(selInfo)
await drag({ x: 6500 / SW, y: CY }, { x: 13500 / SW, y: CY })
await deselect()
// Select all three: click red, shift-click green + blue.
const p1 = await slidePoint(1500 / SW, CY)
await win.mouse.click(p1.x, p1.y)
await poll(selInfo)
await win.keyboard.down('Shift')
await win.mouse.click((await slidePoint(9000 / SW, CY)).x, (await slidePoint(9000 / SW, CY)).y)
await win.mouse.click((await slidePoint(13500 / SW, CY)).x, (await slidePoint(13500 / SW, CY)).y)
await win.keyboard.up('Shift')
const cap0 = await poll(async () => { const c = await capture(); return (c?.elements?.length ?? 0) >= 3 ? c : false })
r.ok(cap0 !== false, `C: three shapes multi-selected (${cap0 && cap0.elements.length} captured)`)
const gapsOf = (c) => {
  const e = c.elements.map(parseEl).sort((a, b) => a.x - b.x)
  return { e, g: [e[1].x - (e[0].x + e[0].w), e[2].x - (e[1].x + e[1].w)] }
}
const before = cap0 ? gapsOf(cap0) : { g: [0, 0] }
r.ok(Math.abs(before.g[0] - before.g[1]) > 500, `C: gaps uneven before distribute (${before.g.join(', ')})`)
await act('office.arrange:disth')
await sleep(500)
const after = await poll(async () => {
  const c = await capture()
  if (!c || (c.elements?.length ?? 0) < 3) return false
  const { e, g } = gapsOf(c)
  return Math.abs(g[0] - g[1]) <= 20 ? { c, e, g } : false
})
r.ok(after !== false, `C: disth → EQUAL gaps (${after && after.g.join(', ')})`)
r.ok(after && cap0 && Math.abs(after.c.w - cap0.w) <= 10,
  `C: first/last shapes stay fixed (bbox w ${cap0 && cap0.w} → ${after && after.c.w})`)
// Pixel probe: shape 1 sits at absolute x=0 (aligned left), so capture-relative
// x IS absolute — green must render at the middle shape's new center.
if (after) {
  const gx = (after.e[1].x + after.e[1].w / 2) / SW
  const gCol = await poll(async () => { const c = await colorAt(gx, CY); return near(c, GREEN) ? c : false })
  r.ok(gCol !== false, `C: green pixels at the distributed center x=${Math.round(after.e[1].x + after.e[1].w / 2)} (probe=${gCol && gCol.toString(16)})`)
}
await deselect()

await shot(win, 'pptx-align-final')
const ok = r.done()
await app.close()
process.exit(ok ? 0 : 1)
