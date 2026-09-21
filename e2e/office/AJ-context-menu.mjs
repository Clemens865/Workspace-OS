// Phase AJ — the engine's own context menu, on the REAL engine.
//
// In LibreOfficeKit mode a right-click that reaches the engine makes it emit
// LOK_CALLBACK_CONTEXT_MENU (23): the popup menu for whatever is under the
// pointer, as JSON with commands, enabled and checked state. That is the
// target detection and the state our right-click menus need — this proves the
// callback actually arrives from the wos-lok-host for each app and target, and
// prints the shape so the renderer can be built against real payloads.
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
const VERBOSE = process.argv.includes('--dump')

if (!fs.existsSync(HOST) || !fs.existsSync(ENGINE + '/Resources/fundamentalrc')) { console.log('SKIP: engine/host missing'); process.exit(0) }

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m) } }

try { fs.rmSync('/tmp/wos-lok-host-profile', { recursive: true, force: true }) } catch { /* */ }
// The Wos* macro library is seeded by the app's main process; a bare host needs
// it done here (same bundling trick as X-impress-table.mjs).
function findEsbuild(start) {
  let dir = start
  for (;;) {
    const bin = path.join(dir, 'node_modules/.bin/esbuild')
    if (fs.existsSync(bin)) return bin
    const up = path.dirname(dir)
    if (up === dir) throw new Error('esbuild not found')
    dir = up
  }
}
const SEED_ENTRY = '/tmp/wos-aj-seed-entry.mts', SEED_LIB = '/tmp/wos-aj-seed-lib.mjs'
fs.writeFileSync(SEED_ENTRY, `export { seedEngineProfile, seedMacroLibrary } from '${path.join(ROOT, 'src/main/office/lokMacros.ts')}'\n`)
execSync(`'${findEsbuild(ROOT)}' '${SEED_ENTRY}' --bundle --platform=node --format=esm --outfile='${SEED_LIB}'`, { stdio: 'ignore' })
const { seedEngineProfile, seedMacroLibrary } = await import(SEED_LIB)
seedEngineProfile()
const proc = spawn(HOST, [ENGINE + '/Frameworks/', ENGINE + '/Resources/fundamentalrc'], { stdio: ['pipe', 'ignore', 'inherit', 'pipe', 'pipe'] })
let buf = Buffer.alloc(0)
const waiters = new Map()
let onReady = null, readySeen = false
const callbacks = []
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
      else if (m.cb != null) callbacks.push(m)
      else if (m.id != null && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id) }
    }
  }
})
let nextId = 1
// A wedged engine must FAIL the probe, not hang it: every command has a deadline.
const send = (cmd, timeoutMs = 20000) => new Promise((res) => {
  const id = nextId++
  const timer = setTimeout(() => { if (waiters.has(id)) { waiters.delete(id); console.log(`  ✗ TIMEOUT after ${timeoutMs}ms: ${cmd.slice(0, 80)}`); fail++; res({ ok: false, err: 'timeout' }) } }, timeoutMs)
  waiters.set(id, (m) => { clearTimeout(timer); res(m) })
  proc.stdin.write(`${id} ${cmd}\n`)
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await new Promise((r) => { if (readySeen) return r(); onReady = r })
seedMacroLibrary()

const CB_CONTEXT_MENU = 23, CB_CONTEXT_CHANGED = 39, CB_TABLE_SELECTED = 44
const readPartInfo = () => { try { return fs.readFileSync('/tmp/wos-asset-out.txt', 'utf8').trim().split('\n').map((l) => l.split('|')) } catch { return [] } }
const MOUSE_LEFT = 1, MOUSE_RIGHT = 4

async function rightClick(x, y) {
  callbacks.length = 0
  await send(`mouse 0 ${x} ${y} 1 ${MOUSE_RIGHT} 0`)
  await send(`mouse 1 ${x} ${y} 1 ${MOUSE_RIGHT} 0`)
  await sleep(500)
  const cm = callbacks.filter((c) => c.cb === CB_CONTEXT_MENU).pop()
  const ctx = callbacks.filter((c) => c.cb === CB_CONTEXT_CHANGED).pop()
  return { menu: cm ? JSON.parse(cm.payload).menu : null, context: ctx?.payload ?? null, all: callbacks.map((c) => c.cb) }
}
async function leftClick(x, y, count = 1) {
  await send(`mouse 0 ${x} ${y} ${count} ${MOUSE_LEFT} 0`)
  await send(`mouse 1 ${x} ${y} ${count} ${MOUSE_LEFT} 0`)
  await sleep(200)
}
const flat = (items, depth = 0, out = []) => {
  for (const it of items ?? []) {
    if (it.type === 'separator') { out.push('  '.repeat(depth) + '──'); continue }
    out.push('  '.repeat(depth) + `${it.text ?? ''}  [${it.command ?? ''}]${it.enabled === 'false' ? ' (disabled)' : ''}${it.checked != null ? ' checked=' + it.checked : ''}`)
    if (it.menu) flat(it.menu, depth + 1, out)
  }
  return out
}
const cmds = (items, out = []) => { for (const it of items ?? []) { if (it.command) out.push(it.command); if (it.menu) cmds(it.menu, out) } return out }
function report(name, r, expectCmd) {
  ok(!!r.menu, `${name}: CONTEXT_MENU callback arrived (callbacks seen: ${[...new Set(r.all)].join(',')})`)
  if (!r.menu) return
  const c = cmds(r.menu)
  ok(c.length > 3, `${name}: ${c.length} commands, e.g. ${c.slice(0, 5).join(' ')}`)
  if (expectCmd) ok(c.includes(expectCmd), `${name}: has ${expectCmd}`)
  console.log(`    context: ${r.context}`)
  if (VERBOSE) console.log(flat(r.menu).map((l) => '      ' + l).join('\n'))
}

// ── Writer ───────────────────────────────────────────────────────────────
{
  const DOC = '/tmp/wos-aj-writer.docx'
  try { fs.rmSync(DOC, { force: true }) } catch { /* */ }
  ok((await send(`new swriter ${DOC}`)).ok, 'writer: new document')
  await sleep(300)
  for (const ch of 'Hello context') await send(`key 0 ${ch.charCodeAt(0)} 0`)
  await sleep(200)
  // Body text (page margins ~1134tw; the first line sits around y≈1500).
  report('writer text', await rightClick(1600, 1500), '.uno:ParagraphDialog')
  // A pick from the menu must actually dispatch: apply Heading 1 the way the
  // menu does (a plain postUnoCommand of the item's command) and read it back.
  // `.uno:Heading1ParaStyle` is a menu ALIAS (TargetURL in WriterCommands.xcu);
  // the dispatcher only knows the resolved StyleApply URL. Both the query form
  // the engine's own menus use and the JSON-args form are tried here.
  const docXml = () => { try { return execSync(`unzip -p '${DOC}' word/document.xml`, { encoding: 'utf8' }) } catch { return '' } }
  await send('uno .uno:Heading1ParaStyle'); await sleep(200)
  await send('save'); await sleep(400)
  ok(!/w:val="Heading1"/.test(docXml()), 'writer: the raw alias .uno:Heading1ParaStyle is a no-op (why aliases must be resolved)')
  // Bad JSON args must come back as an error, never kill the host (a query-form
  // URL with a space used to do exactly that).
  const bad = await send('uno .uno:StyleApply?Style:string=Heading 1&FamilyName:string=ParagraphStyles')
  ok(bad.ok === false && (await send('ping')).ok !== undefined, `writer: malformed args are refused and the host survives (${bad.err ?? 'no err'})`)
  await send('uno .uno:StyleApply {"Style":{"type":"string","value":"Heading 1"},"FamilyName":{"type":"string","value":"ParagraphStyles"}}'); await sleep(300)
  await send('save'); await sleep(500)
  ok(/w:val="Heading1"/.test(docXml()), 'writer: the resolved alias (StyleApply + JSON args) lands Heading 1 in the saved .docx')
  // Insert a table and right-click inside it.
  await send('uno .uno:InsertTable {"Columns":{"type":"long","value":2},"Rows":{"type":"long","value":2}}')
  await sleep(500)
  const t = callbacks.filter((c) => c.cb === CB_TABLE_SELECTED).pop()
  ok(!!t, `writer: TABLE_SELECTED arrived after insert (${t ? t.payload.slice(0, 60).replace(/\s+/g, ' ') : 'none'})`)
  // Right-click INSIDE the table, at a point taken from the engine's own
  // TABLE_SELECTED geometry (the heading above it moved the table down).
  let tx = 1600, ty = 2300
  try {
    const g = JSON.parse(t.payload)
    const cx = g.columns.tableOffset + (g.columns.left + g.columns.right) / 2
    const rows = g.rows.entries
    const firstRowBottom = rows.length ? rows[0].position : 400
    tx = Math.round(cx); ty = Math.round(g.rows.tableOffset + firstRowBottom / 2)
  } catch { /* fall back to the guess above */ }
  report('writer table cell', await rightClick(tx, ty), '.uno:TableDialog')
}

// ── Calc ─────────────────────────────────────────────────────────────────
{
  const DOC = '/tmp/wos-aj-calc.xlsx'
  try { fs.rmSync(DOC, { force: true }) } catch { /* */ }
  ok((await send(`new scalc ${DOC}`)).ok, 'calc: new sheet')
  await sleep(300)
  await leftClick(600, 700)
  report('calc cell', await rightClick(600, 700), '.uno:FormatCellDialog')
  // Fill handle: a 1, 2 series in A1:A2 continued to A5 through WosFill.
  await send('uno .uno:GoToCell {"ToPoint":{"type":"string","value":"A1"}}'); await sleep(100)
  for (const ch of '1') await send(`key 0 ${ch.charCodeAt(0)} 0`)
  await send('key 0 13 1280'); await sleep(100)
  for (const ch of '2') await send(`key 0 ${ch.charCodeAt(0)} 0`)
  await send('key 0 13 1280'); await sleep(150)
  const fr = await send('macro WosFill A1:A5|0|2'); await sleep(300)
  await send('save'); await sleep(500)
  const sh = (() => { try { return execSync(`unzip -p '${DOC}' xl/worksheets/sheet1.xml`, { encoding: 'utf8' }) } catch { return '' } })()
  const a = (r) => { const m = sh.match(new RegExp(`<c r="A${r}"[^>]*>(?:<f>[^<]*</f>)?<v>([^<]+)</v>`)); return m ? Number(m[1]) : null }
  ok(fr.ok && a(3) === 3 && a(5) === 5, `calc: WosFill A1:A5 continues the series (A3=${a(3)}, A5=${a(5)})`)
  // Sheet-tab menu operations run through WosSheetOp by index (Module1).
  await send('macro WosSheetOp duplicate'); await sleep(300)
  await send('macro WosPartInfo'); await sleep(100)
  let info = readPartInfo()
  ok(info.length === 2 && info[1][0] === 'Sheet1 (2)', `calc: duplicate sheet → ${info.map((p) => p[0]).join(', ')}`)
  await send('macro WosSheetOp color|2052217'); await sleep(200)
  await send('macro WosSheetOp hide'); await sleep(300)
  await send('macro WosPartInfo'); await sleep(100)
  info = readPartInfo()
  ok(info.some((p) => p[1] === '0') && info.some((p) => p[1] === '1'), `calc: hide sheet → visibility ${info.map((p) => p[1]).join(',')}`)
  await send('macro WosSheetOp show|Sheet1 (2)'); await sleep(300)
  await send('macro WosPartInfo'); await sleep(100)
  info = readPartInfo()
  ok(info.every((p) => p[1] === '1'), 'calc: show sheet by name → all visible again')
  await send('save'); await sleep(500)
  const wb = (() => { try { return execSync(`unzip -p '${DOC}' xl/workbook.xml`, { encoding: 'utf8' }) } catch { return '' } })()
  const sh1 = (() => { try { return execSync(`unzip -p '${DOC}' xl/worksheets/sheet2.xml`, { encoding: 'utf8' }) } catch { return '' } })()
  ok(/Sheet1 \(2\)/.test(wb), 'calc: the duplicated sheet is in the saved workbook')
  ok(/tabColor/.test(sh1), 'calc: the tab colour is in the saved sheet')
  // Row header: x<0 is not addressable via mouse; headers are outside the tile
  // area, so LOK cannot right-click them — the app's own header menus stay.
}

// ── Impress ──────────────────────────────────────────────────────────────
{
  const DOC = '/tmp/wos-aj-impress.pptx'
  try { fs.rmSync(DOC, { force: true }) } catch { /* */ }
  ok((await send(`new simpress ${DOC}`)).ok, 'impress: new deck')
  await sleep(300)
  // Bottom-right corner of a 16:9 slide (28000×15750 twips) — empty background.
  report('impress slide background', await rightClick(26000, 15000), '.uno:SlideSetup')
  // Title placeholder near the top centre.
  await leftClick(14000, 3000)
  report('impress title box', await rightClick(14000, 3000), null)
  // Slide ops by index (Module3) + a slide-table op scoped to an EXPLICIT cell.
  await send('uno .uno:DuplicatePage'); await sleep(400)
  await send('macro WosSlideOp hide|1'); await sleep(200)
  await send('macro WosSlideOp rename|1|Backup'); await sleep(200)
  await send('macro WosPartInfo'); await sleep(100)
  const pinfo = readPartInfo()
  ok(pinfo.length === 2 && pinfo[1][1] === '0' && pinfo[1][0] === 'Backup', `impress: hide + rename by index → ${pinfo.map((p) => p.join(':')).join(', ')}`)
  await send('setpart 0'); await sleep(200)
  // A 2×3 table via the same macro the Insert ribbon uses, then widen column 1
  // (the middle one) by naming the cell explicitly: op|arg|row|col.
  await send('uno .uno:InsertTable {"Columns":{"type":"long","value":3},"Rows":{"type":"long","value":2}}'); await sleep(600)
  await send('macro WosSlideTableOp colwidth|3000|0|1'); await sleep(300)
  await send('save'); await sleep(600)
  const s1 = (() => { try { return execSync(`unzip -p '${DOC}' ppt/slides/slide1.xml`, { encoding: 'utf8' }) } catch { return '' } })()
  const cols = [...s1.matchAll(/<a:gridCol w="(\d+)"/g)].map((m) => Number(m[1]))
  // 3000 1/100 mm = 1,080,000 EMU; only the MIDDLE column must carry it.
  ok(cols.length === 3 && Math.abs(cols[1] - 1080000) < 2000 && cols[0] !== cols[1], `impress: explicit-cell colwidth hit column 1 only (${cols.join(', ')})`)
  const pres = (() => { try { return execSync(`unzip -p '${DOC}' ppt/slides/slide2.xml`, { encoding: 'utf8' }) } catch { return '' } })()
  ok(/show="0"/.test(pres), 'impress: the hidden slide is saved as show="0"')
}

console.log(`\nAJ context menu: ${pass} passed, ${fail} failed`)
proc.kill()
process.exit(fail ? 1 : 0)
