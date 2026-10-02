// Phase C tail — Document properties + Print.
import * as H from './_harness.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const r = H.makeReporter('PHASE C tail — Properties + Print')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const { app, win } = await H.launch()
const filePath = await H.newDoc(win, 'Word')
await H.clickDoc(win)
await H.type(win, 'Tail test document.')
await H.save(win)

// --- Document properties ---
await win.getByTitle('Document properties').click()
await win.waitForTimeout(300)
r.ok(await win.getByText('Document properties', { exact: false }).isVisible().catch(() => false), 'properties modal opens')
r.ok(await win.getByText('Text document', { exact: false }).isVisible().catch(() => false), 'shows document type')
r.ok(await win.getByText('KB', { exact: false }).isVisible().catch(() => false), 'shows size on disk')
await H.shot(win, 'C-properties')
await win.getByText('Close', { exact: true }).click()

// --- Print (engine → temp PDF → system viewer) ---
await win.evaluate((filePath) => window.dispatchEvent(new CustomEvent('wos:print', { detail: { filePath } })), filePath)
let printed = false
for (let i = 0; i < 24; i++) {
  if (await win.getByText('Opened for printing', { exact: false }).isVisible().catch(() => false)) { printed = true; break }
  if (await win.getByText('Print failed', { exact: false }).isVisible().catch(() => false)) break
  await win.waitForTimeout(250)
}
r.ok(printed, 'print renders a PDF and opens it for printing')
await H.shot(win, 'C-print')

await app.close()
process.exit(r.done() ? 0 : 1)
