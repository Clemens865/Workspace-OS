// Engine sidecar smoke test, any platform: spawns wos-lok-host exactly as
// lokHost.ts does (JSON frames on fd 3, tiles on fd 4), opens each document and
// checks that a rendered tile carries ink. CSV goes through the Batch load option
// (host-profile.ts csvSilentLoad) with an explicit semicolon filter token.
//
//   node e2e/lok-host-smoke.mjs <host-bin> <install-dir> <bootstrap-ini> <doc>...
//
// Exit 0 when every document opens and renders; 1 otherwise.
// WOS_SMOKE_BATCH_ALL=1 opens every document with LOK's Batch option (no dialogs);
// WOS_SMOKE_TIMEOUT_MS sets the per-command timeout (default 60000).
// WOS_SMOKE_DUMP_DIR writes each rendered tile there as a .ppm image.
// WOS_SMOKE_PROBES=1 also renders spreadsheets at several scales and after setpart 0,
// and reports each tile's alpha values (diagnostics; does not change pass/fail).
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const [HOST, INSTALL, FUND, ...RAW] = process.argv.slice(2)
// `new:<swriter|scalc|simpress>:<path>` creates a blank document instead of opening one.
const DOCS = RAW.map((d) => (d.startsWith('new:') ? d : path.resolve(d)))
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
  const dump = process.env.WOS_SMOKE_DUMP_DIR
  if (dump) {
    // BGRA → binary PPM (RGB), viewable anywhere.
    const cw = body.readUInt32LE(4), ch = body.readUInt32LE(8)
    const rgb = Buffer.alloc(cw * ch * 3)
    for (let i = 0, j = 0; i < px.length; i += 4, j += 3) { rgb[j] = px[i + 2]; rgb[j + 1] = px[i + 1]; rgb[j + 2] = px[i] }
    fs.mkdirSync(dump, { recursive: true })
    fs.writeFileSync(path.join(dump, `tile-${id}.ppm`), Buffer.concat([Buffer.from(`P6\n${cw} ${ch}\n255\n`), rgb]))
  }
  let ink = 0, a0 = 0, a255 = 0, nonzero = 0
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] < 200 || px[i + 1] < 200 || px[i + 2] < 200) ink++
    if (px[i + 3] === 0) a0++
    else if (px[i + 3] === 255) a255++
    if (px[i] || px[i + 1] || px[i + 2] || px[i + 3]) nonzero++
  }
  waiters.get(id)?.({ tile: true, ink, pixels: px.length / 4, alpha0: a0, alpha255: a255, nonzero })
  waiters.delete(id)
}))

let next = 1
const TIMEOUT = Number(process.env.WOS_SMOKE_TIMEOUT_MS) || 60000
const BATCH_ALL = process.env.WOS_SMOKE_BATCH_ALL === '1'
const cmd = (line, ms = TIMEOUT) => {
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
  const fresh = doc.startsWith('new:') ? doc.slice(4).split(/:(.*)/s) : null
  const line = fresh ? `new ${fresh[0]} ${path.resolve(fresh[1])}` : csv ? `openopts Batch=true,59,34,76,1,,1033,false,true\t${doc}` : BATCH_ALL ? `openopts Batch=true\t${doc}` : `open ${doc}`
  const t1 = Date.now()
  const opened = await cmd(line)
  if (!opened.ok) {
    failed++
    console.log(`FAIL open ${doc} after ${Date.now() - t1} ms: ${JSON.stringify(opened).slice(0, 300)}`)
    console.log(`     engine stderr (tail): ${stderr.slice(-1500) || '(empty)'}`)
    if (opened.timeout) break // the engine is wedged; later commands would only time out too
    continue
  }
  const tile = await cmd(`tile 256 256 0 0 ${Math.min(opened.w, 12000)} ${Math.min(opened.h, 12000)}`)
  // A blank document only has to open and paint; it has no ink to find.
  if (process.env.WOS_SMOKE_PROBES === '1' && opened.type === 1) {
    const probe = async (label, l) => { const t = await cmd(l); console.log(`     probe ${label}: ${JSON.stringify(t)}`) }
    await probe('1:1 256px=3840tw', 'tile 256 256 0 0 3840 3840')
    await probe('2:1 512px=3840tw', 'tile 512 512 0 0 3840 3840')
    await probe('offset 3840,3840', 'tile 256 256 3840 3840 3840 3840')
    console.log(`     setpart 0: ${JSON.stringify(await cmd('setpart 0'))}`)
    await probe('after setpart, 1:1', 'tile 256 256 0 0 3840 3840')
    console.log(`     visarea: ${JSON.stringify(await cmd('visarea 0 0 30000 20000'))}`)
    console.log(`     clientzoom: ${JSON.stringify(await cmd('clientzoom 256 256 3840 3840'))}`)
    await probe('after visarea+clientzoom, 1:1', 'tile 256 256 0 0 3840 3840')
  }
  // Some ink, but not a solid tile: an all-black or empty-alpha buffer is a render failure, not a page.
  const solid = tile.tile && tile.ink >= tile.pixels * 0.98
  const inked = tile.tile && !solid && (fresh ? true : tile.ink > (csv ? 10 : 50))
  if (!inked) failed++
  console.log(`${inked ? 'ok  ' : 'FAIL'} ${doc}: type ${opened.type}, ${opened.parts} part(s), tile ink ${tile.ink ?? JSON.stringify(tile)}${solid ? ' (solid tile: not rendered)' : ''} (fd 4 frames arrive)`)
}

proc.stdin.write(`${next++} close\n`)
setTimeout(() => { proc.kill(); process.exit(failed ? 1 : 0) }, 3000)
