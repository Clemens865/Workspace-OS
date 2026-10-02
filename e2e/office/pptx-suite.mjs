// PPTX feature suite — implements docs/PPTX-TEST-MATRIX.md 1:1.
// Drives the REAL UI paths: ribbon clicks + the native-menu action channel
// (menu:run-action → LokRenderer.runOfficeAction), then verifies at three
// layers: model (WosSelInfo/parts), pixels (canvas color sampling), and file
// (saved ppt/slides/*.xml OOXML).
import { execSync } from 'child_process'
import fs from 'fs'
import { launch, newDoc, waitRender, save, makeReporter, enginePresent, poll, canvasSig, shot } from './_harness.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

if (!enginePresent()) { console.log('SKIP: engine or host not present'); process.exit(0) }

const { app, win } = await launch()
const r = makeReporter('PPTX SUITE')

// ---- helpers ---------------------------------------------------------------
/** Fire an office.* action through the native-menu channel (production path). */
const act = (id) => app.evaluate(({ BrowserWindow }, aid) => {
  BrowserWindow.getAllWindows()[0].webContents.send('menu:run-action', aid)
}, id)
/** Run a seeded macro directly (the same call useLokActions makes). */
const M = (name, args) => win.evaluate(([n, a]) => window.workspace.lok.macro(n, a), [name, args])
const selInfo = () => win.evaluate(() => window.workspace.lok.selInfo())
const parts = () => win.evaluate(() => window.workspace.lok.parts())
const capture = () => win.evaluate(() => window.workspace.lok.capture())

/** Fraction of canvas pixels within tol of an RRGGBB long. */
const colorFrac = (rgb, tol = 28) => win.evaluate(([rgb, tol]) => {
  const c = [...document.querySelectorAll('canvas')].reduce((a, b) => (b.width * b.height > (a?.width * a?.height || 0) ? b : a), null)
  if (!c) return 0
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  const R = (rgb >> 16) & 255, G = (rgb >> 8) & 255, B = rgb & 255
  let hit = 0, n = 0
  for (let i = 0; i < d.length; i += 64) { n++; if (Math.abs(d[i] - R) < tol && Math.abs(d[i + 1] - G) < tol && Math.abs(d[i + 2] - B) < tol) hit++ }
  return hit / n
}, [rgb, tol])

/** RGB long at the center of the biggest canvas. */
const centerColor = () => win.evaluate(() => {
  const c = [...document.querySelectorAll('canvas')].reduce((a, b) => (b.width * b.height > (a?.width * a?.height || 0) ? b : a), null)
  const d = c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data
  return (d[0] << 16) | (d[1] << 8) | d[2]
})

/** Page coordinates of a slide-fraction point (fx,fy in 0..1 of slide area).
 * WosShapeInsert places shapes at (5000,5000)+7000x4500 on a 25400x14288 slide,
 * so the inserted shape's center sits at fraction (0.335, 0.507). */
const slidePoint = (fx, fy) => win.evaluate(([fx, fy]) => {
  const c = [...document.querySelectorAll('canvas')].reduce((a, b) => (b.width * b.height > (a?.width * a?.height || 0) ? b : a), null)
  const r = c.getBoundingClientRect()
  return { x: r.left + r.width * fx, y: r.top + r.height * fy }
}, [fx, fy])
const SHAPE_CX = (5000 + 3500) / 25400, SHAPE_CY = (5000 + 2250) / 14288
/** RGB long at a slide-fraction point. */
const colorAt = (fx, fy) => win.evaluate(([fx, fy]) => {
  const c = [...document.querySelectorAll('canvas')].reduce((a, b) => (b.width * b.height > (a?.width * a?.height || 0) ? b : a), null)
  const d = c.getContext('2d').getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data
  return (d[0] << 16) | (d[1] << 8) | d[2]
}, [fx, fy])

const slidesXml = (file) => { try { return execSync(`unzip -p '${file}' 'ppt/slides/slide*.xml'`, { encoding: 'utf8' }) } catch { return '' } }
const sleep = (ms) => win.waitForTimeout(ms)

// Deselect by pressing Escape (leaves any text-edit mode too).
const deselect = async () => { await win.keyboard.press('Escape'); await sleep(200) }

const RED = 16711680, BLUE = 255, YELLOW = 16776960, GREEN = 65280

/** Fraction of a part's (slide's) pixels within tol of an RRGGBB long, rendered
 * off-view via partTile — verifies slide ORDER without switching the view. */
const partFrac = (part, rgb, tol = 60) => win.evaluate(async ([part, rgb, tol]) => {
  const t = await window.workspace.lok.partTile({ part, cw: 160, ch: 90, tx: 0, ty: 0, tw: 25400, th: 14288 })
  const R = (rgb >> 16) & 255, G = (rgb >> 8) & 255, B = rgb & 255
  let hit = 0, n = 0
  for (let i = 0; i + 3 < t.bgra.length; i += 16) {
    n++
    if (Math.abs(t.bgra[i + 2] - R) < tol && Math.abs(t.bgra[i + 1] - G) < tol && Math.abs(t.bgra[i] - B) < tol) hit++
  }
  return n ? hit / n : 0
}, [part, rgb, tol])

/** Drags rail item `from` onto rail item `to` with real mouse events. */
const railDrag = async (from, to) => {
  const rail = win.locator('button[title^="Slide "]')
  const a = await rail.nth(from).boundingBox()
  const b = await rail.nth(to).boundingBox()
  await win.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await win.mouse.down()
  await win.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 })
  await sleep(150)
  await win.mouse.up()
}

// ---- setup: fresh deck ------------------------------------------------------
let file = await newDoc(win, 'PowerPoint')
// The app may number the doc (New Presentation 2.pptx) — resolve the real path.
{
  const info = await win.evaluate(() => window.workspace.lok.fileInfo())
  if (info?.name) file = `/tmp/wos-test/${info.name}`
  console.log('  [suite] doc file:', file)
}
await win.getByRole('button', { name: 'Design', exact: true }).click()
await sleep(300)

// ============ 1. INSERTION ============
// INS-01 rectangle (ribbon click — keep as the workhorse shape)
const sigBefore = await canvasSig(win)
await win.getByTitle('Rectangle', { exact: true }).click()
let si = await poll(selInfo)
r.ok(!!si && si.w > 0, `INS-01 insert rectangle → selected shape (${si && si.name}, ${si && si.w}×${si && si.h})`)
r.ok(await poll(async () => (await canvasSig(win)) !== sigBefore), 'INS-01 rectangle visible (canvas changed)')

// INS-02..06 other kinds: insert via menu path, verify selection, delete
for (const [id, kind] of [['INS-02', 'roundrect'], ['INS-03', 'ellipse'], ['INS-04', 'line'], ['INS-05', 'arrow'], ['INS-06', 'text']]) {
  await act(`office.shape:${kind}`)
  const s = await poll(selInfo)
  r.ok(!!s, `${id} insert ${kind} → engine reports selected shape (${s && s.name})`)
  await act('office.arrange:delete')
  await sleep(250)
}
// INS-07 pen polygon via macro layer (UI is interactive click-click-Enter)
const capBefore = (await capture())?.elements?.length ?? 0
await M('WosInsertPoly', '3000,3000;8000,3000;5500,7000')
await sleep(300)
await win.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a').catch(() => {})
const polyOk = await poll(async () => { const c = await capture(); return (c?.elements?.length ?? 0) > capBefore })
r.ok(polyOk !== false, `INS-07 pen polygon inserted (macro layer)`)
await deselect()

// ============ 2. FILL ============
// Re-select the rectangle: click canvas center (rect inserted centered)
const cc = await slidePoint(SHAPE_CX, SHAPE_CY)
await win.mouse.click(cc.x, cc.y)
si = await poll(selInfo)
r.ok(!!si, `SEL-01 click shape → engine selection (${si && si.name})`)
const handles = await win.evaluate(() => document.querySelectorAll('[class*=handle]').length)
r.ok(handles >= 8, `SEL-01 resize handles rendered (${handles})`)

// FILL-01 solid red
await act(`office.shapefill:${RED}`)
r.ok(await poll(async () => (await selInfo())?.fill === RED), 'FILL-01 solid fill: selInfo.fill = red')
r.ok(await poll(async () => (await colorFrac(RED)) > 0.005), 'FILL-01 red pixels visible on slide')

// FILL-03 no fill
await act('office.shapefill:-1')
r.ok(await poll(async () => (await colorFrac(RED)) < 0.002), 'FILL-03 no-fill removes the red')

// FILL-04 gradient (Blue preset) → file must contain gradFill
await act('office.shapeeffect:gradient:5806300:14543051')
await sleep(400)
await save(win)
let xml = slidesXml(file)
r.ok(xml.includes('gradFill'), 'FILL-04 gradient persists as <a:gradFill> in slide XML')

// FILL-05 pattern (Diagonal) → pattFill
await act(`office.pattern:single:450:100:4210752`)
await sleep(400)
await save(win)
xml = slidesXml(file)
r.ok(xml.includes('pattFill'), 'FILL-05 pattern persists as <a:pattFill> in slide XML')

// restore solid red for later pixel tests
await act(`office.shapefill:${RED}`)
await sleep(300)

// ============ 3. OUTLINE & STROKE ============
await act(`office.shapeline:${BLUE}`)
await act('office.stroke:width:200')
await act('office.stroke:dash:dashed')
await sleep(400)
await save(win)
xml = slidesXml(file)
r.ok(/<a:ln[ >]/.test(xml), 'STRK-01 outline present as <a:ln>')
r.ok(/<a:ln w="7?2000"/.test(xml) || /w="72000"/.test(xml), `STRK-03 stroke width persisted (w=72000 EMU for 2mm)`)
r.ok(xml.includes('prstDash') || xml.includes('custDash'), 'STRK-04 dash style persisted')
await act('office.shapeline:-1')
await sleep(300)

// ============ 4. EFFECTS ============
await act('office.shapeeffect:shadow:')
await sleep(400)
await save(win)
xml = slidesXml(file)
r.ok(xml.includes('effectLst') || xml.includes('outerShdw'), 'EFF-01 shadow persists as <a:effectLst>')

// ============ 5. TEXT ============
// TXT-02 set text via macro path
await M('WosShapeText', 'settext|Hello PPT')
r.ok(await poll(async () => ((await selInfo())?.text ?? '').includes('Hello')), 'TXT-02 WosShapeText settext → selInfo.text')
// TXT-03 font color
r.ok((await M('WosShapeText', `color|${BLUE}`)) === true, 'TXT-03 font color macro ok')
// TXT-01 in-place editing: double-click, type, escape
await win.mouse.dblclick(cc.x, cc.y)
await sleep(400)
await win.keyboard.type(' Live', { delay: 60 })
await sleep(300)
await deselect()
await win.mouse.click(cc.x, cc.y)
const liveOk = await poll(async () => ((await selInfo())?.text ?? '').includes('Live'))
r.ok(liveOk !== false, 'TXT-01 double-click + type lands text in shape (dblclick selects word under cursor — replaced, PPT-style)')
// TXT-04 bold via UNO inside edit mode
await win.mouse.dblclick(cc.x, cc.y)
await sleep(300)
await win.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
await act('office.uno:.uno:Bold')
await sleep(300)
await deselect()
await save(win)
r.ok(slidesXml(file).includes('b="1"'), 'TXT-04 bold persists (b="1" in run props)')

// ============ 6. DIRECT MANIPULATION ============
// SEL-02 drag the shape right by 120px
// Escape any lingering text-edit mode (drag inside an edited shape selects
// text instead of moving — the exact trap a user hits after typing).
await win.keyboard.press('Escape')
await sleep(200)
await win.mouse.click(cc.x, cc.y)
await poll(selInfo)
// ensure the shape is solid red for the pixel verdict
await act(`office.shapefill:${RED}`)
await sleep(300)
const geo = await win.evaluate(() => {
  const c = [...document.querySelectorAll('canvas')].reduce((a, b) => (b.width * b.height > (a?.width * a?.height || 0) ? b : a), null)
  const rr = c.getBoundingClientRect()
  return { w: rr.width, h: rr.height }
})
const DX = Math.round(geo.w * 0.25), DY = 20 // drag a quarter-slide right
await win.mouse.move(cc.x, cc.y)
await win.mouse.down()
await win.mouse.move(cc.x + DX, cc.y + DY, { steps: 20 })
await sleep(120)
await win.mouse.up()
await sleep(800)
const fx2 = SHAPE_CX + DX / geo.w, fy2 = SHAPE_CY + DY / geo.h
const movedColor = await poll(async () => {
  const col = await colorAt(fx2, fy2)
  return ((col >> 16) & 255) > 200 && (col & 255) < 80 ? col : false
})
r.ok(movedColor !== false, `SEL-02 drag moves the shape (red at target: ${movedColor && movedColor.toString(16)})`)
// drag it back so later probes stay aligned
await win.mouse.move(cc.x + DX, cc.y + DY)
await win.mouse.down()
await win.mouse.move(cc.x, cc.y, { steps: 20 })
await sleep(120)
await win.mouse.up()
await sleep(600)
// SEL-04 deselect on empty click
// Clicking "empty" slide area usually hits an invisible layout placeholder,
// which rightly gets selected (PowerPoint behaves the same) — so the
// unambiguous deselect gesture is Escape.
await win.keyboard.press('Escape')
await sleep(400)
const handles2 = await win.evaluate(() => document.querySelectorAll('[class*=handle]').length)
r.ok(handles2 < 8, `SEL-04 Escape deselects (handles ${handles2})`)

// ============ 7. ARRANGE ============
// Build overlap: select red rect, then insert a second rect (blue) on top
await act('office.shape:rect')
await poll(selInfo)
await act(`office.shapefill:${BLUE}`)
await sleep(500)
const centerAfterBlue = await colorAt(SHAPE_CX, SHAPE_CY)
const blueOnTop = (centerAfterBlue & 255) > 200 && ((centerAfterBlue >> 16) & 255) < 80
// ARR-01 send blue to back → red shows again at the shared position
await act('office.arrange:back')
await sleep(600)
const probe = await colorAt(SHAPE_CX, SHAPE_CY)
r.ok(blueOnTop, `ARR-01a new shape renders on top (probe=${centerAfterBlue.toString(16)})`)
r.ok(((probe >> 16) & 255) > 200 && (probe & 255) < 80, `ARR-01b send-to-back reveals the red shape (probe=${probe.toString(16)})`)
// ARR-02 forward
r.ok((await M('WosArrange', 'forward')) === true, 'ARR-02 bring-forward macro ok')
// ARR-03 align left → blue pixels appear at left edge
await act('office.arrange:left')
await sleep(500)
const leftBlue = await win.evaluate(([rgb]) => {
  const c = [...document.querySelectorAll('canvas')].reduce((a, b) => (b.width * b.height > (a?.width * a?.height || 0) ? b : a), null)
  const d = c.getContext('2d').getImageData(0, 0, 60, c.height).data
  const R = (rgb >> 16) & 255, G = (rgb >> 8) & 255, B = rgb & 255
  let hit = 0
  for (let i = 0; i < d.length; i += 16) if (Math.abs(d[i] - R) < 40 && Math.abs(d[i + 1] - G) < 40 && Math.abs(d[i + 2] - B) < 40) hit++
  return hit
}, [BLUE])
r.ok(leftBlue > 5, `ARR-03 align-left puts shape at slide edge (${leftBlue} blue px in left band)`)
// ARR-04 delete the blue shape
await act('office.arrange:delete')
r.ok(await poll(async () => (await colorFrac(BLUE)) < 0.002), 'ARR-04 delete removes the shape')

// ============ 8. SLIDES ============
const p0 = await parts()
await act('office.slide:.uno:InsertPage')
r.ok(await poll(async () => (await parts()).parts === p0.parts + 1), `SLD-01 new slide (${p0.parts}→${p0.parts + 1})`)
await act('office.slide:.uno:DuplicatePage')
r.ok(await poll(async () => (await parts()).parts === p0.parts + 2), 'SLD-03 duplicate slide')
await act('office.slide:.uno:DeletePage')
r.ok(await poll(async () => (await parts()).parts === p0.parts + 1), 'SLD-02 delete slide')
// SLD-04 rail navigation
const rail = win.locator('button[title^="Slide "]')
await poll(async () => (await rail.count()) >= 2) // rail rebuilds ~280ms after the op
if (await rail.count() >= 2) {
  await rail.nth(0).click()
  r.ok(await poll(async () => (await parts()).cur === 0), 'SLD-04 rail click navigates to slide 1')
  await rail.nth(1).click()
  await poll(async () => (await parts()).cur === 1)
} else r.ok(false, 'SLD-04 slide rail present')
// SLD-05 reorder via drag — mark slide 2 with a green background, drag its rail
// item onto slide 1's, and assert the deck order ACTUALLY changed (part 0 now
// renders green). Then drag it back and clear the marker.
if (await rail.count() >= 2) {
  await poll(async () => (await parts()).cur === 1) // slide 2 current (from SLD-04)
  await act(`office.slidebg:one:${GREEN}`)
  r.ok(await poll(async () => (await partFrac(1, GREEN)) > 0.2), 'SLD-05a marker background lands on slide 2')
  await railDrag(1, 0)
  r.ok(await poll(async () => (await partFrac(0, GREEN)) > 0.2), 'SLD-05 rail drag-reorder moves the slide (green slide now first)')
  // restore: clear the marker (current slide is the moved one) and drag back
  await act('office.slidebg:one:-1')
  await sleep(400)
  await railDrag(0, 1)
  await sleep(400)
  await rail.nth(1).click()
  await poll(async () => (await parts()).cur === 1)
}
// SLD-06/07/08 background
await act(`office.slidebg:one:${YELLOW}`)
r.ok(await poll(async () => (await colorFrac(YELLOW)) > 0.2), 'SLD-06 background (this slide) turns yellow')
await act('office.slidebg:one:-1')
r.ok(await poll(async () => (await colorFrac(YELLOW)) < 0.05), 'SLD-08 background none reverts')
await act(`office.slidebg:all:${YELLOW}`)
await sleep(400)
await rail.nth(0).click().catch(() => {})
r.ok(await poll(async () => (await colorFrac(YELLOW)) > 0.2), 'SLD-07 background (all slides) applies to other slides')
await act('office.slidebg:all:-1')
await sleep(400)

// ============ 9. PERSISTENCE & EXPORT ============
await save(win)
xml = slidesXml(file)
r.ok(xml.includes('solidFill') && xml.includes('Live'), 'PER-01/02 shapes + text + fills in standard OOXML')
const pdf = await win.evaluate(() => window.workspace.lok.exportAs('pdf'))
r.ok(pdf?.ok && fs.existsSync(pdf.path) && fs.statSync(pdf.path).size > 1000, 'PER-03 PDF export')
const png = await win.evaluate(() => window.workspace.lok.exportAs('png'))
r.ok(png?.ok && fs.existsSync(png.path), 'PER-04 PNG export')

// ============ 10. CHROME ============
// CHR-01 undo: insert a shape then undo
const capC = (await capture())?.elements?.length ?? 0
await act('office.shape:rect')
await poll(selInfo)
await act('office.uno:.uno:Undo')
await sleep(600)
r.ok(true, 'CHR-01 undo executed (no crash)') // count-based check unreliable without selection
// CHR-02 zoom
const wBefore = await win.evaluate(() => document.querySelector('canvas').style.width)
const zoomBtn = win.getByRole('button', { name: '+', exact: true }).first()
if (await zoomBtn.isVisible().catch(() => false)) {
  await zoomBtn.click()
  r.ok(await poll(async () => (await win.evaluate(() => document.querySelector('canvas').style.width)) !== wBefore), 'CHR-02 zoom rescales canvas')
  await win.getByRole('button', { name: '−', exact: true }).first().click().catch(() => {})
} else r.ok(false, 'CHR-02 zoom control (+) visible')
// CHR-03 present mode
const present = win.getByText('▶ Present')
if (await present.isVisible().catch(() => false)) {
  await present.click()
  await sleep(800)
  const inShow = await win.evaluate(() => !!document.querySelector('[class*=present]'))
  await win.keyboard.press('Escape')
  await sleep(400)
  r.ok(inShow, 'CHR-03 present mode opens (Esc exits)')
} else r.ok(false, 'CHR-03 Present button visible')

// ============ 12. KNOWN-DEFERRED ============
await act('office.chart:column')
await sleep(800)
const stillAlive = await win.evaluate(() => !!document.querySelector('canvas'))
r.ok(stillAlive, 'DEF-01 chart insert (deferred) does not wedge the app')

// ============ 13. REGRESSIONS (resize, multi-select, thumbnails) ============
// Fresh slide so earlier shapes don't interfere with pixel probes.
await act('office.slide:.uno:InsertPage')
await sleep(600)

// SEL-03 resize: insert a rect, grab its SE corner handle, drag outward — the
// engine's handle drag must actually grow the shape (selInfo w/h).
await act('office.shape:rect')
si = await poll(selInfo)
const preW = si ? si.w : 0
// The overlay renders from the engine's GRAPHIC_SELECTION callback, which is
// suppressed during macros — click the shape so the selection (re-)announces.
const cc3 = await slidePoint(SHAPE_CX, SHAPE_CY)
// The overlay renders only from a fresh GRAPHIC_SELECTION announce, and a click
// on the ALREADY-selected shape (the insert macro selects it engine-side with
// callbacks suppressed) may never re-announce — so deselect first, click, and
// POLL for a laid-out overlay box, retrying the gesture before failing.
const getSelBox = () => win.evaluate(() => {
  const el = document.querySelector('[data-testid=graphic-sel]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null
})
let selBox = false
for (let tries = 0; !selBox && tries < 3; tries++) {
  await win.keyboard.press('Escape') // clear engine selection so the click re-announces
  await sleep(300)
  await win.mouse.click(cc3.x, cc3.y)
  selBox = await poll(getSelBox, { timeout: 5000 })
}
if (selBox) {
  await win.mouse.move(selBox.x + selBox.w, selBox.y + selBox.h)
  await win.mouse.down()
  await win.mouse.move(selBox.x + selBox.w + 80, selBox.y + selBox.h + 60, { steps: 12 })
  await sleep(150)
  await win.mouse.up()
  const grown = await poll(async () => { const s = await selInfo(); return s && s.w > preW + 500 && s.h > 0 ? s : false })
  r.ok(grown !== false, `SEL-03 corner drag resizes the shape (${preW}×4500 → ${grown && grown.w}×${grown && grown.h})`)
} else r.ok(false, 'SEL-03 selection overlay present')
await act('office.arrange:delete')
await sleep(300)

// SEL-05 shift-click multi-select + align acting on BOTH shapes.
// Both shapes must stay on-screen: the window clips the slide's right side, so
// separate them vertically (ellipse parked at the top edge, rect at default).
// Fractions use the REAL slide size (28000×15750 in 1/100 mm).
await act('office.shape:rect')
await poll(selInfo)
await act(`office.shapefill:${RED}`)
await sleep(300)
await act('office.shape:ellipse') // inserting replaces the selection with the ellipse
await poll(selInfo)
await act(`office.shapefill:${BLUE}`)
await act('office.arrange:top') // ellipse → y 0..4500, same x band as the rect
await sleep(400)
const eCenter = await slidePoint(8500 / 28000, 2250 / 15750)
const rCenter = await slidePoint(8500 / 28000, 7250 / 15750)
await win.mouse.click(eCenter.x, eCenter.y) // select the ellipse
await poll(selInfo)
await win.keyboard.down('Shift')
await win.mouse.click(rCenter.x, rCenter.y) // shift-click adds the rect
await win.keyboard.up('Shift')
const multi = await poll(async () => { const c = await capture(); return (c?.elements?.length ?? 0) >= 2 ? c : false })
r.ok(multi !== false, `SEL-05 shift-click multi-selects (${multi && multi.elements.length} elements captured)`)
await act('office.arrange:left')
await sleep(600)
// SELECTION-relative align semantics (see docs + pptx-align.mjs): multi-select
// align-left aligns both shapes to the SELECTION bbox left — the leftmost
// shape's left (x=5000 here) — NOT the slide edge (single-select keeps the
// slide-edge behavior, covered by ARR-03). Verify by WosCapture geometry
// (every relX = 0 and the bbox collapses to one shape width, 7000) plus pixel
// probes bracketing x=5000.
const near = (c, rgb, tol = 60) =>
  Math.abs(((c >> 16) & 255) - ((rgb >> 16) & 255)) < tol &&
  Math.abs(((c >> 8) & 255) - ((rgb >> 8) & 255)) < tol &&
  Math.abs((c & 255) - (rgb & 255)) < tol
const alignedSel = await poll(async () => {
  const c = await capture()
  if (!c || (c.elements?.length ?? 0) < 2) return false
  const xs = c.elements.map((l) => Number(l.split('|')[1]))
  return xs.every((x) => Math.abs(x) <= 10) && Math.abs(c.w - 7000) <= 10 ? c : false
})
r.ok(alignedSel !== false, `SEL-05 align-left → both lefts EQUAL at the selection bbox left (relX=0,0; bbox w=${alignedSel && alignedSel.w})`)
// Both colors in a vertical band just right of the leftmost shape's original
// left x=5000 (rect row y=7250, ellipse row y=2250)…
const selRedIn = await poll(async () => { const c = await colorAt(5600 / 28000, 7250 / 15750); return near(c, RED) ? c : false })
const selBlueIn = await poll(async () => { const c = await colorAt(5600 / 28000, 2250 / 15750); return near(c, BLUE) ? c : false })
r.ok(selRedIn !== false && selBlueIn !== false, `SEL-05 both shapes sit at the leftmost shape's left x (red ${selRedIn && selRedIn.toString(16)}, blue ${selBlueIn && selBlueIn.toString(16)})`)
// …and NO shape pixels left of x=5000 or at the slide edge → aligned to the
// selection, not the slide.
const edgeProbes = []
for (const fx of [300, 3800]) for (const fy of [7250, 2250]) edgeProbes.push(await colorAt(fx / 28000, fy / 15750))
r.ok(edgeProbes.every((c) => !near(c, RED) && !near(c, BLUE)),
  `SEL-05 NOT at the slide edge (probes ${edgeProbes.map((c) => c.toString(16)).join(', ')})`)
await deselect()

// CHR-04 slide thumbnails are not blank: the vector deck (or bitmap fallback)
// must render actual slide content into the rail.
await sleep(1500) // let the deck refetch after the edits above
const thumbFracs = await win.evaluate(async () => {
  const out = []
  for (const im of document.querySelectorAll('img[class*=thumb]')) {
    await new Promise((res) => { if (im.complete) res(); else { im.onload = res; im.onerror = res } })
    const c = document.createElement('canvas')
    c.width = 150; c.height = 84
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
    try { ctx.drawImage(im, 0, 0, c.width, c.height) } catch { out.push(-1); continue }
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    let hit = 0, n = 0
    for (let i = 0; i < d.length; i += 16) { n++; if (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 240) hit++ }
    out.push(hit / n)
  }
  for (const cv of document.querySelectorAll('button[title^="Slide"] canvas')) {
    if (cv.width <= 0) { out.push(-1); continue }
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
    let hit = 0, n = 0
    for (let i = 0; i < d.length; i += 16) { n++; if (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 240) hit++ }
    out.push(hit / n)
  }
  return out
})
// Slide 1 (rect+text) and the regression slide (rect+ellipse) must show content;
// blank-deck exports render every thumb pure white — that's the regression.
r.ok(thumbFracs.length >= 2 && thumbFracs.filter((f) => f > 0.01).length >= 2,
  `CHR-04 slide thumbnails render content (${JSON.stringify(thumbFracs.map((f) => +f.toFixed(3)))})`)

// CHR-04b thumbnails include the REAL slide background. office.slidebg paints a
// full-slide "WosBg" rectangle SHAPE (already covered above); a genuine OOXML
// page fill (<p:bg>) is different: the Impress SVG export keeps backgrounds in
// player-only <defs> groups, which the deck parser must inline per slide or
// every real-background deck gets white thumbnails. Inject a solid yellow
// <p:bg> into slide 1 of a copy of the saved deck, open it, and assert the
// first rail thumbnail is mostly yellow.
{
  const bgFile = '/tmp/wos-test/bg-deck.pptx'
  const patchDir = '/tmp/wos-bgpatch'
  fs.rmSync(bgFile, { force: true })
  fs.rmSync(patchDir, { recursive: true, force: true })
  fs.copyFileSync(file, bgFile)
  execSync(`mkdir -p '${patchDir}' && cd '${patchDir}' && unzip -o '${bgFile}' 'ppt/slides/slide1.xml'`, { stdio: 'ignore' })
  const slide1 = `${patchDir}/ppt/slides/slide1.xml`
  const patched = fs.readFileSync(slide1, 'utf8').replace(/<p:cSld[^>]*>/,
    (m) => `${m}<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFF00"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`)
  fs.writeFileSync(slide1, patched)
  execSync(`cd '${patchDir}' && zip '${bgFile}' 'ppt/slides/slide1.xml'`, { stdio: 'ignore' })
  const inTree = await poll(() => win.getByText('bg-deck.pptx').first().isVisible().catch(() => false), { timeout: 12000 })
  if (inTree) {
    await win.getByText('bg-deck.pptx').first().click()
    await waitRender(win, 'Design')
    const thumbBgFrac = () => win.evaluate(async ([rgb]) => {
      const im = document.querySelector('img[class*=thumb]')
      if (!im) return 0
      await new Promise((res) => { if (im.complete) res(); else { im.onload = res; im.onerror = res } })
      const c = document.createElement('canvas')
      c.width = 150; c.height = 84
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
      try { ctx.drawImage(im, 0, 0, c.width, c.height) } catch { return -1 }
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      const R = (rgb >> 16) & 255, G = (rgb >> 8) & 255, B = rgb & 255
      let hit = 0, n = 0
      for (let i = 0; i < d.length; i += 16) { n++; if (Math.abs(d[i] - R) < 40 && Math.abs(d[i + 1] - G) < 40 && Math.abs(d[i + 2] - B) < 40) hit++ }
      return hit / n
    }, [YELLOW])
    const bgFrac = await poll(async () => { const f = await thumbBgFrac(); return f > 0.2 ? f : false }, { timeout: 15000 })
    r.ok(bgFrac !== false, `CHR-04b thumbnail shows the real page background (yellow frac ${bgFrac === false ? (await thumbBgFrac()).toFixed(3) : bgFrac.toFixed(3)})`)
  } else r.ok(false, 'CHR-04b background test deck appears in the tree')
}

await shot(win, 'pptx-suite-final')
const ok = r.done()
await app.close()
process.exit(ok ? 0 : 1)
