// Engine sidecar smoke test, any platform: spawns wos-lok-host exactly as
// lokHost.ts does (JSON frames on fd 3, tiles on fd 4), opens each document and
// checks that a rendered tile carries ink. CSV goes through the Batch load option
// (host-profile.ts csvSilentLoad) with an explicit semicolon filter token.
//
//   node e2e/lok-host-smoke.mjs <host-bin> <install-dir> <bootstrap-ini> <doc>...
//
// Exit 0 when every document opens and renders; 1 otherwise.
import { spawn } from 'node:child_process'
import path from 'node:path'

const [HOST, INSTALL, FUND, ...RAW] = process.argv.slice(2)
const DOCS = RAW.map((d) => path.resolve(d))
if (!HOST || !INSTALL || !FUND || RAW.length === 0) {
  console.error('usage: lok-host-smoke.mjs <host-bin> <install-dir> <bootstrap-ini> <doc>...')
  process.exit(2)
}

const proc = spawn(HOST, [INSTALL, FUND], { stdio: ['pipe', 'ignore', 'pipe', 'pipe', 'pipe'] })
let stderr = ''
proc.stderr.on('data', (d) => { stderr += d })
proc.on('exit', (code) => { if (code) console.log(`[host exited ${code}] ${stderr.slice(-800)}`) })

const waiters = new Map()
let ready
const readyP = new Promise((r) => { ready = r })
const parser = (onFrame) => {
  let buf = Buffer.alloc(0)
  return (chunk) => {
    buf = Buffer.concat([buf, chunk])
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0)
      if (buf.length < 4 + len) break
      onFrame(String.fromCharCode(buf[4]), buf.subarray(5, 4 + len))
      buf = buf.subarray(4 + len)
    }
  }
}
proc.stdio[3].on('data', parser((type, body) => {
  if (type !== 'J') return
  let m
  try { m = JSON.parse(body) } catch { console.log(`FAIL unparseable frame: ${String(body).slice(0, 300)}`); process.exitCode = 1; return }
  if (m.event === 'ready') ready()
  else if (m.id != null && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id) }
}))
proc.stdio[4].on('data', parser((type, body) => {
  if (type !== 'T') return
  const id = body.readUInt32LE(0)
  const px = body.subarray(12)
  let ink = 0
  for (let i = 0; i < px.length; i += 4) if (px[i] < 200 || px[i + 1] < 200 || px[i + 2] < 200) ink++
  waiters.get(id)?.({ tile: true, ink })
  waiters.delete(id)
}))

let next = 1
const cmd = (line, ms = 60000) => {
  const id = next++
  const p = Promise.race([new Promise((r) => waiters.set(id, r)), new Promise((r) => setTimeout(() => r({ timeout: true }), ms))])
  proc.stdin.write(`${id} ${line}\n`)
  return p
}

let failed = 0
const t0 = Date.now()
const up = await Promise.race([readyP.then(() => true), new Promise((r) => setTimeout(() => r(false), 120000))])
if (!up) {
  console.log(`FAIL engine never reported ready (fd 3). stderr: ${stderr.slice(-800)}`)
  proc.kill()
  process.exit(1)
}
console.log(`ok   engine ready in ${Date.now() - t0} ms (fd 3 frames arrive)`)

for (const doc of DOCS) {
  const csv = /\.csv$/i.test(doc)
  const opened = await cmd(csv ? `openopts Batch=true,59,34,76,1,,1033,false,true\t${doc}` : `open ${doc}`)
  if (!opened.ok) { failed++; console.log(`FAIL open ${doc}: ${JSON.stringify(opened).slice(0, 300)}`); continue }
  const tile = await cmd(`tile 256 256 0 0 ${Math.min(opened.w, 12000)} ${Math.min(opened.h, 12000)}`)
  const inked = tile.tile && tile.ink > (csv ? 10 : 50)
  if (!inked) failed++
  console.log(`${inked ? 'ok  ' : 'FAIL'} ${doc}: type ${opened.type}, ${opened.parts} part(s), tile ink ${tile.ink ?? JSON.stringify(tile)} (fd 4 frames arrive)`)
}

proc.stdin.write(`${next++} close\n`)
setTimeout(() => { proc.kill(); process.exit(failed ? 1 : 0) }, 3000)
