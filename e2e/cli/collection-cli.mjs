// e2e — wos-collection CLI proven against REAL files on disk (engine-free).
//
// The writers/readers are engine-free (exceljs), so this runs in plain node —
// NO electron, NO LibreOffice. It:
//   1. builds a real fixture .xlsx (a small deals table) with exceljs,
//   2. runs the ACTUAL compiled `wos-collection` CLI as a subprocess, pointed at
//      a scratch userData dir (WOS_USERDATA_DIR), to
//        - create a collection from the fixture range,
//        - view --sort revenue:desc --limit 2 (assert ONLY the top-2 rows),
//        - link a viewed projection to an xlsx range target,
//        - sync (assert the queried rows landed in the target .xlsx on disk),
//        - edit the SOURCE, refresh + sync, assert the re-sync propagated, and
//   3. asserts the target file ON DISK actually changed AND still opens as valid.
//
// It proves: create→view (top-N query), link→sync (viewed rows on disk),
// source-edit→refresh→re-sync, and the --json shape on one command.
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import fs from 'fs'
import os from 'os'
import path from 'path'
import ExcelJS from 'exceljs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const CLI = path.join(ROOT, 'resources', 'wos-collection', 'collection-cli.cjs')

if (!fs.existsSync(CLI)) {
  console.error(`FAIL: CLI not built at ${CLI} — run \`node scripts/build-collection-cli.mjs\` first`)
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
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-collection-cli-'))
const UD = path.join(SB, 'userData')
const WS = path.join(SB, 'workspace')
fs.mkdirSync(UD, { recursive: true })
fs.mkdirSync(WS, { recursive: true })

function cli(args) {
  const out = execFileSync('node', [CLI, ...args, '--json'], {
    env: { ...process.env, WOS_USERDATA_DIR: UD },
    encoding: 'utf8',
  })
  return JSON.parse(out)
}
function cliText(args) {
  return execFileSync('node', [CLI, ...args], {
    env: { ...process.env, WOS_USERDATA_DIR: UD },
    encoding: 'utf8',
  })
}

// ---- fixture builders (real .xlsx via exceljs) ---------------------------
// Writes a table starting at A1: row 0 = field names, then the records.
async function makeTable(file, rows) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  rows.forEach((row, r) => {
    row.forEach((val, c) => {
      ws.getCell(r + 1, c + 1).value = val
    })
  })
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

async function main() {
  // The source: a deals collection (name, region, revenue). 4 records.
  const srcFile = path.join(WS, 'Deals.xlsx')
  await makeTable(srcFile, [
    ['name', 'region', 'revenue'],
    ['Alpha', 'EU', 300],
    ['Bravo', 'US', 900],
    ['Charlie', 'EU', 500],
    ['Delta', 'US', 100],
  ])

  // ===================================================================
  // TEST 1: create --source reads the real range → typed records
  // ===================================================================
  const c1 = cli(['create', 'Deals', '--source', `${srcFile}!Sheet1!A1:C5`])
  ok('T1 create ok', c1.ok === true, JSON.stringify(c1))
  ok('T1 create seeded 4 records', c1.records === 4, JSON.stringify(c1))
  ok('T1 fields parsed from header row', Array.isArray(c1.fields) && c1.fields.join(',') === 'name,region,revenue', JSON.stringify(c1.fields))

  // ===================================================================
  // TEST 2: view --sort revenue:desc --limit 2 → ONLY the top-2 records
  // ===================================================================
  const v2 = cli(['view', 'Deals', '--sort', 'revenue:desc', '--limit', '2'])
  ok('T2 view ok', v2.ok === true)
  ok('T2 view returns exactly 2 records', v2.count === 2 && v2.records.length === 2, JSON.stringify(v2))
  ok('T2 top record is Bravo (900)', v2.records[0]?.name === 'Bravo' && v2.records[0]?.revenue === 900, JSON.stringify(v2.records[0]))
  ok('T2 second record is Charlie (500)', v2.records[1]?.name === 'Charlie' && v2.records[1]?.revenue === 500, JSON.stringify(v2.records[1]))
  ok('T2 the low records (Alpha/Delta) are excluded', !v2.records.some((r) => r.name === 'Alpha' || r.name === 'Delta'), JSON.stringify(v2.records))
  // Also prove the non-json (text) output shows only the top-2 data rows.
  const v2text = cliText(['view', 'Deals', '--sort', 'revenue:desc', '--limit', '2'])
  ok('T2 text output names Bravo & Charlie', v2text.includes('Bravo') && v2text.includes('Charlie'), v2text)
  ok('T2 text output omits Alpha & Delta', !v2text.includes('Alpha') && !v2text.includes('Delta'), v2text)

  // ===================================================================
  // TEST 3: link the top-2 view to an xlsx range target, then sync
  // ===================================================================
  const target = path.join(WS, 'TopDeals.xlsx')
  await makeTable(target, [['x']]) // any valid workbook; the sync overwrites at E2
  const l3 = cli([
    'link', 'Deals',
    '--file', target,
    '--target', 'xlsx:Sheet1!E2',
    '--columns', 'name:Deal,revenue:Revenue',
    '--sort', 'revenue:desc',
    '--limit', '2',
  ])
  ok('T3 link ok', l3.ok === true, JSON.stringify(l3))
  ok('T3 link columns are Deal & Revenue', Array.isArray(l3.columns) && l3.columns.join(',') === 'name:Deal,revenue:Revenue', JSON.stringify(l3.columns))

  const s3 = cli(['sync', 'Deals'])
  ok('T3 sync ok', s3.ok === true)
  ok('T3 sync updated 1 file', Array.isArray(s3.updated) && s3.updated.length === 1, JSON.stringify(s3.updated))
  // Anchor E2 → header row at E2:F2, then top-2 data rows at E3:F4.
  ok('T3 header wrote to E2 (Deal)', (await readCell(target, 'E2')) === 'Deal')
  ok('T3 header wrote to F2 (Revenue)', (await readCell(target, 'F2')) === 'Revenue')
  ok('T3 row1 = Bravo/900 (E3/F3)', (await readCell(target, 'E3')) === 'Bravo' && (await readCell(target, 'F3')) === 900, `${await readCell(target, 'E3')}/${await readCell(target, 'F3')}`)
  ok('T3 row2 = Charlie/500 (E4/F4)', (await readCell(target, 'E4')) === 'Charlie' && (await readCell(target, 'F4')) === 500, `${await readCell(target, 'E4')}/${await readCell(target, 'F4')}`)
  ok('T3 target file still valid .xlsx', await isValidXlsx(target))

  // A second sync with no changes is a no-op (already in sync).
  const s3b = cli(['sync', 'Deals'])
  ok('T3 re-sync with no change updates 0 files', (s3b.updated ?? []).length === 0 && s3b.unchanged >= 1, JSON.stringify(s3b))

  // ===================================================================
  // TEST 4: edit the SOURCE, refresh, sync → the re-sync propagates
  // ===================================================================
  // Bump Delta's revenue to 950 so the top-2 becomes Delta(950), Bravo(900).
  await makeTable(srcFile, [
    ['name', 'region', 'revenue'],
    ['Alpha', 'EU', 300],
    ['Bravo', 'US', 900],
    ['Charlie', 'EU', 500],
    ['Delta', 'US', 950],
  ])
  // `refresh` re-reads the source AND propagates the new view to linked files.
  const r4 = cli(['refresh', 'Deals'])
  ok('T4 refresh reports updated', r4.status === 'updated', JSON.stringify(r4))
  ok('T4 refresh re-synced 1 file', (r4.updated ?? []).length === 1, JSON.stringify(r4))
  ok('T4 new top row = Delta/950', (await readCell(target, 'E3')) === 'Delta' && (await readCell(target, 'F3')) === 950, `${await readCell(target, 'E3')}/${await readCell(target, 'F3')}`)
  ok('T4 second row = Bravo/900', (await readCell(target, 'E4')) === 'Bravo' && (await readCell(target, 'F4')) === 900, `${await readCell(target, 'E4')}/${await readCell(target, 'F4')}`)
  ok('T4 Charlie no longer in the top-2 (F4 not 500)', (await readCell(target, 'F4')) !== 500)
  ok('T4 target still valid after re-sync', await isValidXlsx(target))

  // ===================================================================
  // TEST 5: --json shape on `list` (machine-readable envelope)
  // ===================================================================
  const j5 = cli(['list'])
  ok('T5 list --json has ok:true', j5.ok === true)
  ok('T5 list --json has a collections array', Array.isArray(j5.collections), JSON.stringify(j5))
  const deals = (j5.collections ?? []).find((c) => c.name === 'Deals')
  ok('T5 Deals present with 4 records + 1 link', deals && deals.records === 4 && deals.links === 1, JSON.stringify(deals))

  // ---- summary ----
  console.log(`\n${passed} passed, ${failed} failed`)
  try { fs.rmSync(SB, { recursive: true, force: true }) } catch {}
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('FAIL (threw):', e.stack || e.message)
  process.exit(1)
})
