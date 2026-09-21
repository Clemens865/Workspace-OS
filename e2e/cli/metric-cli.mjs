// e2e — wos-metric CLI proven against REAL files on disk (engine-free).
//
// The writers/readers are engine-free (exceljs), so this runs in plain node —
// NO electron, NO LibreOffice. It:
//   1. builds a real fixture .xlsx with exceljs,
//   2. seeds a metric + a link in the SAME userData JSON stores the app uses
//      (via WOS_USERDATA_DIR, a scratch dir),
//   3. runs the ACTUAL compiled `wos-metric` CLI as a subprocess, and
//   4. asserts the fixture file ON DISK actually changed to the expected value
//      AND still opens as a valid .xlsx.
//
// It proves: set→propagate, sync-all, source-refresh→propagate, and the
// fail-safe skips (deleted metric, formula cell) never corrupt a file.
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import fs from 'fs'
import os from 'os'
import path from 'path'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const CLI = path.join(ROOT, 'resources', 'wos-metric', 'metric-cli.cjs')

if (!fs.existsSync(CLI)) {
  console.error(`FAIL: CLI not built at ${CLI} — run \`node scripts/build-metric-cli.mjs\` first`)
  process.exit(1)
}

// ---- tiny assert harness --------------------------------------------------
let passed = 0
let failed = 0
function ok(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// ---- scratch userData + workspace ----------------------------------------
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-metric-cli-'))
const UD = path.join(SB, 'userData')
const WS = path.join(SB, 'workspace')
fs.mkdirSync(UD, { recursive: true })
fs.mkdirSync(WS, { recursive: true })

function udWrite(name, obj) {
  fs.writeFileSync(path.join(UD, name), JSON.stringify(obj), 'utf8')
}
function udRead(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(UD, name), 'utf8'))
  } catch {
    return []
  }
}

function cli(args) {
  const out = execFileSync('node', [CLI, ...args, '--json'], {
    env: { ...process.env, WOS_USERDATA_DIR: UD },
    encoding: 'utf8',
  })
  return JSON.parse(out)
}
function cliExpectFail(args) {
  try {
    execFileSync('node', [CLI, ...args, '--json'], {
      env: { ...process.env, WOS_USERDATA_DIR: UD },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { threw: false }
  } catch (e) {
    return { threw: true, code: e.status, stdout: e.stdout?.toString() ?? '' }
  }
}

// ---- fixture builders (real .xlsx via exceljs) ---------------------------
async function makeXlsx(file, cells) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  for (const [addr, val] of Object.entries(cells)) ws.getCell(addr).value = val
  await wb.xlsx.writeFile(file)
}
async function readCell(file, addr) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file) // throws if not a valid workbook — doubles as validity check
  return wb.getWorksheet('Sheet1').getCell(addr).value
}
async function isValidXlsx(file) {
  try {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(file)
    return true
  } catch {
    return false
  }
}

// ---- pptx fixture builder (minimal VALID .pptx with one tagged shape) -----
// Mirrors the shape gen.py emits for a `metrics` anchor: a `<p:sp>` whose
// `<p:cNvPr name="wos-metric-<tag>">` is the anchor and whose single `<a:t>`
// run holds the literal — exactly what pptx-shape-writer locates + rewrites.
async function makePptxWithAnchor(file, tag, text) {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
      '</Types>'
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
      '</Relationships>'
  )
  zip.file(
    'ppt/presentation.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
  )
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>' +
      '</Relationships>'
  )
  zip.file(
    'ppt/slides/slide1.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>' +
      `<p:sp><p:nvSpPr><p:cNvPr id="2" name="wos-metric-${tag}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
      `<p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>` +
      '</p:spTree></p:cSld></p:sld>'
  )
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  fs.writeFileSync(file, buf)
}
async function readShapeText(file, tag) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file))
  const xml = await zip.file('ppt/slides/slide1.xml').async('string')
  const m = new RegExp(`name="wos-metric-${tag}"[\\s\\S]*?<a:t>([\\s\\S]*?)</a:t>`).exec(xml)
  return m ? m[1] : null
}

const MID = 'metric-e2e-1'
const RID = 'link-e2e-1'

async function main() {
  // ===================================================================
  // TEST 1: set <name> <value> → propagates to a real linked .xlsx cell
  // ===================================================================
  const target = path.join(WS, 'Report.xlsx')
  await makeXlsx(target, { A1: 20.5 })
  udWrite('metrics.json', [
    { id: MID, name: 'Q3 Revenue', value: 20.5, updatedAt: Date.now() },
  ])
  udWrite('transclusions.json', [
    { id: RID, metricId: MID, filePath: target, target: { kind: 'xlsx-cell', sheet: 'Sheet1', cell: 'A1' }, lastValue: 20.5 },
  ])

  const r1 = cli(['set', 'Q3 Revenue', '21.9'])
  ok('T1 set reports ok', r1.ok === true)
  ok('T1 set updated 1 file', Array.isArray(r1.updated) && r1.updated.length === 1, JSON.stringify(r1.updated))
  const cellAfterSet = await readCell(target, 'A1')
  ok('T1 REAL .xlsx cell A1 changed to 21.9 on disk', cellAfterSet === 21.9, `got ${cellAfterSet}`)
  ok('T1 file still a valid .xlsx', await isValidXlsx(target))
  // The store upserts one-per-anchor (a new id, keyed by file+sheet+cell), so
  // match on the anchor rather than the original id.
  const linkAfter = udRead('transclusions.json').find(
    (l) => l.filePath === target && l.target?.cell === 'A1'
  )
  ok('T1 link lastValue advanced to 21.9', linkAfter && linkAfter.lastValue === 21.9, JSON.stringify(linkAfter))

  // ===================================================================
  // TEST 2: fail-safe — a FORMULA cell is skipped, never corrupted
  // ===================================================================
  const formulaFile = path.join(WS, 'Formula.xlsx')
  await makeXlsx(formulaFile, { A1: { formula: 'B1*2', result: 10 }, B1: 5 })
  udWrite('transclusions.json', [
    ...udRead('transclusions.json'),
    { id: 'link-formula', metricId: MID, filePath: formulaFile, target: { kind: 'xlsx-cell', sheet: 'Sheet1', cell: 'A1' }, lastValue: 0 },
  ])
  const r2 = cli(['set', 'Q3 Revenue', '99'])
  const skippedFormula = (r2.skipped ?? []).find((s) => s.file === formulaFile)
  ok('T2 formula cell reported as skipped', !!skippedFormula, JSON.stringify(r2.skipped))
  ok('T2 skip reason is cell-has-formula', skippedFormula?.reason === 'cell-has-formula', skippedFormula?.reason)
  ok('T2 formula file still valid (not corrupted)', await isValidXlsx(formulaFile))
  const fCell = await readCell(formulaFile, 'A1')
  ok('T2 formula cell preserved (still a formula)', fCell && typeof fCell === 'object' && 'formula' in fCell, JSON.stringify(fCell))

  // ===================================================================
  // TEST 3: fail-safe — a DELETED metric leaves its linked file untouched
  // ===================================================================
  const orphanFile = path.join(WS, 'Orphan.xlsx')
  await makeXlsx(orphanFile, { A1: 7 })
  udWrite('transclusions.json', [
    { id: 'link-orphan', metricId: 'metric-does-not-exist', filePath: orphanFile, target: { kind: 'xlsx-cell', sheet: 'Sheet1', cell: 'A1' }, lastValue: 7 },
  ])
  udWrite('metrics.json', [{ id: MID, name: 'Q3 Revenue', value: 99, updatedAt: Date.now() }])
  const r3 = cli(['sync-all'])
  ok('T3 sync-all ok', r3.ok === true)
  const orphanCell = await readCell(orphanFile, 'A1')
  ok('T3 orphaned-link file left untouched (A1 still 7)', orphanCell === 7, `got ${orphanCell}`)
  ok('T3 orphan file still valid', await isValidXlsx(orphanFile))

  // ===================================================================
  // TEST 4: source-refresh — edit the SOURCE cell, refresh-all, linked file updates
  // ===================================================================
  const srcFile = path.join(WS, 'Model.xlsx')
  const dstFile = path.join(WS, 'Deck.xlsx')
  await makeXlsx(srcFile, { C3: 100 }) // the source cell
  await makeXlsx(dstFile, { A1: 100 }) // the downstream linked cell
  udWrite('metrics.json', [
    { id: 'metric-src', name: 'Model Total', value: 100, updatedAt: Date.now(),
      source: { kind: 'xlsx-cell', filePath: srcFile, sheet: 'Sheet1', cell: 'C3' } },
  ])
  udWrite('transclusions.json', [
    { id: 'link-src', metricId: 'metric-src', filePath: dstFile, target: { kind: 'xlsx-cell', sheet: 'Sheet1', cell: 'A1' }, lastValue: 100 },
  ])
  // Edit the source cell on disk (simulating the model being updated).
  await makeXlsx(srcFile, { C3: 250 })
  const r4 = cli(['refresh-all'])
  ok('T4 refresh-all ok', r4.ok === true)
  const changed = (r4.results ?? []).find((x) => x.name === 'Model Total')
  ok('T4 metric re-read from source as updated', changed?.status === 'updated', JSON.stringify(changed))
  ok('T4 metric value now 250', changed?.value === 250, JSON.stringify(changed))
  const dstCell = await readCell(dstFile, 'A1')
  ok('T4 REAL downstream .xlsx cell propagated to 250 on disk', dstCell === 250, `got ${dstCell}`)
  ok('T4 downstream file still valid', await isValidXlsx(dstFile))
  const srcMetric = udRead('metrics.json').find((m) => m.id === 'metric-src')
  ok('T4 metric cached value persisted as 250', srcMetric?.value === 250, JSON.stringify(srcMetric))

  // ===================================================================
  // TEST 5: unknown metric → clear error, non-zero exit
  // ===================================================================
  const r5 = cliExpectFail(['get', 'No Such Metric'])
  ok('T5 unknown metric exits non-zero', r5.threw && r5.code === 1, `code=${r5.code}`)
  const parsed5 = (() => { try { return JSON.parse(r5.stdout) } catch { return {} } })()
  ok('T5 error payload present', parsed5.ok === false && typeof parsed5.error === 'string', r5.stdout)

  // ===================================================================
  // TEST 6: create --source reads a real cell; list/get reflect it
  // ===================================================================
  const seedFile = path.join(WS, 'Seed.xlsx')
  await makeXlsx(seedFile, { D4: 42 })
  udWrite('metrics.json', [])
  udWrite('transclusions.json', [])
  const r6 = cli(['create', 'Seeded', '--source', `${seedFile}!Sheet1!D4`])
  ok('T6 create --source ok', r6.ok === true)
  ok('T6 create --source seeded value 42 from the real cell', r6.value === 42, JSON.stringify(r6))
  const r6b = cli(['list'])
  ok('T6 list shows the sourced metric', (r6b.metrics ?? []).some((m) => m.name === 'Seeded' && m.value === 42), JSON.stringify(r6b.metrics))

  // ===================================================================
  // TEST 7: AGENT-ONLY LIVE Excel→PPT LINK (the demo chain, headless)
  //   create metric from an xlsx cell → generate an ANCHORED pptx →
  //   `wos-metric link` → change the xlsx → refresh → sync-all →
  //   the pptx shape's text updated. No app UI, no LibreOffice.
  // ===================================================================
  udWrite('metrics.json', [])
  udWrite('transclusions.json', [])
  const modelXlsx = path.join(WS, 'Model7.xlsx')
  const deckPptx = path.join(WS, 'Deck7.pptx')
  await makeXlsx(modelXlsx, { B2: 1200 }) // the source cell
  await makePptxWithAnchor(deckPptx, 'revenue', '1200') // gen.py-style anchor

  // (2) create the metric sourced from the xlsx cell.
  const c7 = cli(['create', 'Revenue', '--source', `${modelXlsx}!Sheet1!B2`])
  ok('T7 create --source seeded 1200', c7.ok === true && c7.value === 1200, JSON.stringify(c7))

  // (4) link the metric to the pptx anchor (headless registry write).
  const l7 = cli(['link', 'Revenue', '--file', deckPptx, '--target', 'revenue'])
  ok('T7 link ok', l7.ok === true, JSON.stringify(l7))
  ok('T7 link recorded in transclusions.json', udRead('transclusions.json').some((x) => x.filePath === deckPptx && x.target?.tag === 'wos-metric-revenue'))

  // change the xlsx value on disk (the spreadsheet updates).
  await makeXlsx(modelXlsx, { B2: 1875 })

  // re-read the source metric, then push to every linked file.
  const rf7 = cli(['refresh', 'Revenue'])
  ok('T7 refresh re-read source to 1875', rf7.value === 1875, JSON.stringify(rf7))
  const s7 = cli(['sync-all'])
  ok('T7 sync-all ok', s7.ok === true)
  const shapeText = await readShapeText(deckPptx, 'revenue')
  ok('T7 REAL .pptx shape text updated to 1875 on disk', shapeText === '1875', `got ${shapeText}`)
  // Prove the deck still opens as a valid zip/pptx after the write.
  ok('T7 deck still a valid .pptx (zip re-opens)', await (async () => {
    try { await JSZip.loadAsync(fs.readFileSync(deckPptx)); return true } catch { return false }
  })())

  // ---- summary ----
  console.log(`\n${passed} passed, ${failed} failed`)
  try { fs.rmSync(SB, { recursive: true, force: true }) } catch {}
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('FAIL (threw):', e.stack || e.message)
  process.exit(1)
})
