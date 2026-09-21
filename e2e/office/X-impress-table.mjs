// Phase X — Impress slide-TABLE structural editing, on a PLAIN (non-live) table,
// driven directly against the REAL LOK engine host (no renderer).
//
// WHY a host-level driver (not the Playwright renderer like audit/impress.mjs):
// the audit exercised WosSlideTableOp on a table inserted with a LIVE wos-range
// LINK, so every save RE-SYNCED the cells and could overwrite a structural edit —
// you could not tell a real macro bug from that re-sync artifact. This test
// inserts the table with NO rangeLink, so nothing re-stamps it on save, and drives
// the SAME Basic macros (WosInsertSlideTable / WosSlideTableOp / WosSlideTableCellFmt)
// the app runs — via the SAME wos-lok-host + SAME engine — just without the flaky
// Electron cold-boot. It is deterministic (a single fresh deck, few mutations) and
// isolates the table macros from all transclusion machinery.
//
// Flow: new simpress → seed the Wos macro library → WosInsertSlideTable (2×2, no
// link) → save+unzip slide1.xml → baseline <a:tr>=2 / <a:gridCol>=2 → WosSlideTableOp
// rowafter → rows must be 3 → colafter → cols must be 3 → WosSlideTableCellFmt
// fill|red → a solid cell fill (FF0000) must land.
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
const DOC = '/tmp/wos-x-impress-table.pptx'

if (!fs.existsSync(HOST) || !fs.existsSync(ENGINE + '/Resources/fundamentalrc')) { console.log('SKIP: engine/host missing'); process.exit(0) }

// ---- Bundle the Wos macro seeder from the TS source (esbuild is at repo root).
// lokMacros.ts is pure (only fs/path + validateBasicModule), so it bundles clean.
// A git worktree has no node_modules of its own — walk up to the nearest one.
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
const SEED_ENTRY = '/tmp/wos-x-seed-entry.mts'
const SEED_LIB = '/tmp/wos-x-seed-lib.mjs'
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
const rows = (x) => (x.match(/<a:tr\b/g) || []).length
const cols = (x) => (x.match(/<a:gridCol\b/g) || []).length
async function macro(name, args = '') { fs.writeFileSync('/tmp/wos-macro-generic.txt', args + '\n', 'utf8'); return send(`macro ${name} ${args}`) }
async function saveRead() { await send('save'); await sleep(500); return slide1() }

await ready()

// 1) Fresh presentation, then seed the Wos macro library (same order the app uses:
//    right after the engine is ready; runMacro lazy-loads Module1/Module2).
seedEngineProfile()
seedMacroLibrary()
ok((await send(`new simpress ${DOC}`)).ok, `new presentation created (${path.basename(DOC)})`)
await sleep(300)

// 2) Insert a PLAIN 2×2 table (NO rangeLink recorded → nothing re-syncs on save).
const TAG = 'wos-range-xtest'
fs.writeFileSync('/tmp/wos-table-in.txt', `${TAG}\nA1\tB1\nA2\tB2\n`, 'utf8')
ok((await send('macro WosInsertSlideTable')).ok, 'WosInsertSlideTable runMacro returned ok')
let x = await saveRead()
const r0 = rows(x), c0 = cols(x)
ok(/<a:tbl>/.test(x) && x.includes('A1'), `plain slide table present (a:tbl + A1)`)
ok(r0 === 2, `baseline: table has 2 rows (<a:tr>=${r0})`)
ok(c0 === 2, `baseline: table has 2 cols (<a:gridCol>=${c0})`)

// 3) WosSlideTableOp rowafter → the saved slide must gain a row (2 → 3).
await macro('WosSlideTableOp', 'rowafter'); await sleep(300)
x = await saveRead()
const r1 = rows(x)
ok(r1 === r0 + 1, `WosSlideTableOp rowafter added a row (<a:tr> ${r0}→${r1})`)

// 4) WosSlideTableOp colafter → the saved slide must gain a column (2 → 3).
await macro('WosSlideTableOp', 'colafter'); await sleep(300)
x = await saveRead()
const c1 = cols(x)
ok(c1 === c0 + 1, `WosSlideTableOp colafter added a column (<a:gridCol> ${c0}→${c1})`)

// 5) WosSlideTableCellFmt fill|red → a solid cell fill (FF0000) must land.
await macro('WosSlideTableCellFmt', 'fill|16711680'); await sleep(300) // 0xFF0000
x = await saveRead()
ok(/FF0000/i.test(x), `WosSlideTableCellFmt fill set a cell to 0xFF0000 (${/FF0000/i.test(x) ? 'present' : 'missing'})`)

// 6) The deck is still a valid, non-corrupt .pptx after the structural edits.
ok(validPptx(), 'final .pptx is a valid zip after the structural edits')

await send('close')
proc.stdin.end(); proc.kill()
await sleep(200)
console.log(`\nPHASE X — Impress plain-table structural edit: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
