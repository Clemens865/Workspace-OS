// Phase E — Impress (PowerPoint): slide ops + slide text editing.
import * as H from './_harness.mjs'
import { execSync } from 'child_process'

const r = H.makeReporter('PHASE E — Impress (PowerPoint)')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const slideCount = (file) => {
  try { return parseInt(execSync(`unzip -l '${file}' | grep -c 'ppt/slides/slide[0-9]*.xml'`, { encoding: 'utf8' }).trim()) } catch { return 0 }
}
const tabCount = (win) => win.evaluate(() => document.querySelectorAll('[data-slide-tab], [class*=partActive], [class*=partTab]').length)

const { app, win } = await H.launch()
const file = await H.newDoc(win, 'PowerPoint')
r.ok(await win.getByTitle('New slide').isVisible().catch(() => false), 'Impress ribbon shows Slides group')
await H.shot(win, 'E-impress-ribbon')

// --- Slide text editing: double-click the title placeholder, type ---
await win.locator('canvas').first().dblclick({ position: { x: 360, y: 120 }, force: true })
await win.waitForTimeout(400)
await win.keyboard.type('Quarterly Review')
await win.waitForTimeout(300)
// click outside the text box to commit (Escape), then save
await win.keyboard.press('Escape')
await win.waitForTimeout(300)
await H.shot(win, 'E-slide-text')
const slideText = () => { try { return execSync(`unzip -p '${file}' ppt/slides/slide1.xml`, { encoding: 'utf8' }) } catch { return '' } }
r.ok(await H.poll(async () => { await H.save(win); return slideText().includes('Quarterly Review') }), 'typed text persists in the slide')

// --- New slide → 2 slides ---
await win.getByTitle('New slide').click()
r.ok(await H.poll(async () => (await tabCount(win)) >= 2), 'New slide → second slide tab appears')
r.ok(await H.poll(async () => { await H.save(win); return slideCount(file) >= 2 }), 'saved .pptx has 2 slides')
await H.shot(win, 'E-new-slide')

// --- Duplicate → 3 ---
await win.getByTitle('Duplicate slide').click()
r.ok(await H.poll(async () => { await H.save(win); return slideCount(file) >= 3 }), 'Duplicate slide → 3 slides')

// --- Delete → 2 ---
await win.getByTitle('Delete slide').click()
r.ok(await H.poll(async () => { await H.save(win); return slideCount(file) === 2 }), 'Delete slide → back to 2 slides')

await app.close()
process.exit(r.done() ? 0 : 1)
