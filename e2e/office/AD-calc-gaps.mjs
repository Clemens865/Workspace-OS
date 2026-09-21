// Phase AD — probe the Calc commands we DON'T yet wire, against the real engine.
//
// Purpose: turn a feature wish-list into a verified build list. A `.uno:` name
// that LibreOffice does not know is accepted and silently does nothing, so the
// only honest way to plan this work is to fire each candidate at a real sheet
// and see which ones actually change the document.
//
// Output is a table: VERIFIED (document changed) / ACCEPTED (dispatch ok, no
// file-visible change — normal for modes, dialogs and selection) / DEAD (the
// engine rejected it). Only the first two are worth building UI for.
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const DEV = '/Volumes/LOBuild/core/instdir/LibreOffice.app/Contents'
const BUNDLED = path.join(ROOT, 'release/mac-arm64/Workspace OS.app/Contents/Resources/libreoffice/LibreOffice.app/Contents')
const ENGINE = fs.existsSync(DEV + '/Resources/fundamentalrc') ? DEV : BUNDLED
const HOST = path.join(ROOT, 'scripts/lok/wos-lok-host')
const DOC = '/tmp/wos-ad-calc-gaps.xlsx'

if (!fs.existsSync(HOST) || !fs.existsSync(ENGINE + '/Resources/fundamentalrc')) { console.log('SKIP: engine/host missing'); process.exit(0) }

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
const send = (c) => new Promise((r) => { const id = nextId++; waiters.set(id, r); proc.stdin.write(`${id} ${c}\n`) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await new Promise((r) => { if (readySeen) return r(); onReady = r })

const sheet = () => { try { return execSync(`unzip -p '${DOC}' xl/worksheets/sheet1.xml`, { encoding: 'utf8' }) } catch { return '' } }
const styles = () => { try { return execSync(`unzip -p '${DOC}' xl/styles.xml`, { encoding: 'utf8' }) } catch { return '' } }
async function save() { await send('save'); await sleep(350) }
async function type(text) {
  for (const ch of text) { await send(`key 0 ${ch.charCodeAt(0)} 0`); await send(`key 1 ${ch.charCodeAt(0)} 0`) }
  await send('key 0 13 1280'); await send('key 1 13 1280')
  await sleep(100)
}

await send(`new scalc ${DOC}`)
await sleep(400)
await type('100')
await type('200')
await type('300')
await save()

// Candidates grouped by the user-facing feature they'd unlock.
const CANDIDATES = [
  ['Format painter (Pinsel)', '.uno:FormatPaintbrush'],
  ['Fill down (⌘D)', '.uno:FillDown'],
  ['Fill right (⌘R)', '.uno:FillRight'],
  ['Align top', '.uno:AlignTop'],
  ['Align middle', '.uno:AlignVCenter'],
  ['Align bottom', '.uno:AlignBottom'],
  ['Hide rows', '.uno:HideRow'],
  ['Show rows', '.uno:ShowRow'],
  ['Hide columns', '.uno:HideColumn'],
  ['Show columns', '.uno:ShowColumn'],
  ['Insert cells (shift)', '.uno:InsertCell'],
  ['Delete cells (shift)', '.uno:DeleteCell'],
  ['Row height…', '.uno:RowHeight'],
  ['Column width…', '.uno:ColumnWidth'],
  ['Optimal column width', '.uno:SetOptimalColumnWidth'],
  ['Optimal row height', '.uno:SetOptimalRowHeight'],
  ['Sort dialog (multi-key)', '.uno:DataSort'],
  ['Define name', '.uno:DefineName'],
  ['Function wizard', '.uno:FunctionDialog'],
  ['Pivot table', '.uno:DataDataPilotRun'],
  ['Define print area', '.uno:DefinePrintArea'],
  ['Split window', '.uno:SplitWindow'],
  ['Group rows/cols', '.uno:Group'],
  ['Ungroup', '.uno:Ungroup'],
  ['Transpose paste', '.uno:PasteTransposed'],
  ['Increase font', '.uno:Grow'],
  ['Decrease font', '.uno:Shrink'],
  ['Toggle currency', '.uno:NumberFormatCurrency'],
]

const results = []
for (const [label, uno] of CANDIDATES) {
  const pre = sheet() + styles()
  const res = await send(`uno ${uno}`)
  await sleep(180)
  await save()
  const post = sheet() + styles()
  const changed = pre !== post
  results.push({ label, uno, ok: res.ok === true, changed })
  // Undo anything that mutated, so each probe starts from the same sheet.
  if (changed) { await send('uno .uno:Undo'); await sleep(150); await save() }
}

console.log('\n================================================================')
console.log('  PHASE AD — Calc feature-gap probe (real engine)')
console.log('================================================================')
console.log('  VERIFIED = document changed · ACCEPTED = dispatch ok, no file change')
console.log('  (normal for modes/dialogs/selection) · DEAD = engine rejected\n')
let verified = 0, accepted = 0, dead = 0
for (const r of results) {
  const verdict = !r.ok ? 'DEAD    ' : r.changed ? 'VERIFIED' : 'ACCEPTED'
  if (verdict === 'VERIFIED') verified++
  else if (verdict === 'ACCEPTED') accepted++
  else dead++
  console.log(`  ${verdict}  ${r.label.padEnd(26)} ${r.uno}`)
}
console.log(`\n  VERIFIED ${verified} · ACCEPTED ${accepted} · DEAD ${dead} (of ${results.length})`)

await send('close')
proc.stdin.end(); proc.kill()
await sleep(200)
process.exit(0)
