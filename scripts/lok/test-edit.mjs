// Validates editing through the sidecar (Phase 3a M3): place cursor, type text,
// apply bold, save — then confirm the typed text persisted into the .docx.
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ENGINE = '/Volumes/LOBuild/core/instdir/LibreOffice.app/Contents'
const HOST = path.resolve(import.meta.dirname, 'wos-lok-host')
const SRC = '/tmp/wos-test/test-document.docx'
const DOC = '/tmp/wos-edit-test.docx'
fs.copyFileSync(SRC, DOC) // edit a throwaway copy

const proc = spawn(HOST, [INSTALL(), FUND()], { stdio: ['pipe', 'pipe', 'inherit'] })
function INSTALL() { return ENGINE + '/Frameworks/' }
function FUND() { return ENGINE + '/Resources/fundamentalrc' }

let buf = Buffer.alloc(0)
const waiters = new Map()
let onReady = null
proc.stdout.on('data', (chunk) => {
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
      if (m.event === 'ready' && onReady) onReady()
      else if (m.id != null && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id) }
    } else if (type === 'T') {
      const id = body.readUInt32LE(0)
      if (waiters.has(id)) { waiters.get(id)({ tile: true }); waiters.delete(id) }
    }
  }
})
let nextId = 1
const send = (cmd) => new Promise((res) => { const id = nextId++; waiters.set(id, res); proc.stdin.write(`${id} ${cmd}\n`) })
const ready = () => new Promise((res) => { onReady = res })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m) } }

await ready()
ok((await send(`open ${DOC}`)).ok, 'open editable copy')

// Place cursor in the body: mouse down+up at (2200, 3200) twips.
await send('mouse 0 2200 3200 1 1 0')
await send('mouse 1 2200 3200 1 1 0')

// Type a marker string (KEYINPUT then KEYUP per char).
const MARK = 'WOSEDIT'
for (const ch of MARK) {
  await send(`key 0 ${ch.charCodeAt(0)} 0`)
  await send(`key 1 ${ch.charCodeAt(0)} 0`)
}
ok(true, `typed "${MARK}" via postKeyEvent`)

// Apply bold (UNO command) — should not error.
ok((await send('uno .uno:Bold')).ok, 'uno .uno:Bold accepted')

const saved = await send('save')
ok(saved.ok, 'save → ok')
await sleep(400)
await send('close')
proc.stdin.end(); proc.kill()
await sleep(200)

// Confirm the typed text persisted into the docx (unzip document.xml).
let xml = ''
try { xml = execSync(`unzip -p ${DOC} word/document.xml`, { encoding: 'utf8' }) } catch { /* */ }
ok(xml.includes(MARK), `typed text persisted into .docx (found "${MARK}")`)

console.log(`\nM3 EDIT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
