// Phase AA — model-API shape MOVE (+ resize origin), driven directly against the
// REAL LOK engine host (no renderer).
//
// WHY this test exists: interactive shape dragging used to be driven by streaming
// mouse events at the engine. That floods the single thread (~20s freezes), and
// collapsing the drag into ONE synthetic move doesn't make the engine track it —
// the shape snapped back to where it started. The renderer now shows the drag with
// its overlay and commits the geometry through the model API on release
// (WosShapeSize + WosShapeMove). This proves that commit path MUTATES the file:
// a green runMacro ok:true says nothing, so every assertion here reads the SAVED
// .pptx and checks the shape's <a:off>/<a:ext> actually changed by the delta.
//
// Units: shape geometry is 1/100 mm in UNO and EMU in .pptx — exactly ×360.
//
// Flow: new simpress → seed macros → WosShapeInsert rect (selected, 7000×4500 at
// 5000,5000) → save, record baseline off/ext → WosShapeMove +1000|+500 → off must
// move by exactly that, ext unchanged → WosShapeSize 9000|6000 + WosShapeMove
// -500|-250 (an 'nw'-handle drag: grows AND moves the origin) → both must land →
// deck still a valid zip.
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
const DOC = '/tmp/wos-aa-shape-move.pptx'
const EMU = 360 // 1/100 mm → EMU

if (!fs.existsSync(HOST) || !fs.existsSync(ENGINE + '/Resources/fundamentalrc')) { console.log('SKIP: engine/host missing'); process.exit(0) }

// ---- Bundle the Wos macro seeder from the TS source (same approach as Phase X).
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
const SEED_ENTRY = '/tmp/wos-aa-seed-entry.mts'
const SEED_LIB = '/tmp/wos-aa-seed-lib.mjs'
fs.writeFileSync(SEED_ENTRY, `export { seedEngineProfile, seedMacroLibrary } from '${path.join(ROOT, 'src/main/office/lokMacros.ts')}'\n`)
execSync(`'${ESBUILD}' '${SEED_ENTRY}' --bundle --platform=node --format=esm --outfile='${SEED_LIB}'`, { stdio: 'ignore' })
const { seedEngineProfile, seedMacroLibrary } = await import(SEED_LIB)

// ---- Reporter -----------------------------------------------------------------
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m) } }

// ---- Host wire protocol (fd3=JSON, fd4=tiles) ---------------------------------
try { fs.rmSync(DOC, { force: true }) } catch { /* */ }
try { fs.rmSync('/tmp/wos-lok-host-profile', { recursive: true, force: true }) } catch { /* */ }
const proc = spawn(HOST, [ENGINE + '/Frameworks/', ENGINE + '/Resources/fundamentalrc'], { stdio: ['pipe', 'ignore', 'inherit', 'pipe', 'pipe'] })
let buf = Buffer.alloc(0)
const waiters = new Map()
let onReady = null
let readySeen = false
proc.stdio[3].on('data', (chunk) => {
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
    }
  }
})
let nextId = 1
const send = (cmd) => new Promise((res) => { const id = nextId++; waiters.set(id, res); proc.stdin.write(`${id} ${cmd}\n`) })
const ready = () => new Promise((res) => { if (readySeen) return res(); onReady = res })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const slide1 = () => { try { return execSync(`unzip -p '${DOC}' ppt/slides/slide1.xml`, { encoding: 'utf8' }) } catch { return '' } }
const validPptx = () => { try { execSync(`unzip -t '${DOC}'`, { stdio: 'ignore' }); return true } catch { return false } }
async function macro(name, args = '') { fs.writeFileSync('/tmp/wos-macro-generic.txt', args + '\n', 'utf8'); return send(`macro ${name} ${args}`) }
async function saveRead() { await send('save'); await sleep(500); return slide1() }

// Every <a:xfrm> placement on the slide, in document order. `<a:ext uri=…>` inside
// extension lists is skipped by requiring cx/cy.
function placements(xml) {
  const out = []
  const re = /<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/g
  let m
  while ((m = re.exec(xml)) !== null) out.push({ x: +m[1], y: +m[2], cx: +m[3], cy: +m[4] })
  return out
}
// Our shape is the one with this exact size — placeholders on a blank slide never
// share it, and a move leaves the size untouched.
const byExt = (xml, cx, cy) => placements(xml).find((p) => p.cx === cx && p.cy === cy)

await ready()

// 1) Fresh presentation + seeded macro library (same order the app uses).
seedEngineProfile()
seedMacroLibrary()
ok((await send(`new simpress ${DOC}`)).ok, `new presentation created (${path.basename(DOC)})`)
await sleep(300)

// 2) Insert a rectangle. WosShapeInsert leaves it SELECTED — which is what the
//    geometry macros act on (CurrentController.Selection).
ok((await macro('WosShapeInsert', 'rect')).ok, 'WosShapeInsert runMacro returned ok')
await sleep(300)
let x = await saveRead()
const base = byExt(x, 7000 * EMU, 4500 * EMU)
ok(!!base, `inserted rect present in the saved deck (7000×4500 → ext ${7000 * EMU}×${4500 * EMU})`)
if (!base) { console.log('\nPHASE AA — cannot continue without the baseline shape'); process.exit(1) }
console.log(`    baseline off = (${base.x}, ${base.y})`)

// 3) THE MOVE. A drag of +1000|+500 (1/100 mm) must shift <a:off> by exactly that
//    — this is the assertion the whole interaction rework rests on.
const DX = 1000, DY = 500
await macro('WosShapeMove', `${DX}|${DY}`); await sleep(300)
x = await saveRead()
const moved = byExt(x, 7000 * EMU, 4500 * EMU)
ok(!!moved, 'shape still present after WosShapeMove (size untouched)')
ok(moved && moved.x === base.x + DX * EMU,
  `WosShapeMove shifted X by ${DX}/100mm (${base.x} → ${moved ? moved.x : '?'}, expected ${base.x + DX * EMU})`)
ok(moved && moved.y === base.y + DY * EMU,
  `WosShapeMove shifted Y by ${DY}/100mm (${base.y} → ${moved ? moved.y : '?'}, expected ${base.y + DY * EMU})`)

// 4) An 'nw'-handle resize = new size + an origin shift. Both macros run back to
//    back exactly as commitShapeGeometry() issues them, and both must land.
const NW = 500, NH = 250
await macro('WosShapeSize', `${9000}|${6000}`); await sleep(300)
await macro('WosShapeMove', `${-NW}|${-NH}`); await sleep(300)
x = await saveRead()
const resized = byExt(x, 9000 * EMU, 6000 * EMU)
ok(!!resized, `WosShapeSize resized the shape (ext → ${9000 * EMU}×${6000 * EMU})`)
ok(resized && resized.x === moved.x - NW * EMU,
  `origin shifted back by ${NW}/100mm with the resize (X ${moved ? moved.x : '?'} → ${resized ? resized.x : '?'})`)
ok(resized && resized.y === moved.y - NH * EMU,
  `origin shifted back by ${NH}/100mm with the resize (Y ${moved ? moved.y : '?'} → ${resized ? resized.y : '?'})`)

// 5) A zero delta must be a no-op, not a corruption (the renderer skips it, but the
//    macro guards it too).
await macro('WosShapeMove', '0|0'); await sleep(200)
x = await saveRead()
const after0 = byExt(x, 9000 * EMU, 6000 * EMU)
ok(after0 && resized && after0.x === resized.x && after0.y === resized.y, 'WosShapeMove 0|0 left the shape exactly where it was')

// 6) The deck is still a valid, non-corrupt .pptx after the geometry edits.
ok(validPptx(), 'final .pptx is a valid zip after the geometry edits')

await send('close')
proc.stdin.end(); proc.kill()
await sleep(200)
console.log(`\nPHASE AA — model-API shape move/resize: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
