// Phase A backbone test: the contextual ribbon renders, tabs switch, and
// buttons reflect live engine state (selection-state sync).
import * as H from './_harness.mjs'

const r = H.makeReporter('PHASE A — ribbon + state sync')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const { app, win } = await H.launch()
await H.newDoc(win, 'Word')

// Ribbon tabs for a Writer document.
for (const t of ['Home', 'Insert', 'Layout', 'Review', 'View']) {
  r.ok(await win.getByRole('button', { name: t, exact: true }).first().isVisible().catch(() => false), `ribbon tab present: ${t}`)
}
r.ok(await win.getByTitle('Bold').isVisible().catch(() => false), 'Home tab shows Font group (Bold)')
await H.shot(win, 'A-ribbon-home')

// State sync: turn Bold on at the cursor → the Bold button should activate.
await H.clickDoc(win, 120, 70)
await win.getByTitle('Bold').click()
r.ok(
  await H.poll(async () => /btnActive/.test((await win.getByTitle('Bold').getAttribute('class')) || '')),
  'Bold button reflects active state from the engine',
)
await H.shot(win, 'A-bold-active')

// Contextual tab switch — the Insert tab shows the Table tool (native dialog trigger).
await win.getByRole('button', { name: 'Insert', exact: true }).click()
await win.waitForTimeout(200)
r.ok(await win.getByTitle('Insert table').isVisible().catch(() => false), 'switching to Insert shows its content (Table)')
await H.shot(win, 'A-insert-tab')

await app.close()
process.exit(r.done() ? 0 : 1)
