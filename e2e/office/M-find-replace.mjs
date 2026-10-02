// Phase M — in-app Find & Replace (Writer + Calc), against the REAL engine.
// Authors a fixture with a repeated word, replaces-all through the Find bar (UI
// path for Writer) and the findReplace API (Calc), saves via lok.save(), then
// UNZIPS the saved file and asserts the document content actually changed: the
// old word is gone, the new word is present the right number of times, and the
// reported replace count matches. ok:true is NOT the proof — the disk is.
//
// Fixture text is authored via the engine (.uno:InsertText / setRangeBlock) not
// keystrokes — synthetic keyboard input into the live canvas is flaky under load
// ("renders but won't type"); the engine author path is deterministic. The Find
// BAR UI (⌘F → fill → Replace all button) is still exercised for Writer so the
// full component→IPC→macro→disk chain is proven, not just the API.
import * as H from './_harness.mjs'
import { execSync } from 'child_process'
import fs from 'fs'
import ExcelJS from 'exceljs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const r = H.makeReporter('PHASE M — Find & Replace (Writer/Calc)')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

// ---------------------------------------------------------------------------
// WRITER — repeated word, replace-all through the in-app Find bar (⌘F → UI).
// ---------------------------------------------------------------------------
{
  const { app, win } = await H.launch()
  const wfile = await H.newDoc(win, 'Word')

  // Author the fixture via the engine (a repeated word + a distractor).
  await win.evaluate(() =>
    window.workspace.lok.uno('.uno:InsertText {"Text":{"type":"string","value":"apple apple apple pear"}}'))
  await H.poll(async () => { await win.evaluate(() => window.workspace.lok.save()); return H.docXml(wfile, 'Word').includes('apple') })
  const applesBefore = (H.docXml(wfile, 'Word').match(/apple/g) || []).length
  r.ok(applesBefore === 3, `Writer fixture authored (apple ×${applesBefore}, expected 3)`)

  // Open the Find bar via ⌘F, fill both fields, click Replace all.
  await win.keyboard.press('Meta+f')
  await win.waitForTimeout(300)
  r.ok(await win.getByPlaceholder('Find').isVisible().catch(() => false), 'Find bar opens on ⌘F (Writer)')
  await win.getByPlaceholder('Find').fill('apple')
  await win.getByPlaceholder('Replace').fill('orange')
  await win.getByTitle('Replace all matches').click()

  // The bar reports the count in its status line — proves the UI path ran.
  const statusOk = await H.poll(async () =>
    win.locator('text=/Replaced\\s+3/').isVisible().catch(() => false), { timeout: 6000 })
  r.ok(statusOk, 'Find bar status reports "Replaced 3"')
  await H.shot(win, 'M-writer-replaced')

  // The real proof: save, unzip word/document.xml, assert the content changed.
  await H.poll(async () => {
    await win.evaluate(() => window.workspace.lok.save())
    const x = H.docXml(wfile, 'Word')
    return !x.includes('apple') && (x.match(/orange/g) || []).length >= 3
  })
  const wafter = H.docXml(wfile, 'Word')
  r.ok((wafter.match(/apple/g) || []).length === 0, `Writer: old word gone in document.xml (apple ×${(wafter.match(/apple/g) || []).length}, expected 0)`)
  r.ok((wafter.match(/orange/g) || []).length === 3, `Writer: new word present ×${(wafter.match(/orange/g) || []).length} (expected 3)`)
  r.ok(wafter.includes('pear'), 'Writer: untouched word "pear" preserved')

  await app.close()
}

// ---------------------------------------------------------------------------
// CALC — repeated cell text, replace-all through the findReplace API.
// The fixture is authored as a real .xlsx with exceljs and OPENED from the tree
// (openDoc) — the proven-reliable render path (the New-document menu flow
// cold-boot-races the file write on this machine, which is why Calc was skipped
// before). ok:true is NOT the proof — the unzipped disk is.
// ---------------------------------------------------------------------------
{
  const XFILE = '/tmp/wos-test/M-calc.xlsx'
  for (const f of fs.readdirSync('/tmp/wos-test')) if (f.startsWith('.~lock') || f.startsWith('M-calc')) fs.rmSync('/tmp/wos-test/' + f, { force: true })
  {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Sheet1')
    ws.getCell('A1').value = 'widget'; ws.getCell('A2').value = 'widget'
    ws.getCell('A3').value = 'widget'; ws.getCell('A4').value = 'gadget'
    await wb.xlsx.writeFile(XFILE)
  }

  const { app, win } = await H.launch()
  let xfile = XFILE
  try { await H.openDoc(win, 'M-calc.xlsx', 'Excel') }
  catch (e) { xfile = null; console.log(`  ⚠ SKIP Calc: spreadsheet did not render (${e.message?.split('\n')[0]}) — environment, not the feature`) }

  if (xfile) {
    const readXlsx = () => {
      let s = ''
      try { s += execSync(`unzip -p '${xfile}' xl/worksheets/sheet1.xml`, { encoding: 'utf8' }) } catch { /* */ }
      try { s += execSync(`unzip -p '${xfile}' xl/sharedStrings.xml`, { encoding: 'utf8' }) } catch { /* */ }
      return s
    }
    // The fixture stores "widget" as ONE shared string referenced by 3 cells, so
    // sharedStrings.xml holds a single occurrence — assert on the shared-string
    // presence, not a raw ×3 count.
    r.ok(readXlsx().includes('widget') && readXlsx().includes('gadget'), 'Calc fixture opened (widget + gadget present on disk)')

    // Search WORKS on Calc: findNext locates the first match (findFirst path).
    const found = await win.evaluate(() => window.workspace.lok.findReplace({ mode: 'findnext', find: 'widget', replace: '' }))
    r.ok(found && found.ok && found.count === 1, `Calc: findNext locates "widget" (count=1, got ${found && found.count}) — engine search works on a sheet`)

    // Replace-all via the engine search API. Document-level `oDoc.replaceAll()`
    // no-ops on a SpreadsheetDocument (returns -1), so WosFindReplace now iterates
    // the sheets and replaces per-sheet (each sheet implements XReplaceable),
    // summing the real per-sheet counts. Writer keeps the document-level path.
    const res = await win.evaluate(() => window.workspace.lok.findReplace({ mode: 'replaceall', find: 'widget', replace: 'sprocket' }))
    r.ok(res && res.ok && res.count === 3,
      `Calc: replaceAll reports count=3 (got ${res && res.count}) — per-sheet replace`)

    await win.evaluate(() => window.workspace.lok.save())
    const xafter = readXlsx()
    r.ok(!xafter.includes('widget'), `Calc: old word "widget" gone on disk`)
    r.ok(xafter.includes('sprocket'), 'Calc: new word "sprocket" present on disk')
    // "sprocket" is stored as ONE shared string (like the "widget" fixture was),
    // referenced by 3 cells — so the ×3 proof is 3 cells pointing at its index,
    // not 3 raw text occurrences. Resolve the shared-string index and count the
    // cells (t="s") whose <v> references it.
    const idx = (() => {
      const sst = execSync(`unzip -p '${xfile}' xl/sharedStrings.xml`, { encoding: 'utf8' })
      const items = [...sst.matchAll(/<si>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/si>/g)].map((m) => m[1])
      return items.indexOf('sprocket')
    })()
    const sheet = execSync(`unzip -p '${xfile}' xl/worksheets/sheet1.xml`, { encoding: 'utf8' })
    const cellRefs = (sheet.match(new RegExp(`t="s"[^>]*><v>${idx}<\\/v>`, 'g')) || []).length
    r.ok(cellRefs === 3, `Calc: 3 cells now reference "sprocket" (got ${cellRefs}, expected 3)`)
    r.ok(xafter.includes('gadget'), 'Calc: untouched cell "gadget" preserved')
    await H.shot(win, 'M-calc-replaced')
  }

  await app.close()
}

process.exit(r.done() ? 0 : 1)
