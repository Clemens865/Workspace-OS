// Phase W — NATIVE Impress (.pptx) EDITING on the REAL engine. Proves the new
// slide-editing model-API ops objectively (no manual click-test): each op is run
// through the same lok.macro / lok.setTable bridge the Ribbon uses, the deck is
// SAVED, and the real .pptx is UNZIPPED (ppt/slides/slide1.xml) to assert the
// markup changed — plus every write is checked to still be a valid zip.
//
//   assign a slide layout via WosSetLayout → save → reopen → the slide's
//     placeholder set changed (layout took);
//   insert a real slide TABLE → WosSlideTableOp rowafter + colafter → save →
//     unzip → the table gained a <a:tr> row AND a grid column;
//   WosSlideTableCellFmt a cell fill → save → unzip → the fill color is present;
//   fail-safe: run each op with NOTHING selected → no crash, file still valid.
//
// Modeled on L-pptx-table.mjs: same H.enginePresent() guard, H.makeReporter,
// H.newDoc('PowerPoint') reliable-create path, waitEngineDoc, reopenInRenderer,
// unzip-and-assert. Run it directly:  node e2e/office/W-impress-edit.mjs
import * as H from './_harness.mjs'
import { execSync } from 'child_process'
import fs from 'fs'

const r = H.makeReporter('PHASE W — native Impress editing')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const FILE = '/tmp/wos-test/New Presentation.pptx'
const TAG = `wos-wtbl-${Date.now().toString(36)}`
const GRID = [['Region', 'Rev'], ['EMEA', '12']]
// Distinctive fill so the assertion can't collide with theme defaults: pure red.
const FILL_HEX = 'FF0000'
const FILL_UNO = 0xff0000

const readDeck = (f = FILE) => { try { return execSync(`unzip -p '${f}' ppt/slides/slide1.xml`, { encoding: 'utf8' }) } catch { return '' } }
const validPptx = (f = FILE) => { try { execSync(`unzip -t '${f}'`, { stdio: 'ignore' }); return true } catch { return false } }
const count = (hay, needle) => hay.split(needle).length - 1

async function waitEngineDoc(win, budgetMs = 120000) {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    const parts = await win.evaluate(() => window.workspace.lok.parts()).catch(() => null)
    if (parts && parts.parts > 0) return parts
    await win.waitForTimeout(400)
  }
  throw new Error('engine never opened a doc')
}

async function reopenInRenderer(win, budgetMs = 120000) {
  await win.getByText('New Presentation.pptx').first().click()
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (await win.locator('[data-testid=metrics-toggle]').isVisible().catch(() => false)) { await win.waitForTimeout(400); return }
    await win.waitForTimeout(400)
  }
  throw new Error('renderer never became ready for the reopened deck')
}

// Run a Wos* model-API macro through the same bridge the Ribbon uses.
const macro = (win, name, args) => win.evaluate(({ n, a }) => window.workspace.lok.macro(n, a), { n: name, a: args })
const save = (win) => win.evaluate(() => window.workspace.lok.save())

for (const f of fs.readdirSync('/tmp/wos-test')) if (f.startsWith('New Presentation')) fs.rmSync('/tmp/wos-test/' + f)

// ---- Phase 1: create a deck; ASSIGN A LAYOUT via WosSetLayout; save; reopen;
// assert the slide's placeholder set changed (the layout took). ----
let { app, win } = await H.launch()
await H.newDoc(win, 'PowerPoint')
await waitEngineDoc(win)

// Set BLANK (20) first, save, and record the placeholder count as a baseline;
// then set Title+Content (1) — which adds a title + a content placeholder — and
// assert the count grew. Counting <p:ph (placeholder markers) in slide1.xml is a
// concrete property that changes with the layout, independent of any text.
await macro(win, 'WosSetLayout', '20')
await save(win)
await win.waitForTimeout(1400)
const phBlank = count(readDeck(), '<p:ph')
r.ok(validPptx(), 'deck valid after setting BLANK layout')

await macro(win, 'WosSetLayout', '1')
await save(win)
await win.waitForTimeout(1400)
await app.close()

// Reopen to prove the layout PERSISTED (not just a live-controller artifact).
;({ app, win } = await H.launch())
await reopenInRenderer(win)
await save(win)
await win.waitForTimeout(1200)
const phTitleContent = count(readDeck(), '<p:ph')
r.ok(phTitleContent > phBlank, `WosSetLayout took + persisted: Title+Content placeholders (${phTitleContent}) > Blank (${phBlank})`)
r.ok(validPptx(), 'file valid after layout reopen')

// ---- Phase 2: INSERT a real slide table, then WosSlideTableOp rowafter +
// colafter; save; unzip; assert the table gained a ROW and a COLUMN. ----
const inserted = await win.evaluate(({ tag, values }) =>
  window.workspace.lok.setTable({ macro: 'WosInsertSlideTable', tag, values }), { tag: TAG, values: GRID })
r.ok(inserted === true, 'WosInsertSlideTable inserted a real slide table')
await save(win)
await win.waitForTimeout(1400)
const deck0 = readDeck()
const rows0 = count(deck0, '<a:tr')
const cols0 = count(deck0, '<a:gridCol')
r.ok(deck0.includes('<a:tbl>'), 'a real slide table (<a:tbl>) is present')
r.ok(rows0 === 2 && cols0 === 2, `inserted table is 2×2 (rows ${rows0}, gridCols ${cols0})`)
r.ok(validPptx(), 'file valid after insert')

// rowafter → +1 <a:tr>; colafter → +1 <a:gridCol>. The table shape is the only
// shape just created; the macro resolves it (selection → first table on slide).
await macro(win, 'WosSlideTableOp', 'rowafter')
await macro(win, 'WosSlideTableOp', 'colafter')
await save(win)
await win.waitForTimeout(1400)
const deck1 = readDeck()
const rows1 = count(deck1, '<a:tr')
const cols1 = count(deck1, '<a:gridCol')
r.ok(rows1 === rows0 + 1, `WosSlideTableOp rowafter added a row (<a:tr> ${rows0} → ${rows1})`)
r.ok(cols1 === cols0 + 1, `WosSlideTableOp colafter added a column (<a:gridCol> ${cols0} → ${cols1})`)
r.ok(deck1.includes('>Region<') && deck1.includes('>EMEA<'), 'original cells survived the structural edit')
r.ok(validPptx(), 'file valid after row/col insert')

// ---- Phase 3: CELL FORMATTING — WosSlideTableCellFmt fill; save; unzip; assert
// the fill color is present in the table markup. ----
await macro(win, 'WosSlideTableCellFmt', `fill|${FILL_UNO}`)
await macro(win, 'WosSlideTableCellFmt', 'bold|1')
await save(win)
await win.waitForTimeout(1400)
const deck2 = readDeck()
// A solid cell fill round-trips as <a:solidFill><a:srgbClr val="FF0000"> inside
// a table-cell <a:tcPr>. Assert the distinctive color landed in the deck.
r.ok(deck2.toUpperCase().includes(FILL_HEX), `WosSlideTableCellFmt fill landed (srgbClr ${FILL_HEX} present)`)
r.ok(deck2.includes('<a:tbl>'), 'table still intact after cell formatting')
r.ok(validPptx(), 'file valid after cell fill')

// ---- Phase 4: FAIL-SAFE — deselect everything, then run each new op with
// NOTHING (relevant) selected → no crash, file still a valid .pptx. ----
// Escape/click empty canvas to drop any selection, then fire the ops. The macros
// resolve to the first table on the slide (still safe) OR no-op; the point is
// they must never corrupt the file or throw.
await win.keyboard.press('Escape').catch(() => {})
await macro(win, 'WosSetLayout', '19')          // Title Only — harmless reshape
await macro(win, 'WosSlideTableOp', 'rowafter') // resolves to the slide's table
await macro(win, 'WosSlideTableCellFmt', 'align|center')
await save(win)
await win.waitForTimeout(1400)
const deck3 = readDeck()
r.ok(deck3.includes('<a:tbl>'), 'FAIL-SAFE: ops with nothing hand-selected never blanked the table')
r.ok(validPptx(), 'FAIL-SAFE: file is still a valid, non-corrupt .pptx after no-selection ops')

await app.close()
process.exit(r.done() ? 0 : 1)
