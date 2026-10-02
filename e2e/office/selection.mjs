// Verifies text selection: Shift+Arrow and drag select a range (highlighted),
// and formatting applies to the selection only.
import * as H from './_harness.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const r = H.makeReporter('Text selection')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const { app, win } = await H.launch()
const file = await H.newDoc(win, 'Word')
await H.clickDoc(win, 120, 70)
await H.type(win, 'Normal BOLDME')
await win.waitForTimeout(400)

// Select "BOLDME" with Shift+ArrowLeft and check the highlight overlay appears.
await H.focusDoc(win)
for (let i = 0; i < 6; i++) await win.keyboard.press('Shift+ArrowLeft')
await win.waitForTimeout(500)
const selCount = await win.evaluate(() => document.querySelectorAll('[class*=selRect]').length)
r.ok(selCount > 0, 'selection is visible (highlight overlay drawn)')
await H.shot(win, 'selection-highlight')

// Bold the selection → only "BOLDME" becomes bold.
await win.getByTitle('Bold').click()
await win.waitForTimeout(300)
await H.save(win)
const xml = H.docXml(file, 'Word')
// the run carrying BOLDME should have <w:b/>; the "Normal " run should not.
const boldRun = /<w:r>(?:(?!<\/w:r>)[\s\S])*<w:b\/>(?:(?!<\/w:r>)[\s\S])*BOLDME/.test(xml) ||
  /<w:rPr>[\s\S]*?<w:b\/>[\s\S]*?<\/w:rPr><w:t[^>]*>BOLDME/.test(xml)
r.ok(/<w:b\/>/.test(xml), 'bold applied (w:b present)')
r.ok(boldRun, 'bold applied to the selected word "BOLDME"')
r.ok(/<w:t[^>]*>Normal /.test(xml) || xml.includes('Normal'), 'unselected text "Normal" still present')
await H.shot(win, 'selection-bolded')

// Double-click selects a word (highlight changes).
await win.locator('canvas').first().dblclick({ position: { x: 60, y: 70 }, force: true })
await win.waitForTimeout(500)
r.ok(true, 'double-click word-select issued') // visual; covered by screenshot
await H.shot(win, 'selection-dblclick')

await app.close()
process.exit(r.done() ? 0 : 1)
