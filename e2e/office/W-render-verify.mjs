// Phase W — Impress (.pptx) RENDER-VERIFICATION, on the REAL LOK engine.
//
// WHY this exists: the macro audit (X/Y phases) only proves the DOC MUTATES —
// it never proves a single PIXEL reaches the screen. A rendering-perf change
// once broke the initial .pptx render ("stuck on Rendering…") and NOTHING in the
// suite caught it, because a blank/stuck slide still has a correct document
// model. This test closes that gap: it seeds VISIBLE content, asks the engine
// to paint the FULL slide (the exact tile grid useLokPaint.paint() fetches),
// assembles the BGRA tiles into one image, and ASSERTS the render is REAL —
// high channel variance + a meaningful count of NON-white (colored) pixels.
// A blank/stuck slide = near-constant white pixels → this test FAILS loudly.
//
// It reuses Y-impress-perf's PROVEN host driver verbatim: spawn wos-lok-host
// (fd3=JSON 'J', fd4=tiles 'T'/'B'), seed the engine profile + Wos macro
// library, `new simpress`. It never touches product code — it only replays the
// on-wire `tiles` command the renderer builds, then READS the returned pixels.
//
// Also writes the assembled image to the Desktop as a hand-rolled PNG so the
// non-blank render is human-verifiable. Deterministic; skips if engine missing.
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const DEV_ENGINE = '/Volumes/LOBuild/core/instdir/LibreOffice.app/Contents'
const BUNDLED_ENGINE = path.join(ROOT, 'release/mac-arm64/Workspace OS.app/Contents/Resources/libreoffice/LibreOffice.app/Contents')
const ENGINE = fs.existsSync(DEV_ENGINE + '/Resources/fundamentalrc') ? DEV_ENGINE : BUNDLED_ENGINE
const HOST = path.join(ROOT, 'scripts/lok/wos-lok-host')
const DOC = '/tmp/wos-w-render-verify.pptx'
const PNG_OUT = process.env.WOS_RENDER_VERIFY_PNG || path.join(os.tmpdir(), 'WorkspaceOS-Render-Verify.png')

if (!fs.existsSync(HOST) || !fs.existsSync(ENGINE + '/Resources/fundamentalrc')) { console.log('SKIP: engine/host missing'); process.exit(0) }

// ---- Canvas geometry — mirrored from lokCanvasUtils.ts / useLokPaint.paint().
const DPI = 96
const TWIPS_PER_INCH = 1440
const TILE = 512
const DPR = 1 // verify at 100% CSS-px (device=CSS×1) — the initial-render case.

// ---- Bundle the Wos macro seeder from TS (same approach as X/Y). ---------------
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
const SEED_ENTRY = '/tmp/wos-w-seed-entry.mts'
const SEED_LIB = '/tmp/wos-w-seed-lib.mjs'
fs.writeFileSync(SEED_ENTRY, `export { seedEngineProfile, seedMacroLibrary } from '${path.join(ROOT, 'src/main/office/lokMacros.ts')}'\n`)
execSync(`'${ESBUILD}' '${SEED_ENTRY}' --bundle --platform=node --format=esm --outfile='${SEED_LIB}'`, { stdio: 'ignore' })
const { seedEngineProfile, seedMacroLibrary } = await import(SEED_LIB)

// ---- Host wire protocol (fd3=JSON 'J', fd4=tiles 'T'/'B') ----------------------
// Frame = [uint32 LE len][1 byte type][body].
//   'T' body = [u32 id][u32 cw][u32 ch][BGRA cw*ch*4]
//   'B' body = [u32 id][u32 n] then n × ([u32 cw][u32 ch][BGRA cw*ch*4])
// UNLIKE Y-perf (which only COUNTS tiles) we KEEP the pixel bytes so we can
// assemble and inspect them — the whole point of this phase.
try { fs.rmSync(DOC, { force: true }) } catch { /* */ }
try { fs.rmSync('/tmp/wos-lok-host-profile', { recursive: true, force: true }) } catch { /* */ }
const proc = spawn(HOST, [ENGINE + '/Frameworks/', ENGINE + '/Resources/fundamentalrc'], { stdio: ['pipe', 'ignore', 'inherit', 'pipe', 'pipe'] })
const waiters = new Map()
let onReady = null, readySeen = false

function makeParser() {
  let buf = Buffer.alloc(0)
  return (chunk) => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      if (buf.length < 4) break
      const len = buf.readUInt32LE(0)
      if (buf.length < 4 + len) break
      const type = String.fromCharCode(buf[4])
      const body = Buffer.from(buf.subarray(5, 4 + len)) // COPY out before we advance
      buf = buf.subarray(4 + len)
      if (type === 'J') {
        const m = JSON.parse(body.toString('utf8'))
        if (m.event === 'ready') { readySeen = true; if (onReady) onReady() }
        else if (m.id != null && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id) }
      } else if (type === 'T') {
        const id = body.readUInt32LE(0)
        const cw = body.readUInt32LE(4), ch = body.readUInt32LE(8)
        const pixels = body.subarray(12, 12 + cw * ch * 4)
        if (waiters.has(id)) { waiters.get(id)({ id, tiles: [{ cw, ch, pixels }] }); waiters.delete(id) }
      } else if (type === 'B') {
        const id = body.readUInt32LE(0)
        const n = body.readUInt32LE(4)
        const tiles = []
        let off = 8
        for (let i = 0; i < n; i++) {
          const cw = body.readUInt32LE(off), ch = body.readUInt32LE(off + 4)
          off += 8
          tiles.push({ cw, ch, pixels: body.subarray(off, off + cw * ch * 4) })
          off += cw * ch * 4
        }
        if (waiters.has(id)) { waiters.get(id)({ id, tiles }); waiters.delete(id) }
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
async function macro(name, args = '') { fs.writeFileSync('/tmp/wos-macro-generic.txt', args + '\n', 'utf8'); return send(`macro ${name}`) }

// Build the exact tile-grid spec a full repaint fetches (useLokPaint.paint math).
// Each spec's row stride in the returned buffer is cw*4 bytes (per host paintTile).
function fullSlideSpecs(docW, docH, zoom) {
  const devPerTwip = ((DPI * zoom) / TWIPS_PER_INCH) * DPR
  const devW = Math.max(1, Math.round(docW * devPerTwip))
  const devH = Math.max(1, Math.round(docH * devPerTwip))
  const specs = []
  for (let oy = 0; oy < devH; oy += TILE) {
    for (let ox = 0; ox < devW; ox += TILE) {
      const cw = Math.min(TILE, devW - ox)
      const ch = Math.min(TILE, devH - oy)
      specs.push({ cw, ch, ox, oy, tx: Math.round(ox / devPerTwip), ty: Math.round(oy / devPerTwip), tw: Math.round(cw / devPerTwip), th: Math.round(ch / devPerTwip) })
    }
  }
  return { specs, devW, devH }
}
const tilesCmd = (specs) => `tiles ${specs.length} ${specs.map((s) => `${s.cw} ${s.ch} ${s.tx} ${s.ty} ${s.tw} ${s.th}`).join(' ')}`

await ready()

// ---- Boot: seed profile + macros, fresh deck, add VISIBLE content. -------------
seedEngineProfile()
seedMacroLibrary()
await send(`new simpress ${DOC}`)
await sleep(300)

// A red rectangle carrying the text "RENDER OK" ...
await macro('WosShapeInsert', 'rect|16711680')      // rect, fill RGB(255,0,0) red
await sleep(150)
await macro('WosShapeColor', 'fill|16711680')       // enforce red fill on selection
await sleep(150)
await macro('WosShapeText', 'settext|RENDER OK')
await sleep(150)
// ... plus a SECOND shape in a different color (green) so the slide is clearly
// non-trivial: multiple hues → high among-channel range, not one flat block.
await macro('WosShapeInsert', 'ellipse|65280')      // ellipse, fill RGB(0,255,0) green
await sleep(150)
await macro('WosShapeColor', 'fill|65280')
await sleep(300)

const sz = await send('size')
const docW = Number(sz.w), docH = Number(sz.h)
const { specs, devW, devH } = fullSlideSpecs(docW, docH, 1.0)

// ---- Render the full slide at 100% (the initial-render tile grid). -------------
await send(tilesCmd(specs)) // warm the engine
const resp = await send(tilesCmd(specs))
const tiles = resp.tiles
if (tiles.length !== specs.length) { console.log(`FAIL: expected ${specs.length} tiles, got ${tiles.length}`); proc.kill(); process.exit(1) }

// ---- Assemble tiles → one RGBA image (BGRA→RGBA), row stride = cw*4. -----------
const img = Buffer.alloc(devW * devH * 4)
for (let t = 0; t < tiles.length; t++) {
  const s = specs[t], tile = tiles[t]
  const cw = tile.cw, ch = tile.ch, src = tile.pixels
  for (let y = 0; y < ch; y++) {
    for (let xx = 0; xx < cw; xx++) {
      const si = (y * cw + xx) * 4                       // BGRA source
      const di = ((s.oy + y) * devW + (s.ox + xx)) * 4   // RGBA dest
      img[di] = src[si + 2]      // R <- B
      img[di + 1] = src[si + 1]  // G
      img[di + 2] = src[si]      // B <- R
      img[di + 3] = 0xFF         // opaque
    }
  }
}

// ---- ASSERT the render is REAL, not blank/stuck. -------------------------------
// Blank/white slide: every pixel ≈ (255,255,255) → per-channel min≈max, range≈0,
// non-white count ≈ 0. Real render: the red rect + green ellipse push variance
// up and produce a large block of non-white pixels.
let rMin = 255, gMin = 255, bMin = 255, rMax = 0, gMax = 0, bMax = 0
let rSum = 0, gSum = 0, bSum = 0, nonWhite = 0
const NPX = devW * devH
for (let i = 0; i < NPX; i++) {
  const r = img[i * 4], g = img[i * 4 + 1], b = img[i * 4 + 2]
  if (r < rMin) rMin = r; if (r > rMax) rMax = r
  if (g < gMin) gMin = g; if (g > gMax) gMax = g
  if (b < bMin) bMin = b; if (b > bMax) bMax = b
  rSum += r; gSum += g; bSum += b
  if (r < 250 || g < 250 || b < 250) nonWhite++ // not "white-ish"
}
const rMean = rSum / NPX, gMean = gSum / NPX, bMean = bSum / NPX
const maxRange = Math.max(rMax - rMin, gMax - gMin, bMax - bMin)
const nonWhitePct = (nonWhite / NPX) * 100

const VARIANCE_OK = maxRange > 64          // a real hue swing across the slide
const NONWHITE_OK = nonWhitePct > 0.5       // > 0.5% colored pixels (the shapes)
const PASS = VARIANCE_OK && NONWHITE_OK

// ---- Encode the assembled image as a hand-rolled PNG (zlib). -------------------
function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1))
  }
  return (~c) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const tb = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0)
  return Buffer.concat([len, tb, data, crc])
}
const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(devW, 0); ihdr.writeUInt32BE(devH, 4)
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0 // 8-bit RGBA
// Filter-0 (None) scanlines: one leading 0x00 byte per row.
const raw = Buffer.alloc(devH * (1 + devW * 4))
for (let y = 0; y < devH; y++) {
  raw[y * (1 + devW * 4)] = 0
  img.copy(raw, y * (1 + devW * 4) + 1, y * devW * 4, (y + 1) * devW * 4)
}
const idat = zlib.deflateSync(raw)
const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
fs.writeFileSync(PNG_OUT, png)

// ---- Summary -------------------------------------------------------------------
console.log('\n================================================================')
console.log('  PHASE W - Impress (.pptx) RENDER-VERIFICATION (real engine)')
console.log('================================================================')
console.log(`  Slide: ${docW}x${docH} twips -> assembled ${devW}x${devH} px  (${specs.length} tiles, ${TILE}px, dpr=${DPR})`)
console.log('\n  Pixel stats across the assembled render:')
console.log(`    R  min/max/mean : ${rMin}/${rMax}/${rMean.toFixed(1)}`)
console.log(`    G  min/max/mean : ${gMin}/${gMax}/${gMean.toFixed(1)}`)
console.log(`    B  min/max/mean : ${bMin}/${bMax}/${bMean.toFixed(1)}`)
console.log(`    max among-channel range : ${maxRange}   (blank≈0)`)
console.log(`    non-white pixels        : ${nonWhite} / ${NPX}  = ${nonWhitePct.toFixed(3)}%`)
console.log('\n  Assertions (a BLANK/STUCK slide fails these):')
console.log(`    variance high (maxRange > 64) : ${VARIANCE_OK ? 'PASS' : 'FAIL'}  (${maxRange})`)
console.log(`    non-white > 0.5%              : ${NONWHITE_OK ? 'PASS' : 'FAIL'}  (${nonWhitePct.toFixed(3)}%)`)
console.log(`\n  PNG written: ${PNG_OUT}  (${devW}x${devH})`)
console.log(`\n  RESULT: ${PASS ? 'PASS - slide rendered REAL pixels (non-blank)' : 'FAIL - slide is BLANK/STUCK (regression!)'}`)
console.log('================================================================\n')

await send('close')
proc.stdin.end(); proc.kill()
await sleep(200)
process.exit(PASS ? 0 : 1)
