// One-off: produce blank .pptx/.docx/.xlsx masters with the real engine, so the
// app can create new documents by COPYING a file instead of driving the engine.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
const ROOT = process.cwd()
const ENGINE = '/Volumes/LOBuild/core/instdir/LibreOffice.app/Contents'
const HOST = path.join(ROOT, 'scripts/lok/wos-lok-host')
const OUT = path.join(ROOT, 'resources/templates')
fs.rmSync('/tmp/wos-lok-host-profile', { recursive: true, force: true })
const proc = spawn(HOST, [ENGINE + '/Frameworks/', ENGINE + '/Resources/fundamentalrc'], { stdio: ['pipe', 'ignore', 'inherit', 'pipe', 'pipe'] })
let buf = Buffer.alloc(0); const waiters = new Map(); let ready = false, onReady = null
proc.stdio[3].on('data', (c) => {
  buf = Buffer.concat([buf, c])
  for (;;) { if (buf.length < 4) break; const len = buf.readUInt32LE(0); if (buf.length < 4 + len) break
    const type = String.fromCharCode(buf[4]); const body = buf.subarray(5, 4 + len); buf = buf.subarray(4 + len)
    if (type === 'J') { const m = JSON.parse(body.toString('utf8'))
      if (m.event === 'ready') { ready = true; onReady?.() } else if (m.id != null && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id) } } }
})
let id = 1
const send = (cmd) => new Promise((r) => { const i = id++; waiters.set(i, r); proc.stdin.write(`${i} ${cmd}\n`) })
await new Promise((r) => { if (ready) return r(); onReady = r })
for (const [factory, ext] of [['simpress', 'pptx'], ['swriter', 'docx'], ['scalc', 'xlsx']]) {
  const dest = path.join(OUT, `blank.${ext}`)
  fs.rmSync(dest, { force: true })
  const r = await send(`new ${factory} ${dest}`)
  await new Promise((r2) => setTimeout(r2, 600))
  console.log(`${ext}: ok=${r.ok} exists=${fs.existsSync(dest)} bytes=${fs.existsSync(dest) ? fs.statSync(dest).size : 0}`)
}
await send('close'); proc.stdin.end(); proc.kill()
