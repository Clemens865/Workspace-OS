// Validates the wos-lok-host IPC protocol end-to-end (Phase 3a M1).
// Spawns the sidecar, drives ping/open/size/tile, verifies framed responses
// and that a rendered tile is document-like (mostly white + some ink).
import { spawn } from 'node:child_process'
import path from 'node:path'

const ENGINE = '/Volumes/LOBuild/core/instdir/LibreOffice.app/Contents'
const INSTALL = ENGINE + '/Frameworks/'
const FUND = ENGINE + '/Resources/fundamentalrc'
const DOC = '/tmp/wos-test/test-document.docx'
const HOST = path.resolve(import.meta.dirname, 'wos-lok-host')

const proc = spawn(HOST, [INSTALL, FUND], { stdio: ['pipe', 'pipe', 'inherit'] })

// ---- frame parser: [uint32 LE len][type][body] ----
let buf = Buffer.alloc(0)
const waiters = new Map() // id -> resolve
let onEvent = null
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
      const msg = JSON.parse(body.toString('utf8'))
      if (msg.event && onEvent) onEvent(msg)
      else if (msg.id != null && waiters.has(msg.id)) { waiters.get(msg.id)(msg); waiters.delete(msg.id) }
    } else if (type === 'T') {
      const id = body.readUInt32LE(0), cw = body.readUInt32LE(4), ch = body.readUInt32LE(8)
      const bgra = body.subarray(12)
      if (waiters.has(id)) { waiters.get(id)({ tile: true, cw, ch, bgra }); waiters.delete(id) }
    }
  }
})

let nextId = 1
function send(cmd) {
  const id = nextId++
  const p = new Promise((res) => waiters.set(id, res))
  proc.stdin.write(`${id} ${cmd}\n`)
  return p
}
function ready() { return new Promise((res) => { onEvent = (m) => m.event === 'ready' && res(m) }) }

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m) } }

await ready()
console.log('host ready')

const pong = await send('ping')
ok(pong.ok && pong.pong, 'ping → pong')

const opened = await send(`open ${DOC}`)
ok(opened.ok === true, `open → ok (type=${opened.type}, parts=${opened.parts})`)
ok(opened.w > 0 && opened.h > 0, `doc size ${opened.w}x${opened.h} twips`)

const sz = await send('size')
ok(sz.ok && sz.w === opened.w, 'size matches open')

// canonical 256x256 tile of the top-left (3840x3840 twips)
const t = await send('tile 256 256 0 0 3840 3840')
ok(t.tile && t.cw === 256 && t.ch === 256, 'tile → 256x256 frame')
ok(t.bgra.length === 256 * 256 * 4, `tile payload ${t.bgra.length} bytes`)
let white = 0, ink = 0
for (let i = 0; i < t.bgra.length; i += 4) {
  const b = t.bgra[i], g = t.bgra[i + 1], r = t.bgra[i + 2]
  if (b > 240 && g > 240 && r > 240) white++
  if (b < 80 && g < 80 && r < 80) ink++
}
const px = 256 * 256
ok(white > px * 0.5 && ink > 0, `tile is document-like (white ${Math.round(100*white/px)}%, ink ${Math.round(100*ink/px)}%)`)

const closed = await send('close')
ok(closed.ok === true, 'close → ok')

console.log(`\nM1 HOST PROTOCOL: ${pass} passed, ${fail} failed`)
proc.stdin.end()
proc.kill()
process.exit(fail === 0 ? 0 : 1)
