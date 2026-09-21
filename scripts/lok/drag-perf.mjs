// Impress shape-DRAG repaint-latency benchmark, on the REAL LOK engine.
//
// WHY this exists: we have objective ms for ZOOM (full-slide) repaints (see
// e2e/office/Y-impress-perf.mjs) but the DRAG path — the per-move region repaint
// the renderer fires while you drag a shape — was never measured. This puts ms
// behind "how responsive is dragging a shape?".
//
// WHAT it does: boots the SAME proven host driver as Y-impress-perf (spawn
// wos-lok-host directly; fd3=JSON 'J', fd4=tiles 'T'/'B'; seed engine profile +
// Wos macro library; `new simpress`), inserts a rectangle (WosShapeInsert) and
// selects it, then SIMULATES a drag: a mouse DOWN on the shape centre, ~30 mouse
// MOVE steps translating the shape ~40 twips/step across the slide, then mouse
// UP. Coords in twips — the exact `mouse <type> <x> <y> <count> <buttons>
// <modifier>` wire command the host's cmdMouse → postMouseEvent expects (type
// 0=down,1=up,2=move; buttons=1 left).
//
// For EACH move it times the region repaint: after the move it requests the
// tiles for the shape's OLD+NEW bounds (a modest region, like the renderer's
// settleShapeRegion — NOT the whole slide) and measures send→B-frame-received
// ms. The host DOES emit INVALIDATE_TILES on drag; when a rect arrives on the
// callback fd we use it to SIZE the region, else we fall back to the tracked
// shape bounds ± a margin (mirrors settleShapeRegion's PAD).
//
// It never touches product code — only replays the on-wire mouse + tiles the
// renderer sends (useLokInput.ts / useLokPaint.ts) and the host parses
// (wos-lok-host.cpp cmdMouse / cmdTiles). Deterministic: fixed step count/size.
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
const DOC = '/tmp/wos-drag-perf.pptx'

if (!fs.existsSync(HOST) || !fs.existsSync(ENGINE + '/Resources/fundamentalrc')) { console.log('SKIP: engine/host missing'); process.exit(0) }

// ---- Canvas geometry — mirrored from lokCanvasUtils.ts (device px = CSS × dpr).
const DPI = 96
const TWIPS_PER_INCH = 1440
const TILE = 512
const DPR = 2 // Retina — the app's real repaint case

// ---- Bundle the Wos macro seeder from TS (same approach as Y). ------------------
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
const SEED_ENTRY = '/tmp/wos-drag-seed-entry.mts'
const SEED_LIB = '/tmp/wos-drag-seed-lib.mjs'
fs.writeFileSync(SEED_ENTRY, `export { seedEngineProfile, seedMacroLibrary } from '${path.join(ROOT, 'src/main/office/lokMacros.ts')}'\n`)
execSync(`'${ESBUILD}' '${SEED_ENTRY}' --bundle --platform=node --format=esm --outfile='${SEED_LIB}'`, { stdio: 'ignore' })
const { seedEngineProfile, seedMacroLibrary } = await import(SEED_LIB)

// ---- Host wire protocol (fd3=JSON 'J', fd4=tiles 'T'/'B') -----------------------
try { fs.rmSync(DOC, { force: true }) } catch { /* */ }
try { fs.rmSync('/tmp/wos-lok-host-profile', { recursive: true, force: true }) } catch { /* */ }
const proc = spawn(HOST, [ENGINE + '/Frameworks/', ENGINE + '/Resources/fundamentalrc'], { stdio: ['pipe', 'ignore', 'inherit', 'pipe', 'pipe'] })
const waiters = new Map()
let onReady = null, readySeen = false

// Latest INVALIDATE_TILES rect the engine pushed (cb:0). The host coalesces a
// drag's invalidate burst into ONE union frame; we read it to SIZE the repaint
// region for the just-issued move. {x,y,w,h} twips, or 'full', or null.
let lastInval = null

// One length-prefixed frame parser, fed by both fd3 and fd4. Frame =
// [uint32 LE len][1 byte type][body]. 'J'=JSON, 'T'=single tile, 'B'=batched.
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
        else if (m.cb === 0) {
          // INVALIDATE_TILES union — "EMPTY" (whole doc) or "x, y, w, h" twips.
          const p = m.payload || ''
          if (p === 'EMPTY') lastInval = 'full'
          else { const [x, y, w, h] = p.split(',').map((s) => parseInt(s, 10)); if ([x, y, w, h].every(Number.isFinite)) lastInval = { x, y, w, h } }
        } else if (m.id != null && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id) }
      } else if (type === 'T') {
        const id = body.readUInt32LE(0)
        if (waiters.has(id)) { waiters.get(id)({ id, tiles: 1 }); waiters.delete(id) }
      } else if (type === 'B') {
        const id = body.readUInt32LE(0)
        const n = body.readUInt32LE(4)
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

// Build the tile-grid spec for an arbitrary doc-twips rect at `zoom` — identical
// math to useLokPaint (device px = CSS × dpr), just clamped to the region rect
// instead of the whole slide. This is what settleShapeRegion → scheduleRegionRepaint
// fetches: the tiles overlapping (old ∪ new) bounds.
function regionSpecs(rx, ry, rw, rh, zoom, docW, docH) {
  // Clamp region to the slide.
  rx = Math.max(0, rx); ry = Math.max(0, ry)
  rw = Math.min(rw, docW - rx); rh = Math.min(rh, docH - ry)
  if (rw <= 0 || rh <= 0) return []
  const devPerTwip = ((DPI * zoom) / TWIPS_PER_INCH) * DPR
  // Snap the region to the tile grid (the renderer fetches whole tiles).
  const dx0 = Math.floor((rx * devPerTwip) / TILE) * TILE
  const dy0 = Math.floor((ry * devPerTwip) / TILE) * TILE
  const dx1 = Math.ceil(((rx + rw) * devPerTwip) / TILE) * TILE
  const dy1 = Math.ceil(((ry + rh) * devPerTwip) / TILE) * TILE
  const devW = Math.max(1, Math.round(docW * devPerTwip))
  const devH = Math.max(1, Math.round(docH * devPerTwip))
  const specs = []
  for (let oy = dy0; oy < dy1 && oy < devH; oy += TILE) {
    for (let ox = dx0; ox < dx1 && ox < devW; ox += TILE) {
      const cw = Math.min(TILE, devW - ox)
      const ch = Math.min(TILE, devH - oy)
      if (cw <= 0 || ch <= 0) continue
      specs.push({ cw, ch, tx: Math.round(ox / devPerTwip), ty: Math.round(oy / devPerTwip), tw: Math.round(cw / devPerTwip), th: Math.round(ch / devPerTwip) })
    }
  }
  return specs
}

function tilesCmd(specs) {
  return `tiles ${specs.length} ${specs.map((s) => `${s.cw} ${s.ch} ${s.tx} ${s.ty} ${s.tw} ${s.th}`).join(' ')}`
}
async function timeRegion(specs) {
  const t0 = performance.now()
  const r = await send(tilesCmd(specs))
  return { ms: performance.now() - t0, tiles: r.tiles }
}
const mouse = (type, x, y) => send(`mouse ${type} ${Math.round(x)} ${Math.round(y)} 1 1 0`) // buttons=1 (left), modifier=0

const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] }
const stat = (arr) => ({ min: Math.min(...arr), med: pct(arr, 0.5), p95: pct(arr, 0.95) })
const f = (n) => n.toFixed(1)

await ready()

// ---- Boot: seed profile + macros, fresh deck, insert + select a rectangle.
seedEngineProfile()
seedMacroLibrary()
await send(`new simpress ${DOC}`)
await sleep(300)
await send('macro WosShapeInsert rect') // WosShapeInsert: pos (5000,5000), size 7000x4500 twips, selects it
await sleep(300)
const sz = await send('size')
const docW = Number(sz.w), docH = Number(sz.h)

// Shape geometry (from WosShapeInsert): a rect at (5000,5000), 7000x4500 twips.
const SHAPE = { x: 5000, y: 5000, w: 7000, h: 4500 }
const PAD = 220 // twips — settleShapeRegion's handle margin
const ZOOM = 1.0 // drag happens at 100% (the common case)
const STEP = 40 // twips per move — the task's step size
const MOVES = 30

// Warm the engine (first paints touch cold caches) with a couple region repaints.
{
  const s = regionSpecs(SHAPE.x - PAD, SHAPE.y - PAD, SHAPE.w + 2 * PAD, SHAPE.h + 2 * PAD, ZOOM, docW, docH)
  for (let i = 0; i < 3; i++) await timeRegion(s)
}

// ---- Simulate the drag. DOWN on the shape centre; step it diagonally so it
// stays on-slide across 30 moves (~40 twips/step); UP at the end.
const cx = SHAPE.x + SHAPE.w / 2
const cy = SHAPE.y + SHAPE.h / 2
// Keep the whole path inside the slide: cap so cx+STEP*MOVES and cy stay in-bounds.
const maxX = docW - SHAPE.w / 2 - PAD
const maxY = docH - SHAPE.h / 2 - PAD
const stepX = Math.min(STEP, (maxX - cx) / MOVES)
const stepY = Math.min(STEP, (maxY - cy) / MOVES)

await mouse(0, cx, cy) // BUTTONDOWN — grabs the shape
await sleep(20)

const rows = [] // { i, ms, tiles, src }
let curX = cx, curY = cy
let prevBounds = { ...SHAPE }
for (let i = 0; i < MOVES; i++) {
  const nx = curX + stepX, ny = curY + stepY
  lastInval = null
  await mouse(2, nx, ny) // MOVE — engine translates the grabbed shape
  // The move's invalidate burst is coalesced by the host; give it a beat to arrive.
  await sleep(8)

  // New shape bounds after this step (top-left tracks the centre delta).
  const dx = nx - cx, dy = ny - cy
  const newBounds = { x: SHAPE.x + dx, y: SHAPE.y + dy, w: SHAPE.w, h: SHAPE.h }

  // Size the repaint region: prefer the engine's invalidate rect; else the
  // old∪new shape bounds ± PAD (exactly what settleShapeRegion computes).
  let rx, ry, rw, rh, src
  if (lastInval && lastInval !== 'full') {
    ({ x: rx, y: ry, w: rw, h: rh } = lastInval); src = 'inval'
  } else {
    rx = Math.min(prevBounds.x, newBounds.x) - PAD
    ry = Math.min(prevBounds.y, newBounds.y) - PAD
    rw = (Math.max(prevBounds.x + prevBounds.w, newBounds.x + newBounds.w) + PAD) - rx
    rh = (Math.max(prevBounds.y + prevBounds.h, newBounds.y + newBounds.h) + PAD) - ry
    src = lastInval === 'full' ? 'full→bounds' : 'bounds'
  }

  const specs = regionSpecs(rx, ry, rw, rh, ZOOM, docW, docH)
  const { ms, tiles } = await timeRegion(specs)
  rows.push({ i: i + 1, ms, tiles, src })

  curX = nx; curY = ny; prevBounds = newBounds
}
await mouse(1, curX, curY) // BUTTONUP — commit

// ---- Report --------------------------------------------------------------------
const lat = rows.map((r) => r.ms)
const s = stat(lat)
const tileCounts = rows.map((r) => r.tiles)
const medTiles = pct(tileCounts, 0.5)
const invalUsed = rows.filter((r) => r.src === 'inval').length

console.log('\n================================================================')
console.log('  Impress shape-DRAG per-move region-repaint latency (real engine)')
console.log('================================================================')
console.log(`  Slide: ${docW}x${docH} twips  |  dpr=${DPR}  |  tile=${TILE}px  |  zoom=${(ZOOM * 100).toFixed(0)}%`)
console.log(`  Shape: rect ${SHAPE.w}x${SHAPE.h} twips @ (${SHAPE.x},${SHAPE.y})  |  ${MOVES} moves x ${STEP} twips/step`)
console.log(`  Region source: engine invalidate rect on ${invalUsed}/${MOVES} moves; else old∪new bounds ±${PAD} twips\n`)
console.log('  Per-move repaint (send region tiles -> B-frame received):')
console.log('  +------+-------+---------+--------------+')
console.log('  | move | tiles |   ms    | region src   |')
console.log('  +------+-------+---------+--------------+')
for (const r of rows) {
  console.log(`  | ${String(r.i).padStart(4)} | ${String(r.tiles).padStart(5)} | ${f(r.ms).padStart(7)} | ${r.src.padEnd(12)} |`)
}
console.log('  +------+-------+---------+--------------+')
console.log(`\n  Per-move region-repaint latency over ${MOVES} moves:`)
console.log(`    min ${f(s.min)} ms  |  median ${f(s.med)} ms  |  p95 ${f(s.p95)} ms`)
console.log(`    region tiles: median ${medTiles} (min ${Math.min(...tileCounts)} / max ${Math.max(...tileCounts)})`)

const verdict = s.med <= 16 ? 'RESPONSIVE (<=16ms, 60fps ideal)'
  : s.med <= 33 ? 'ACCEPTABLE (<=33ms, 30fps)'
  : 'SLUGGISH (>33ms — below 30fps)'
console.log(`\n  Verdict: median ${f(s.med)} ms -> ${verdict}`)
console.log('  Note: the renderer shows an OPTIMISTIC overlay of the shape during the')
console.log('  drag (useLokInput move/resize refs), so the user sees the shape follow')
console.log('  the cursor instantly; this engine-side region repaint is the SETTLE cost')
console.log('  that lands the real pixels once the drag commits, measured here in isolation.\n')

await send('close')
proc.stdin.end(); proc.kill()
await sleep(200)
process.exit(0)
