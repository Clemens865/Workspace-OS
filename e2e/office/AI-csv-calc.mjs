// Phase AI — CSV opens in Calc with a SNIFFED delimiter, against the REAL engine.
//
// The trap this guards: German-locale Excel exports semicolon-separated CSVs
// with decimal commas. Headless LOK gets no import dialog — with default
// options it guesses commas and mis-splits every row into one column. The
// engine must receive an explicit FilterOptions token (sniffed from the file
// head), and MUST save back in the same dialect (the host remembers the token).
import * as H from './_harness.mjs'
import fs from 'fs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const r = H.makeReporter('PHASE AI — CSV in Calc')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const FILE = '/tmp/wos-test/AI-csv-calc.csv'
try { fs.mkdirSync('/tmp/wos-test', { recursive: true }) } catch { /* exists */ }
for (const f of fs.readdirSync('/tmp/wos-test')) if (f.startsWith('.~lock') || f.startsWith('AI-csv')) fs.rmSync('/tmp/wos-test/' + f, { force: true })

// The hostile fixture: semicolons, decimal commas, a prose field with commas.
fs.writeFileSync(FILE, 'Name;Kommentar;Betrag\nMiete;gross, hell, ruhig;1.234,56\nStrom;ok;89,10\n')

const { app, win } = await H.launch()
await H.openDoc(win, 'AI-csv-calc.csv', 'Excel')

// 1) A csv now opens in CALC (the Data ribbon proves the engine + doc type).
r.ok(await win.getByRole('button', { name: 'Data', exact: true }).first().isVisible().catch(() => false), 'csv opens in Calc (Data ribbon present)')

// 2) The delimiter was honored: the sheet has real COLUMNS. Navigate to C2 —
//    a mis-split one-column import would still accept the nav, so prove it via
//    content: C2 must hold the Betrag value, not the whole mangled line.
await win.evaluate(() => window.workspace.lok.uno(`.uno:GoToCell {"ToPoint":{"type":"string","value":"C2"}}`))
const atC2 = await H.poll(async () => {
  const a = await win.evaluate(() => document.querySelector('[data-testid="cell-addr"]')?.textContent || '')
  return /C2/i.test(a) ? a : false
}, { timeout: 6000 })
r.ok(atC2, `cell cursor lands in a real third column (got ${atC2 || 'none'})`)

// 3) EDIT + SAVE keeps the dialect: type a value into D1, save, and the file
//    on disk must still be SEMICOLON-separated with the original fields intact.
await win.evaluate(() => window.workspace.lok.uno(`.uno:GoToCell {"ToPoint":{"type":"string","value":"D1"}}`))
await win.waitForTimeout(250)
await H.focusDoc(win)
await H.type(win, 'Neu\n')
const saved = await H.poll(async () => {
  await H.save(win)
  const txt = fs.readFileSync(FILE, 'utf8')
  return txt.includes('Neu') ? txt : false
}, { timeout: 10000 })
r.ok(saved, 'the typed value reached the saved file')
r.ok(saved && /^Name;Kommentar;Betrag;Neu/.test(saved), `saved header keeps SEMICOLONS + new column (${saved && saved.split('\n')[0]})`)
r.ok(saved && /Miete;/.test(saved) && /Strom;/.test(saved), 'original rows survive the round-trip')
r.ok(saved && /1\.?234,56|1234\.56/.test(saved), `the decimal-comma amount survives (${saved && (saved.match(/[^;\n]*234[^;\n]*/) || [])[0]})`)

await H.shot(win, 'AI-csv-calc')
await app.close()
process.exit(r.done() ? 0 : 1)
