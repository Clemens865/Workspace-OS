// SPIKE (spike/vector-rendering): does IN-PROCESS vector (SVG) export of the
// already-loaded document run fast enough to be a live rendering path?
// The CLI `soffice --convert-to svg` was 4.4s — but that's cold process spawn +
// file reload. This drives the host's `svgspike` (saveAs on the live model) and
// reports host-side ms + output bytes, cold and warm, vs a tile render.
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

const ROOT = path.resolve(import.meta.dirname, '../..')
const ENGINE = ROOT + '/release/mac-arm64/Workspace OS.app/Contents/Resources/libreoffice/LibreOffice.app/Contents'
const INSTALL = ENGINE + '/Frameworks/'
const FUND = ENGINE + '/Resources/fundamentalrc'
const HOST = path.resolve(import.meta.dirname, 'wos-lok-host')
const SHIM = path.join(os.homedir(), 'Library/Application Support/workspace-os/bin/wos-gen')
const DIR = '/tmp/wos-vecspike'
fs.mkdirSync(DIR, { recursive: true })

// Build three real documents (multi-slide deck + doc + sheet).
function gen(kind, spec, out) {
  fs.writeFileSync(path.join(DIR, 'spec.json'), JSON.stringify(spec))
  execFileSync(SHIM, [kind, '--spec', path.join(DIR, 'spec.json'), '--out', out], { stdio: 'ignore' })
}
const deck = DIR + '/deck.pptx', doc = DIR + '/doc.docx', sheet = DIR + '/sheet.xlsx'
gen('pptx', { slides: Array.from({ length: 6 }, (_, i) => ({ title: `Slide ${i + 1}`, bullets: ['alpha', 'beta', 'gamma'] })) }, deck)
gen('docx', { title: 'Doc', paragraphs: Array.from({ length: 8 }, () => 'The quick brown fox jumps over the lazy dog.') }, doc)
gen('xlsx', { sheets: [{ name: 'S1', rows: Array.from({ length: 20 }, (_, r) => [`r${r}`, r, r * 2, r * r]) }] }, sheet)

// fd0=stdin (commands), fd1=ignore, fd2=inherit (logs), fd3=framed protocol.
const proc = spawn(HOST, [INSTALL, FUND], { stdio: ['pipe', 'ignore', 'inherit', 'pipe'] })
let buf = Buffer.alloc(0)
const waiters = new Map(); let onEvent = null
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
      const msg = JSON.parse(body.toString('utf8'))
      if (msg.event && onEvent) onEvent(msg)
      else if (msg.id != null && waiters.has(msg.id)) { waiters.get(msg.id)(msg); waiters.delete(msg.id) }
    } else if (type === 'T') {
      const id = body.readUInt32LE(0), cw = body.readUInt32LE(4), ch = body.readUInt32LE(8)
      if (waiters.has(id)) { waiters.get(id)({ tile: true, cw, ch, bytes: body.length - 12 }); waiters.delete(id) }
    }
  }
})
let nextId = 1
function send(cmd) { const id = nextId++; const p = new Promise((res) => waiters.set(id, res)); proc.stdin.write(`${id} ${cmd}\n`); return p }
// Latch the ready event — it can arrive before await ready() attaches a listener.
let sawReady = false, readyResolve = null
onEvent = (m) => { if (m.event === 'ready') { sawReady = true; if (readyResolve) readyResolve() } }
function ready() { return sawReady ? Promise.resolve() : new Promise((res) => { readyResolve = res }) }

const guard = setTimeout(() => { console.log('TIMEOUT'); proc.kill(); process.exit(2) }, 90000)
await ready()
console.log('host ready — engine:', fs.existsSync(INSTALL) ? 'bundled' : 'MISSING\n')

for (const [label, file] of [['PPTX (6 slides)', deck], ['DOCX (8 paras)', doc], ['XLSX (20 rows)', sheet]]) {
  const o = await send(`open ${file}`)
  if (!o.ok) { console.log(`\n${label}: open failed (${o.err})`); continue }
  // tile render for reference (whole visible doc at ~1024px)
  const tw = o.w, th = o.h
  let tt = Date.now(); await send(`tile 1024 600 0 0 ${tw} ${th}`); const tileMs = Date.now() - tt
  // in-process SVG export — run 3× (1st = cold filter init, then warm)
  const runs = []
  for (let i = 0; i < 3; i++) { const r = await send(`svgspike ${DIR}/out-${label[0]}-${i}.svg`); runs.push(r) }
  const okAll = runs.every((r) => r.ok)
  console.log(`\n${label}`)
  console.log(`  tile render (1024px):        ${tileMs}ms`)
  console.log(`  in-process SVG export host:  cold ${runs[0].ms}ms → warm ${runs[1].ms}ms / ${runs[2].ms}ms  (${okAll ? 'ok' : 'FAILED'})`)
  console.log(`  SVG size:                    ${(runs[0].bytes / 1024).toFixed(0)} KB`)
  await send('closedoc')
}

clearTimeout(guard)
proc.stdin.end(); proc.kill()
process.exit(0)
