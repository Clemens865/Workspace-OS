// Phase B — Writer everyday functions, driven through the ribbon UI.
// Toggles verified via state-sync (button activates); content functions via the
// saved .docx markup; screenshots throughout.
import * as H from './_harness.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const r = H.makeReporter('PHASE B — Writer everyday')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const { app, win } = await H.launch()
const file = await H.newDoc(win, 'Word')
await H.clickDoc(win, 120, 70)
await H.type(win, 'Phase B formatting test paragraph.')

const cls = async (title) => (await win.getByTitle(title).getAttribute('class')) || ''
async function pollActive(title, ms = 2500) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (/btnActive/.test(await cls(title))) return true
    await win.waitForTimeout(150)
  }
  return false
}
async function toggle(title) {
  await H.focusDoc(win)
  await win.getByTitle(title).click()
  r.ok(await pollActive(title), `${title} → active (state sync)`)
  await win.getByTitle(title).click(); await win.waitForTimeout(150) // toggle off
}

// --- Font toggles ---
await toggle('Italic'); await toggle('Underline'); await toggle('Strikethrough')
await toggle('Subscript'); await toggle('Superscript')
await H.shot(win, 'B-font-toggles')

// --- Alignment (state sync) ---
await H.focusDoc(win)
await win.getByTitle('Center').click()
r.ok(await pollActive('Center'), 'Center alignment → active')
await H.shot(win, 'B-align-center')
await win.getByTitle('Align left').click(); await win.waitForTimeout(200)

// --- Font family + size + bullets (apply to selection → docx markup) ---
await H.focusDoc(win); await H.type(win, ' COURIERWORD')
await H.selectAll(win)
await win.getByTitle('Font', { exact: true }).selectOption('Courier New'); await win.waitForTimeout(200)
await H.selectAll(win)
await win.getByTitle('Font size', { exact: true }).selectOption('28'); await win.waitForTimeout(200)
await H.focusDoc(win)
await win.getByTitle('Bulleted list').click()
await H.shot(win, 'B-font-bullets')
// Save + re-check until all three apply (the three ops settle independently).
await H.poll(async () => {
  await H.save(win); const x = H.docXml(file, 'Word')
  return /Courier New/.test(x) && /val="56"/.test(x) && /numPr|numId|ListBullet/.test(x)
})
let xml = H.docXml(file, 'Word')
r.ok(/Courier New/.test(xml), 'font family applied (Courier New in document.xml)')
r.ok(/w:sz[^>]*w:val="56"|val="56"/.test(xml), 'font size 28pt applied (sz=56)')
r.ok(/numPr|numId|ListBullet/.test(xml), 'bulleted list applied')

// --- Insert: page break ---
await win.getByRole('button', { name: 'Insert', exact: true }).click()
await win.getByTitle('Page break').click()
r.ok(await H.poll(async () => { await H.save(win); return /w:br|pageBreak|w:type="page"/.test(H.docXml(file, 'Word')) }), 'page break inserted')
await H.shot(win, 'B-page-break')

// --- Review: track changes (verified by effect: edits become tracked) ---
// Scope to the ribbon tab row: a sidebar "Review" tab now also exists, so a bare
// getByRole('button', {name:'Review'}) matches 2 elements (strict-mode failure).
// The ribbon row is the one that also holds the "Home" tab — disambiguate via it.
const ribbonTabs = win.locator('div', { has: win.getByRole('button', { name: 'Home', exact: true }) }).last()
await ribbonTabs.getByRole('button', { name: 'Review', exact: true }).click()
await win.getByTitle('Track changes').click(); await win.waitForTimeout(200)
await H.focusDoc(win); await H.type(win, ' TRACKEDEDIT')
r.ok(await H.poll(async () => { await H.save(win); return /w:ins\b/.test(H.docXml(file, 'Word')) }), 'track changes records edits as tracked insertions (w:ins)')
await H.shot(win, 'B-review')

await app.close()
process.exit(r.done() ? 0 : 1)
