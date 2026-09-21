// Phase AB — DRAG-COMMIT LATENCY PROFILE, on the REAL LOK engine, against a REAL deck.
//
// WHY: after the model-API rework (WosShapeSize + WosShapeMove committed on
// release, overlay owns the drag visually) the user reports "much better, still a
// little laggy". This attributes what remains, instead of guessing. It decomposes
// the two latencies the user can actually feel and prints a budget:
//
//   CLICK-TO-SELECTED = mouse BUTTONDOWN/UP  ->  cb:6 GRAPHIC_SELECTION
//   DROP-TO-SHARP     = BUTTONUP + WosShapeMove (+WosShapeSize) + settle delay
//                       + region repaint of the old∪new bounds
//
// The settle delay is a CONSTANT we choose (settleShapeRegion's setTimeout, 30ms
// at time of writing) so it is reported as a line item — if the engine work turns
// out to be small, that constant is the cheapest thing left to cut.
//
// Region repaint is measured at the REAL union sizes a drag produces (a small
// nudge vs. a half-slide throw), because the whole point of settleShapeRegion is
// that it scales with the drag, not with the slide.
//
// Reuses Y-impress-perf's proven host driver (fd3=JSON 'J' callbacks, fd4=tiles
// 'T'/'B') and its tile-grid math, so the tile commands issued here are the ones
// useLokPaint actually builds. MEASUREMENT ONLY — touches no product code.
//
// Deck: a REAL .pptx if one is passed/found (the deck the user click-tested),
// else a synthetic fallback so the bench still runs anywhere.
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const DEV_ENGINE = '/Volumes/LOBuild/core/instdir/LibreOffice.app/Contents'
const BUNDLED_ENGINE = path.join(ROOT, 'release/mac-arm64/Workspace OS.app/Contents/Resources/libreoffice/LibreOffice.app/Contents')
const ENGINE = fs.existsSync(DEV_ENGINE + '/Resources/fundamentalrc') ? DEV_ENGINE : BUNDLED_ENGINE
const HOST = path.join(ROOT, 'scripts/lok/wos-lok-host')

// The deck to profile: argv[2], else the known real one, else synthetic.
const REAL_DECK = process.argv[2] || process.env.WOS_PROFILE_DECK
if (!REAL_DECK) { console.log('usage: node e2e/office/AB-drag-profile.mjs <real-deck.pptx>  (or WOS_PROFILE_DECK)'); process.exit(2) }
const WORK = '/tmp/wos-ab-drag-profile.pptx'
const useReal = fs.existsSync(REAL_DECK)

if (!fs.existsSync(HOST) || !fs.existsSync(ENGINE + '/Resources/fundamentalrc')) { console.log('SKIP: engine/host missing'); process.exit(0) }

// ---- Canvas geometry — mirrored from lokCanvasUtils.ts / useLokPaint.ts --------
const DPI = 96
const TWIPS_PER_INCH = 1440
const TILE = 512
const DPR = 2 // Retina — the user's actual display

function findEsbuild(start) {
  let dir = start
  for (;;) {
    const bin = path.join(dir, 'node_modules/.bin/esbuild')
    if (fs.existsSync(bin)) return bin
    const up = path.dirname(dir)
    if (up === dir) throw new Error('esbuild not found in any parent node_modules')
    dir = up
  }
}
const ESBUILD = findEsbuild(ROOT)
const SEED_ENTRY = '/tmp/wos-ab-seed-entry.mts'
const SEED_LIB = '/tmp/wos-ab-seed-lib.mjs'
fs.writeFileSync(SEED_ENTRY, `export { seedEngineProfile, seedMacroLibrary } from '${path.join(ROOT, 'src/main/office/lokMacros.ts')}'\n`)
execSync(`'${ESBUILD}' '${SEED_ENTRY}' --bundle --platform=node --format=esm --outfile='${SEED_LIB}'`, { stdio: 'ignore' })
const { seedEngineProfile, seedMacroLibrary } = await import(SEED_LIB)

// ---- Host wire protocol --------------------------------------------------------
try { fs.rmSync(WORK, { force: true }) } catch { /* */ }
if (useReal) fs.copyFileSync(REAL_DECK, WORK) // never mutate the user's file
try { fs.rmSync('/tmp/wos-lok-host-profile', { recursive: true, force: true }) } catch { /* */ }
const proc = spawn(HOST, [ENGINE + '/Frameworks/', ENGINE + '/Resources/fundamentalrc'], { stdio: ['pipe', 'ignore', 'inherit', 'pipe', 'pipe'] })
const waiters = new Map()
let onReady = null, readySeen = false
// cb:6 GRAPHIC_SELECTION listener — the host marks it non-droppable, so it fires
// only on a genuine selection change (and is suppressed during macros).
let onGraphicSel = null

function makeParser() {
  let buf = Buffer.alloc(0)
  return (chunk) => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      if (buf.length < 4) break
      const len = buf.readUInt32LE(0)
      if (buf.length < 4 + len) break
      const type = String.fromCharCode(buf[4])
      const body = buf.subarray(5, 4 + len)
      buf = buf.subarray(4 + len)
      if (type === 'J') {
        const m = JSON.parse(body.toString('utf8'))
        if (m.event === 'ready') { readySeen = true; if (onReady) onReady() }
        else if (m.cb === 6) { if (onGraphicSel) onGraphicSel(m.payload ?? '') }
        else if (m.id != null && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id) }
      } else if (type === 'T' || type === 'B') {
        const id = body.readUInt32LE(0)
        const n = type === 'B' ? body.readUInt32LE(4) : 1
        if (waiters.has(id)) { waiters.get(id)({ id, tiles: n }); waiters.delete(id) }
      }
    }
  }
}
proc.stdio[3].on('data', makeParser())
proc.stdio[4].on('data', makeParser())

let nextId = 1
const send = (cmd) => new Promise((res) => { const id = nextId++; waiters.set(id, res); proc.stdin.write(`${id} ${cmd}\n`) })
const ready = () => new Promise((res) => { if (readySeen) return res(); onReady = res })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function macro(name, args = '') { fs.writeFileSync('/tmp/wos-macro-generic.txt', args + '\n', 'utf8'); return send(`macro ${name} ${args}`) }

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] }
const stat = (a) => ({ min: Math.min(...a), med: pct(a, 0.5), p95: pct(a, 0.95) })
const f = (n) => n.toFixed(1)

// Tile grid for an arbitrary doc-twips RECT at a zoom — the same math
// useLokPaint.paintRegion() uses to turn a dirty rect into tile fetches.
function regionSpecs(rx, ry, rw, rh, zoom) {
  const devPerTwip = ((DPI * zoom) / TWIPS_PER_INCH) * DPR
  const x0 = Math.floor((rx * devPerTwip) / TILE) * TILE
  const y0 = Math.floor((ry * devPerTwip) / TILE) * TILE
  const x1 = Math.ceil(((rx + rw) * devPerTwip) / TILE) * TILE
  const y1 = Math.ceil(((ry + rh) * devPerTwip) / TILE) * TILE
  const specs = []
  for (let oy = y0; oy < y1; oy += TILE) {
    for (let ox = x0; ox < x1; ox += TILE) {
      specs.push({ cw: TILE, ch: TILE, tx: Math.round(ox / devPerTwip), ty: Math.round(oy / devPerTwip), tw: Math.round(TILE / devPerTwip), th: Math.round(TILE / devPerTwip) })
    }
  }
  return specs
}
const tilesCmd = (s) => `tiles ${s.length} ${s.map((t) => `${t.cw} ${t.ch} ${t.tx} ${t.ty} ${t.tw} ${t.th}`).join(' ')}`
async function timeTiles(specs) { const t0 = performance.now(); const r = await send(tilesCmd(specs)); return { ms: performance.now() - t0, tiles: r.tiles } }

await ready()
seedEngineProfile()
seedMacroLibrary()

// ---- Open the deck -------------------------------------------------------------
if (useReal) {
  const r = await send(`open ${WORK}`)
  if (!r.ok) { console.log('SKIP: could not open the real deck'); proc.kill(); process.exit(0) }
} else {
  await send(`new simpress ${WORK}`)
}
await sleep(800)
const sz = await send('size')
const docW = Number(sz.w), docH = Number(sz.h)

// A shape to drive. On the real deck, click its middle to grab whatever is there;
// on the synthetic fallback insert one so there is something selectable.
if (!useReal) { await macro('WosShapeInsert', 'rect'); await sleep(300) }

// ---- 1. CLICK -> SELECTED (mouse down/up -> cb:6) -------------------------------
// Click a shape, then click empty space to deselect, and repeat. Only transitions
// to a NON-empty payload are timed.
const selMs = []
const ITERS = 12
async function clickAt(x, y) {
  await send(`mouse 0 ${x} ${y} 1 1 0`)
  await send(`mouse 1 ${x} ${y} 1 1 0`)
}
function waitSel(timeout = 3000) {
  return new Promise((res) => {
    const t0 = performance.now()
    const timer = setTimeout(() => { onGraphicSel = null; res(null) }, timeout)
    onGraphicSel = (payload) => {
      if (!payload || payload === 'EMPTY') return // deselect — keep waiting
      clearTimeout(timer); onGraphicSel = null; res({ ms: performance.now() - t0, payload })
    }
  })
}
// Select real shapes by TABBING through the slide's z-order — clicking probes a
// full-bleed background first on a real deck, and profiling a slide-sized object
// measures nothing a user would ever drag. Tab lands on each shape in turn and the
// engine reports its true bounds via cb:6; we keep the first shape that is a
// plausible drag target (< 25% of the slide area).
const TAB = { char: 9, code: 1282 }
const ESC = { char: 0, code: 1281 }
async function pressKey(k) { await send(`key 0 ${k.char} ${k.code}`); await send(`key 1 ${k.char} ${k.code}`) }

let hit = null
const seen = []
await pressKey(ESC)
await sleep(120)
for (let i = 0; i < 20; i++) {
  const w = waitSel(1500)
  await pressKey(TAB)
  const got = await w
  if (!got) break
  const p = got.payload.split(',').map((s) => parseInt(s.trim(), 10))
  if (p.length < 4 || Number.isNaN(p[0])) continue
  const cand = { x: p[0], y: p[1], w: p[2], h: p[3] }
  const areaFrac = (cand.w * cand.h) / (docW * docH)
  seen.push({ ...cand, areaFrac })
  if (!hit && areaFrac > 0.001 && areaFrac < 0.25) hit = { shape: cand, payload: got.payload }
}
console.log(`  [probe] tabbed through ${seen.length} shape(s); picked ${hit ? `${hit.shape.w}x${hit.shape.h}tw` : 'NONE'}`)

const shape = hit ? hit.shape : { x: 0, y: 0, w: 4000, h: 3000 }

// Click-to-selected: click the shape's centre, deselect with Escape, repeat. Only
// non-empty cb:6 payloads are timed (Escape emits EMPTY, which waitSel ignores).
let selStat = null
if (hit) {
  const cx = shape.x + Math.round(shape.w / 2), cy = shape.y + Math.round(shape.h / 2)
  for (let i = 0; i < ITERS; i++) {
    await pressKey(ESC)
    await sleep(80)
    const w = waitSel()
    await clickAt(cx, cy)
    const got = await w
    if (got) selMs.push(got.ms)
  }
  if (selMs.length) selStat = stat(selMs)
}

// ---- 2. MACRO ROUND-TRIP (the commit itself) ------------------------------------
// Re-select first: the deselect click above left nothing selected, and the macros
// act on CurrentController.Selection.
if (hit) { await clickAt(shape.x + Math.round(shape.w / 2), shape.y + Math.round(shape.h / 2)); await sleep(150) }
const mvMs = [], szMs = []
for (let i = 0; i < ITERS; i++) {
  const d = i % 2 === 0 ? 100 : -100 // nudge back and forth, net zero
  let t0 = performance.now(); await macro('WosShapeMove', `${d}|${d}`); mvMs.push(performance.now() - t0)
}
for (let i = 0; i < ITERS; i++) {
  const w = shape.w > 0 ? Math.round((shape.w * 2540) / 1440) : 6000
  const h = shape.h > 0 ? Math.round((shape.h * 2540) / 1440) : 4000
  const t0 = performance.now(); await macro('WosShapeSize', `${w + (i % 2 ? 50 : 0)}|${h}`); szMs.push(performance.now() - t0)
}
const sMv = stat(mvMs), sSz = stat(szMs)

// ---- 3. SETTLE REPAINT at real drag-union sizes ---------------------------------
const PAD = 220
// Mirrors settleShapeRegion: union of old+new bounds + pad, CLAMPED — the real
// code clamps to the visible viewport, and at fit-to-view (the common case) that
// viewport is the slide. Without the clamp a far drag would "measure" tiles
// outside the document, which the app never fetches.
function unionSpecs(dx, dy) {
  let x0 = Math.min(shape.x, shape.x + dx) - PAD
  let y0 = Math.min(shape.y, shape.y + dy) - PAD
  let x1 = Math.max(shape.x + shape.w, shape.x + dx + shape.w) + PAD
  let y1 = Math.max(shape.y + shape.h, shape.y + dy + shape.h) + PAD
  x0 = Math.max(0, x0); y0 = Math.max(0, y0)
  x1 = Math.min(docW, x1); y1 = Math.min(docH, y1)
  return regionSpecs(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0), 1.0)
}
const nudge = unionSpecs(300, 200)        // small nudge
const mid = unionSpecs(Math.round(docW * 0.2), Math.round(docH * 0.2))
const throwFar = unionSpecs(Math.round(docW * 0.45), Math.round(docH * 0.35))
// Full-slide baseline for comparison.
function fullSpecs(zoom) {
  const devPerTwip = ((DPI * zoom) / TWIPS_PER_INCH) * DPR
  const devW = Math.round(docW * devPerTwip), devH = Math.round(docH * devPerTwip)
  const specs = []
  for (let oy = 0; oy < devH; oy += TILE) for (let ox = 0; ox < devW; ox += TILE) {
    specs.push({ cw: Math.min(TILE, devW - ox), ch: Math.min(TILE, devH - oy), tx: Math.round(ox / devPerTwip), ty: Math.round(oy / devPerTwip), tw: Math.round(Math.min(TILE, devW - ox) / devPerTwip), th: Math.round(Math.min(TILE, devH - oy) / devPerTwip) })
  }
  return specs
}
const full100 = fullSpecs(1.0)
for (let i = 0; i < 3; i++) { await timeTiles(nudge); await timeTiles(full100) } // warm
const measure = async (specs) => { const a = []; for (let i = 0; i < ITERS; i++) a.push((await timeTiles(specs)).ms); return { s: stat(a), n: specs.length } }
const rNudge = await measure(nudge)
const rMid = await measure(mid)
const rThrow = await measure(throwFar)
const rFull = await measure(full100)

// ---- Report ---------------------------------------------------------------------
const SETTLE_DELAY = 30 // settleShapeRegion's setTimeout, ms
console.log('\n================================================================')
console.log('  PHASE AB — drag-commit latency profile (real engine)')
console.log('================================================================')
console.log(`  Deck: ${useReal ? REAL_DECK : 'synthetic fallback'}`)
console.log(`  Slide: ${docW}x${docH} twips | dpr=${DPR} | tile=${TILE}px | iters=${ITERS}`)
console.log(`  Shape under test: ${shape.w}x${shape.h} twips at (${shape.x},${shape.y})${hit ? '' : '  [NO SELECTION — fallback bounds]'}\n`)

console.log('  1) CLICK -> SELECTED   (mouse down/up -> cb:6 GRAPHIC_SELECTION)')
if (selStat) console.log(`     min ${f(selStat.min)} / med ${f(selStat.med)} / p95 ${f(selStat.p95)} ms   (n=${selMs.length})\n`)
else console.log('     (no selection captured on this deck)\n')

console.log('  2) COMMIT MACROS       (round-trip through the host, incl. Basic exec)')
console.log(`     WosShapeMove   min ${f(sMv.min)} / med ${f(sMv.med)} / p95 ${f(sMv.p95)} ms`)
console.log(`     WosShapeSize   min ${f(sSz.min)} / med ${f(sSz.med)} / p95 ${f(sSz.p95)} ms\n`)

console.log('  3) SETTLE REPAINT      (region paint of old∪new bounds, +220tw pad)')
console.log('     +---------------------+--------+---------+---------+')
console.log('     | drag               | tiles  |  median |   p95   |')
console.log('     +---------------------+--------+---------+---------+')
console.log(`     | small nudge         | ${String(rNudge.n).padStart(6)} | ${f(rNudge.s.med).padStart(7)} | ${f(rNudge.s.p95).padStart(7)} |`)
console.log(`     | mid (20% of slide)  | ${String(rMid.n).padStart(6)} | ${f(rMid.s.med).padStart(7)} | ${f(rMid.s.p95).padStart(7)} |`)
console.log(`     | far throw (45%)     | ${String(rThrow.n).padStart(6)} | ${f(rThrow.s.med).padStart(7)} | ${f(rThrow.s.p95).padStart(7)} |`)
console.log(`     | FULL slide (ref)    | ${String(rFull.n).padStart(6)} | ${f(rFull.s.med).padStart(7)} | ${f(rFull.s.p95).padStart(7)} |`)
console.log('     +---------------------+--------+---------+---------+\n')

const budget = (label, repaint) => {
  const total = sMv.med + SETTLE_DELAY + repaint
  console.log(`     ${label.padEnd(20)} ${f(sMv.med).padStart(6)} + ${String(SETTLE_DELAY).padStart(2)} + ${f(repaint).padStart(6)} = ${f(total).padStart(6)} ms`)
}
console.log('  4) DROP-TO-SHARP BUDGET  (macro + settle delay + region repaint)')
console.log('     drag                 macro   dly   paint    TOTAL')
budget('small nudge', rNudge.s.med)
budget('mid drag', rMid.s.med)
budget('far throw', rThrow.s.med)
console.log(`\n     (a resize adds WosShapeSize: +${f(sSz.med)} ms)\n`)

await send('close')
proc.stdin.end(); proc.kill()
await sleep(200)
process.exit(0)
