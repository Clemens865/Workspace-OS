// Phase F — the dialog bridge. Open the Insert Table dialog (a real LibreOffice
// dialog rendered as a bitmap overlay), confirm it shows, accept it, and verify
// a table was inserted into the .docx.
import * as H from './_harness.mjs'

const r = H.makeReporter('PHASE F — dialog bridge')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const { app, win } = await H.launch()
const file = await H.newDoc(win, 'Word')
await H.clickDoc(win)
await H.type(win, 'Table follows:')

// Open Insert → Table → the Insert Table dialog
await win.getByRole('button', { name: 'Insert', exact: true }).click()
await win.getByTitle('Insert table').click()

// The dialog overlay should appear with its title + a rendered canvas.
let shown = false
for (let i = 0; i < 24; i++) {
  shown = await win.getByText('Insert Table', { exact: false }).isVisible().catch(() => false)
  if (shown) break
  await win.waitForTimeout(200)
}
r.ok(shown, 'Insert Table dialog renders as an overlay')
// the dialog canvas has real (non-blank) content
const painted = await win.evaluate(() => {
  const cvs = Array.from(document.querySelectorAll('canvas'))
  const c = cvs[cvs.length - 1] // dialog canvas is last
  if (!c || c.width < 50) return false
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let nonWhite = 0
  for (let i = 0; i < d.length; i += 4) if (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 240) nonWhite++
  return nonWhite > 200
})
r.ok(painted, 'dialog bitmap is rendered (engine widgets visible)')
await H.shot(win, 'F-dialog')

// Accept the dialog with Enter (inserts the default table), then save.
await win.waitForTimeout(300)
await win.keyboard.press('Enter')
await win.waitForTimeout(1000)
r.ok(!(await win.getByText('Insert Table', { exact: false }).isVisible().catch(() => false)), 'dialog closes after accept')
await H.save(win)

const xml = H.docXml(file, 'Word')
r.ok(/<w:tbl>/.test(xml), 'a table was inserted into the document (w:tbl)')
await H.shot(win, 'F-table-inserted')

await app.close()
process.exit(r.done() ? 0 : 1)
