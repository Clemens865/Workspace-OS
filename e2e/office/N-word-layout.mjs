// Phase N — Word Layout (page setup) against the REAL engine.
// Opens a Writer .docx, applies each layout op via the SAME macro path the
// Layout ribbon calls (window.workspace.lok.macro), saves via lok.save(), then
// UNZIPS the saved .docx and asserts the change is actually there:
//   • margins   → <w:pgMar w:top/bottom/left/right> in the sectPr
//   • landscape → <w:pgSz … w:orient="landscape"> (swapped w:w/w:h)
//   • header    → word/header1.xml part + <w:headerReference> + the text
//   • footer    → word/footer1.xml part + <w:footerReference> + the text
//   • page num  → a PAGE field in the footer part
// ok:true is NOT proof — every assertion below reads the real saved bytes.
import * as H from './_harness.mjs'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const r = H.makeReporter('PHASE N — Word Layout')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

// Author the fixture by OPENING an existing .docx (the New-doc menu is flaky per
// wos-engine-e2e-discipline). A committed minimal Writer doc is copied in and
// opened via the tree — Writer renders in this harness, so the ops are real.
const FIXTURE = path.join(__dirname, 'fixtures', 'word-layout.docx')
const FILE_NAME = 'word-layout.docx'
const FILE = '/tmp/wos-test/' + FILE_NAME
const docXml = () => H.docXml(FILE, 'Word')
// Read an arbitrary inner part of the saved .docx (returns '' if absent).
const part = (inner) => { try { return execSync(`unzip -p '${FILE}' ${inner}`, { encoding: 'utf8' }) } catch { return '' } }
const listParts = () => { try { return execSync(`unzip -l '${FILE}'`, { encoding: 'utf8' }) } catch { return '' } }
const validDocx = () => { try { execSync(`unzip -t '${FILE}'`, { stdio: 'ignore' }); return true } catch { return false } }
const macro = (win, name, args) => win.evaluate(({ n, a }) => window.workspace.lok.macro(n, a), { n: name, a: args })
const saveEngine = (win) => win.evaluate(() => window.workspace.lok.save())

fs.mkdirSync('/tmp/wos-test', { recursive: true })
fs.copyFileSync(FIXTURE, FILE)

const { app, win } = await H.launch()

// Open the fixture via the file tree; waitRender asserts the Writer 'Layout' tab,
// proving a real Writer doc rendered (not a stale canvas).
await H.openDoc(win, FILE_NAME, 'Word')
await win.waitForTimeout(600)
r.ok(validDocx(), 'fixture opened — valid Writer .docx')

// ---------- 1) MARGINS ----------
// Apply distinctive, non-default margins (1/100 mm). Word stores pgMar in twips
// (1/1440"): 1/100mm → twips = round(v * 1440 / 2540). 2000→1134, 3000→1701.
const mm100ToTw = (v) => Math.round((v * 1440) / 2540)
await macro(win, 'WosPageMargins', 'top|2000')
await macro(win, 'WosPageMargins', 'bottom|2500')
await macro(win, 'WosPageMargins', 'left|3000')
await macro(win, 'WosPageMargins', 'right|3500')
const marginsPersisted = await H.poll(async () => {
  await saveEngine(win)
  const x = docXml()
  const m = /<w:pgMar\b[^>]*\/>/.exec(x)
  if (!m) return false
  const tag = m[0]
  const g = (k) => { const mm = new RegExp(`w:${k}="(-?\\d+)"`).exec(tag); return mm ? Number(mm[1]) : null }
  return g('top') === mm100ToTw(2000) && g('bottom') === mm100ToTw(2500) &&
         g('left') === mm100ToTw(3000) && g('right') === mm100ToTw(3500)
}, { timeout: 30000 })
const pgMar = (/<w:pgMar\b[^>]*\/>/.exec(docXml()) || [''])[0]
r.ok(marginsPersisted, `margins persisted to sectPr <w:pgMar> (expected top=${mm100ToTw(2000)} bottom=${mm100ToTw(2500)} left=${mm100ToTw(3000)} right=${mm100ToTw(3500)} tw) — got ${pgMar}`)

// ---------- 2) ORIENTATION → landscape ----------
await macro(win, 'WosPageOrient', 'landscape')
const landscapePersisted = await H.poll(async () => {
  await saveEngine(win)
  const x = docXml()
  const m = /<w:pgSz\b[^>]*\/>/.exec(x)
  if (!m) return false
  const tag = m[0]
  if (!/w:orient="landscape"/.test(tag)) return false
  const w = Number((/w:w="(\d+)"/.exec(tag) || [])[1] || 0)
  const h = Number((/w:h="(\d+)"/.exec(tag) || [])[1] || 0)
  return w > h // landscape: width now exceeds height
}, { timeout: 30000 })
const pgSz = (/<w:pgSz\b[^>]*\/>/.exec(docXml()) || [''])[0]
r.ok(landscapePersisted, `orientation persisted — <w:pgSz w:orient="landscape"> with w>h — got ${pgSz}`)

// ---------- 3) HEADER with text ----------
const HDR = 'WOS Confidential Report'
await macro(win, 'WosHeaderFooter', `header|on|${HDR}`)
const headerPersisted = await H.poll(async () => {
  await saveEngine(win)
  return listParts().includes('header') && /w:headerReference/.test(docXml()) && part('word/header1.xml').includes(HDR)
}, { timeout: 30000 })
r.ok(listParts().includes('word/header'), 'header part word/headerN.xml created')
r.ok(/w:headerReference/.test(docXml()), 'sectPr references the header (<w:headerReference>)')
const hdrPart = (listParts().match(/word\/header\d\.xml/) || ['word/header1.xml'])[0]
r.ok(part(hdrPart).includes(HDR), `header text "${HDR}" written into ${hdrPart}`)
r.ok(headerPersisted, 'header op fully persisted (part + reference + text)')

// ---------- 4) FOOTER with text ----------
const FTR = 'WOS Draft — do not distribute'
await macro(win, 'WosHeaderFooter', `footer|on|${FTR}`)
const footerPersisted = await H.poll(async () => {
  await saveEngine(win)
  return listParts().includes('footer') && /w:footerReference/.test(docXml()) && part('word/footer1.xml').includes(FTR)
}, { timeout: 30000 })
r.ok(listParts().includes('word/footer'), 'footer part word/footerN.xml created')
r.ok(/w:footerReference/.test(docXml()), 'sectPr references the footer (<w:footerReference>)')
const ftrPart = (listParts().match(/word\/footer\d\.xml/) || ['word/footer1.xml'])[0]
r.ok(part(ftrPart).includes(FTR), `footer text "${FTR}" written into ${ftrPart}`)
r.ok(footerPersisted, 'footer op fully persisted (part + reference + text)')

// ---------- 5) PAGE NUMBER field in the footer ----------
await macro(win, 'WosPageNumber', 'footer')
const pageNumPersisted = await H.poll(async () => {
  await saveEngine(win)
  // A live page number round-trips as a PAGE field: either a fldSimple with
  // instr="… PAGE …" or a fldChar run pair carrying "PAGE" in the instrText.
  const anyFooter = listParts().match(/word\/footer\d\.xml/g) || []
  return anyFooter.some((p) => /PAGE/.test(part(p)) && (/w:fldSimple/.test(part(p)) || /w:instrText/.test(part(p)) || /w:fldChar/.test(part(p))))
}, { timeout: 30000 })
const footerFieldPart = (listParts().match(/word\/footer\d\.xml/g) || []).find((p) => /PAGE/.test(part(p)))
r.ok(pageNumPersisted, `page-number PAGE field persisted into the footer part (${footerFieldPart || 'none'})`)

r.ok(validDocx(), 'final saved file is still a valid, non-corrupt .docx')
await H.shot(win, 'N-word-layout')
await app.close()

process.exit(r.done() ? 0 : 1)
