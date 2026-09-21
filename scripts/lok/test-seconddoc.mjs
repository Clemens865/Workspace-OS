// Regression probe: opening a SECOND document while another is resident must
// report a real size (w/h > 0), and switching BACK to the first (cache hit)
// must still report a real size and paint a valid tile.
// Usage: node test-seconddoc.mjs [host-binary]
import { spawn } from 'node:child_process'

const ENGINE = '/Volumes/LOBuild/core/instdir/LibreOffice.app/Contents'
const HOST = process.argv[2] || new URL('./wos-lok-host', import.meta.url).pathname
const DOC_A = '/tmp/wos-test/New Presentation 2.pptx'
const DOC_B = '/tmp/wos-test/bg.pptx'

const proc = spawn(HOST, [ENGINE + '/Frameworks/', ENGINE + '/Resources/fundamentalrc'], {
  stdio: ['pipe', 'ignore', 'inherit', 'pipe', 'pipe'],
})

const waiters = new Map()
let onEvent = null

function makeParser() {
  let chunks = [], buffered = 0
  return (chunk) => {
    chunks.push(chunk); buffered += chunk.length
    for (;;) {
      if (buffered < 4) break
      if (chunks[0].length < 4) chunks = [Buffer.concat(chunks)]
      const len = chunks[0].readUInt32LE(0)
      if (buffered < 4 + len) break
      const frame = Buffer.allocUnsafe(4 + len)
      let filled = 0
      while (filled < frame.length) {
        const c = chunks[0]
        const take = Math.min(c.length, frame.length - filled)
        c.copy(frame, filled, 0, take)
        filled += take
        if (take === c.length) chunks.shift()
        else chunks[0] = c.subarray(take)
      }
      buffered -= frame.length
      const type = String.fromCharCode(frame[4])
      const body = frame.subarray(5)
      if (type === 'J') {
        const msg = JSON.parse(body.toString('utf8'))
        if (msg.event && onEvent) onEvent(msg)
        else if (msg.id != null && waiters.has(msg.id)) { waiters.get(msg.id)(msg); waiters.delete(msg.id) }
      } else if (type === 'T') {
        const id = body.readUInt32LE(0), cw = body.readUInt32LE(4), ch = body.readUInt32LE(8)
        if (waiters.has(id)) { waiters.get(id)({ tile: true, cw, ch, bgra: Buffer.from(body.subarray(12)) }); waiters.delete(id) }
      }
    }
  }
}
proc.stdio[3].on('data', makeParser())
proc.stdio[4].on('data', makeParser())

let nextId = 1
function send(cmd) {
  const id = nextId++
  const p = new Promise((res, rej) => {
    waiters.set(id, res)
    setTimeout(() => rej(new Error(`timeout: ${cmd}`)), 30000)
  })
  proc.stdin.write(`${id} ${cmd}\n`)
  return p
}

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m) } }

await new Promise((res) => { onEvent = (m) => m.event === 'ready' && res() })
console.log('host ready')

// 1. open docA
const a1 = await send(`open ${DOC_A}`)
ok(a1.ok === true && a1.w > 0 && a1.h > 0, `open docA → ${a1.w}x${a1.h}`)
const tA1 = await send('tile 256 256 0 0 3840 3840')
ok(tA1.tile && tA1.cw === 256, 'docA tile renders')

// 2. open docB WHILE docA is resident — the regression: w/h were 0
const b1 = await send(`open ${DOC_B}`)
ok(b1.ok === true, `open docB → ok:${b1.ok}`)
ok(b1.w > 0 && b1.h > 0, `open docB while docA resident → real size (${b1.w}x${b1.h})`)
const sB = await send('size')
ok(sB.ok && sB.w > 0 && sB.h > 0, `docB size query → ${sB.w}x${sB.h}`)
const tB = await send('tile 256 256 0 0 3840 3840')
ok(tB.tile && tB.cw === 256, 'docB tile renders')

// 3. switch BACK to docA (cache hit) — must still report real size + valid tile
const a2 = await send(`open ${DOC_A}`)
ok(a2.ok === true && a2.w > 0 && a2.h > 0, `re-open docA (cache hit) → real size (${a2.w}x${a2.h})`)
const tA2 = await send('tile 256 256 0 0 3840 3840')
ok(tA2.tile && tA2.cw === 256, 'docA tile after switch-back renders')
ok(tA2.bgra.equals(tA1.bgra), 'docA tile after switch-back pixel-identical to first paint')

// 4. and forward again to docB (cache hit)
const b2 = await send(`open ${DOC_B}`)
ok(b2.ok === true && b2.w > 0 && b2.h > 0, `re-open docB (cache hit) → real size (${b2.w}x${b2.h})`)

// 5. third doc for good measure
const c1 = await send(`open /tmp/wos-test/vdeck.pptx`)
ok(c1.ok === true && c1.w > 0 && c1.h > 0, `open docC as third resident → real size (${c1.w}x${c1.h})`)

await send('close')
console.log(`\nSECOND-DOC PROBE: ${pass} passed, ${fail} failed`)
proc.stdin.end()
proc.kill()
process.exit(fail === 0 ? 0 : 1)
