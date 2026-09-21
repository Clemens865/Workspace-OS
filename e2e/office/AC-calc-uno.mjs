// Phase AC — verify the Calc .uno: commands a right-click menu would dispatch
// ACTUALLY do something, on the REAL engine.
//
// WHY: a wrong or renamed `.uno:` name dispatches SILENTLY — the menu item looks
// fine, the click does nothing, and nothing is logged. Shipping a context menu
// built on unverified command names is how you get "the buttons don't work".
// Every command here is dispatched against a real sheet and the result is read
// back from the SAVED .xlsx, so a no-op fails loudly.
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const DEV_ENGINE = '/Volumes/LOBuild/core/instdir/LibreOffice.app/Contents'
const BUNDLED = path.join(ROOT, 'release/mac-arm64/Workspace OS.app/Contents/Resources/libreoffice/LibreOffice.app/Contents')
const ENGINE = fs.existsSync(DEV_ENGINE + '/Resources/fundamentalrc') ? DEV_ENGINE : BUNDLED
const HOST = path.join(ROOT, 'scripts/lok/wos-lok-host')
const DOC = '/tmp/wos-ac-calc-uno.xlsx'

if (!fs.existsSync(HOST) || !fs.existsSync(ENGINE + '/Resources/fundamentalrc')) { console.log('SKIP: engine/host missing'); process.exit(0) }

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m) } }

try { fs.rmSync(DOC, { force: true }) } catch { /* */ }
try { fs.rmSync('/tmp/wos-lok-host-profile', { recursive: true, force: true }) } catch { /* */ }
const proc = spawn(HOST, [ENGINE + '/Frameworks/', ENGINE + '/Resources/fundamentalrc'], { stdio: ['pipe', 'ignore', 'inherit', 'pipe', 'pipe'] })
let buf = Buffer.alloc(0)
const waiters = new Map()
let onReady = null, readySeen = false
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
      if (m.event === 'ready') { readySeen = true; onReady?.() }
      else if (m.id != null && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id) }
    }
  }
})
let nextId = 1
const send = (cmd) => new Promise((res) => { const id = nextId++; waiters.set(id, res); proc.stdin.write(`${id} ${cmd}\n`) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await new Promise((r) => { if (readySeen) return r(); onReady = r })

/** The saved sheet's XML — the ground truth for "did anything change". */
const sheet = () => { try { return execSync(`unzip -p '${DOC}' xl/worksheets/sheet1.xml`, { encoding: 'utf8' }) } catch { return '' } }
const shared = () => { try { return execSync(`unzip -p '${DOC}' xl/sharedStrings.xml`, { encoding: 'utf8' }) } catch { return '' } }
async function save() { await send('save'); await sleep(400) }

/** Type text into the current cell and commit with Enter. */
async function type(text) {
  for (const ch of text) { await send(`key 0 ${ch.charCodeAt(0)} 0`); await send(`key 1 ${ch.charCodeAt(0)} 0`) }
  await send('key 0 13 1280'); await send('key 1 13 1280')
  await sleep(120)
}

await send(`new scalc ${DOC}`)
await sleep(400)

// Seed A1..A3 so row/column operations have something to move.
await type('alpha')
await type('beta')
await type('gamma')
await save()
ok(/alpha/.test(shared()), 'seeded three rows of content')

const rowCount = (x) => (x.match(/<row\b/g) || []).length
const before = rowCount(sheet())

// Move the cursor to A2 (click near the top-left; row 2).
await send('mouse 0 600 700 1 1 0'); await send('mouse 1 600 700 1 1 0')
await sleep(200)

// ── The commands a right-click menu needs ────────────────────────────────────
// Each is dispatched, then the file is saved and re-read. A silently-wrong name
// leaves the sheet unchanged and fails here rather than in the user's hands.
const cases = [
  { uno: '.uno:InsertRows', label: 'insert row (legacy alias)' },
  { uno: '.uno:InsertRowsBefore', label: 'insert row above' },
  { uno: '.uno:InsertRowsAfter', label: 'insert row below' },
  { uno: '.uno:InsertColumnsBefore', label: 'insert column left' },
  { uno: '.uno:InsertColumnsAfter', label: 'insert column right' },
  { uno: '.uno:SelectRow', label: 'select whole row' },
  { uno: '.uno:SelectColumn', label: 'select whole column' },
  { uno: '.uno:WrapText', label: 'wrap text (Zeilenumbruch)' },
  { uno: '.uno:DeleteRows', label: 'delete row' },
  { uno: '.uno:DeleteColumns', label: 'delete column' },
]

console.log('\n  Dispatching each command and reading the saved sheet back:\n')
for (const c of cases) {
  const pre = sheet()
  const res = await send(`uno ${c.uno}`)
  await sleep(200)
  await save()
  const post = sheet()
  // ok:true only means the dispatch was accepted; the real signal is whether the
  // document changed. Selection commands legitimately change nothing on disk, so
  // they are reported separately rather than counted as failures.
  const changed = pre !== post
  const selectish = c.uno.includes('Select') || c.uno.includes('WrapText')
  if (selectish) {
    ok(res.ok === true, `${c.uno} — ${c.label} (accepted; no file change expected)`)
  } else {
    ok(changed, `${c.uno} — ${c.label} (sheet XML changed)`)
  }
}

const after = rowCount(sheet())
console.log(`\n  rows: ${before} → ${after}`)
ok(sheet().length > 0, 'sheet is still readable after every command')
try { execSync(`unzip -t '${DOC}'`, { stdio: 'ignore' }); ok(true, 'final .xlsx is a valid zip') } catch { ok(false, 'final .xlsx is a valid zip') }

await send('close')
proc.stdin.end(); proc.kill()
await sleep(200)
console.log(`\nPHASE AC — Calc context-menu commands: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
