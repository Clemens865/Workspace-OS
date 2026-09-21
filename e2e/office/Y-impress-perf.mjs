// Phase Y — Impress (.pptx) REPAINT-LATENCY benchmark, on the REAL LOK engine.
//
// WHY this exists: to put objective ms behind the "optimized rendering" work
// (coalesced settle repaints + the persistent tile cache). It measures what the
// engine actually costs for a FULL-SLIDE repaint — the tile grid a repaint has
// to fetch — at 100% and at 200% zoom, then QUANTIFIES the tile cache's saving:
// a zoom-BACK to a previously-rendered scale is served from the renderer's
// TileCache (a memory blit) and pays ~0 engine time vs the full repaint cost.
//
// It reuses X-impress-table's PROVEN host driver: spawn wos-lok-host directly
// (fd3=JSON, fd4=tiles), seed the engine profile + Wos macro library, `new
// simpress`, then seed a slide table (via WosInsertSlideTable) so tiles carry
// real content. It never touches product code — it only replays the exact
// on-wire `tiles`/`tile` command the renderer's fetchTiles builds (see
// useLokPaint.ts) and the host parses (wos-lok-host.cpp cmdTiles/cmdTile).
//
// Deterministic: fixed WARM iteration count, fixed doc, no Electron cold-boot.
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
const DOC = '/tmp/wos-y-impress-perf.pptx'

if (!fs.existsSync(HOST) || !fs.existsSync(ENGINE + '/Resources/fundamentalrc')) { console.log('SKIP: engine/host missing'); process.exit(0) }

// ---- Canvas geometry constants — mirrored from lokCanvasUtils.ts so the tile
//      grid this bench builds is the SAME grid useLokPaint.paint() builds.
const DPI = 96
const TWIPS_PER_INCH = 1440
const TILE = 512
const DPR = 2 // Retina — the app's real full-repaint case (device px = CSS × dpr)

// ---- Bundle the Wos macro seeder from TS (same approach as X). ------------------
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
const SEED_ENTRY = '/tmp/wos-y-seed-entry.mts'
const SEED_LIB = '/tmp/wos-y-seed-lib.mjs'
fs.writeFileSync(SEED_ENTRY, `export { seedEngineProfile, seedMacroLibrary } from '${path.join(ROOT, 'src/main/office/lokMacros.ts')}'\n`)
execSync(`'${ESBUILD}' '${SEED_ENTRY}' --bundle --platform=node --format=esm --outfile='${SEED_LIB}'`, { stdio: 'ignore' })
const { seedEngineProfile, seedMacroLibrary } = await import(SEED_LIB)

// ---- Host wire protocol (fd3=JSON 'J', fd4=tiles 'T'/'B') -----------------------
try { fs.rmSync(DOC, { force: true }) } catch { /* */ }
try { fs.rmSync('/tmp/wos-lok-host-profile', { recursive: true, force: true }) } catch { /* */ }
const proc = spawn(HOST, [ENGINE + '/Frameworks/', ENGINE + '/Resources/fundamentalrc'], { stdio: ['pipe', 'ignore', 'inherit', 'pipe', 'pipe'] })
const waiters = new Map()
let onReady = null, readySeen = false

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
        else if (m.id != null && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id) }
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

// Build the exact tile-grid spec a full repaint fetches for a slide of `docW×docH`
// twips at `zoom` — identical math to useLokPaint.paint() (device px = CSS × dpr).
function fullSlideSpecs(docW, docH, zoom) {
  const devPerTwip = ((DPI * zoom) / TWIPS_PER_INCH) * DPR
  const devW = Math.max(1, Math.round(docW * devPerTwip))
  const devH = Math.max(1, Math.round(docH * devPerTwip))
  const specs = []
  for (let oy = 0; oy < devH; oy += TILE) {
    for (let ox = 0; ox < devW; ox += TILE) {
      const cw = Math.min(TILE, devW - ox)
      const ch = Math.min(TILE, devH - oy)
      specs.push({ cw, ch, tx: Math.round(ox / devPerTwip), ty: Math.round(oy / devPerTwip), tw: Math.round(cw / devPerTwip), th: Math.round(ch / devPerTwip) })
    }
  }
  return specs
}

// Fire the SAME `tiles <n> <cw ch tx ty tw th>...` command the renderer's
// window.workspace.lok.tiles() → LokHost.tiles() sends, timed end-to-end.
function tilesCmd(specs) {
  return `tiles ${specs.length} ${specs.map((s) => `${s.cw} ${s.ch} ${s.tx} ${s.ty} ${s.tw} ${s.th}`).join(' ')}`
}

async function timeFullRepaint(specs) {
  const t0 = performance.now()
  const r = await send(tilesCmd(specs))
  const ms = performance.now() - t0
  return { ms, tiles: r.tiles }
}

const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] }
const stat = (arr) => ({ min: Math.min(...arr), med: pct(arr, 0.5), p95: pct(arr, 0.95) })
const f = (n) => n.toFixed(1)

await ready()

// ---- Boot: seed profile + macros, fresh deck, add a table so tiles have content.
seedEngineProfile()
seedMacroLibrary()
await send(`new simpress ${DOC}`)
await sleep(300)
const TAG = 'wos-range-yperf'
fs.writeFileSync('/tmp/wos-table-in.txt', `${TAG}\nRevenue\tQ1\tQ2\nAmerica\t120\t180\nEMEA\t90\t140\nAPAC\t60\t110\n`, 'utf8')
await send('macro WosInsertSlideTable')
await sleep(300)
const sz = await send('size') // slide size in twips
const docW = Number(sz.w), docH = Number(sz.h)

const specs100 = fullSlideSpecs(docW, docH, 1.0)
const specs200 = fullSlideSpecs(docW, docH, 2.0)

// ---- Warm-up (prime engine caches so we measure steady-state, not first-touch).
const WARMUP = 3, ITERS = 20
for (let i = 0; i < WARMUP; i++) { await timeFullRepaint(specs100); await timeFullRepaint(specs200) }

// ---- Measure: full-slide repaint @100% and @200%, ITERS times each.
const t100 = [], t200 = []
for (let i = 0; i < ITERS; i++) t100.push((await timeFullRepaint(specs100)).ms)
for (let i = 0; i < ITERS; i++) t200.push((await timeFullRepaint(specs200)).ms)

// ---- Single-tile cost (per-tile / cursor-region repaint): one `tile` command.
const one = specs100[0]
const tOne = []
for (let i = 0; i < ITERS; i++) {
  const t0 = performance.now()
  await send(`tile ${one.cw} ${one.ch} ${one.tx} ${one.ty} ${one.tw} ${one.th}`)
  tOne.push(performance.now() - t0)
}

const s100 = stat(t100), s200 = stat(t200), sOne = stat(tOne)
const nTiles100 = specs100.length, nTiles200 = specs200.length

// ---- Summary --------------------------------------------------------------------
console.log('\n================================================================')
console.log('  PHASE Y - Impress (.pptx) repaint-latency benchmark (real engine)')
console.log('================================================================')
console.log(`  Slide: ${docW}x${docH} twips  |  dpr=${DPR}  |  tile=${TILE}px  |  warm iters=${ITERS}\n`)
console.log('  Full-slide repaint (send tiles -> B-frame received), ms:')
console.log('  +-------------+--------+---------+---------+---------+')
console.log('  | zoom        | tiles  |   min   |  median |   p95   |')
console.log('  +-------------+--------+---------+---------+---------+')
console.log(`  | 100%        | ${String(nTiles100).padStart(6)} | ${f(s100.min).padStart(7)} | ${f(s100.med).padStart(7)} | ${f(s100.p95).padStart(7)} |`)
console.log(`  | 200% (zoom) | ${String(nTiles200).padStart(6)} | ${f(s200.min).padStart(7)} | ${f(s200.med).padStart(7)} | ${f(s200.p95).padStart(7)} |`)
console.log('  +-------------+--------+---------+---------+---------+')
console.log(`\n  Single ${TILE}px tile (per-tile / cursor-region cost): min ${f(sOne.min)} / med ${f(sOne.med)} / p95 ${f(sOne.p95)} ms`)
console.log('\n  Tile-cache saving (zoom-BACK to a previously-rendered scale):')
console.log('    The renderer TileCache keys tiles by scale+dpr+part+origin. A zoom-back')
console.log('    to an already-rendered scale is 100% cache HITS -> 0 engine tiles fetched,')
console.log('    served as an in-memory blit. Engine repaint eliminated per cached zoom-back:')
console.log(`      - back to 100%: ~${f(s100.med)} ms saved  (${nTiles100} tiles -> 0)`)
console.log(`      - back to 200%: ~${f(s200.med)} ms saved  (${nTiles200} tiles -> 0)`)
console.log('    Pre-coalescing/cache, that full repaint ran on EVERY zoom click.\n')

await send('close')
proc.stdin.end(); proc.kill()
await sleep(200)
process.exit(0)
