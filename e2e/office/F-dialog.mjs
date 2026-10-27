// Phase F — the Insert table dialog. It is the app's own dialog now (engine
// dialogs are covered by AM-jsdialog): open it from Insert, set the size,
// insert, and verify a table of that size landed in the .docx.
import * as H from './_harness.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const r = H.makeReporter('PHASE F — Insert table dialog')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const { app, win } = await H.launch()
const file = await H.newDoc(win, 'Word')
await H.clickDoc(win)
await H.type(win, 'Table follows:')

// Open Insert → Table → the Insert Table dialog
await win.getByRole('button', { name: 'Insert', exact: true }).click()
await win.getByTitle('Insert table').click()

r.ok(await H.poll(() => win.getByText('Insert table', { exact: true }).last().isVisible().catch(() => false)), 'Insert table dialog opens')
await H.shot(win, 'F-dialog')

// 2 columns × 3 rows, then Insert.
await win.getByLabel('Columns', { exact: true }).fill('2')
await win.getByLabel('Rows', { exact: true }).fill('3')
await win.getByRole('button', { name: 'Insert', exact: true }).last().click()
r.ok(await H.poll(async () => !(await win.getByText('Insert table', { exact: true }).last().isVisible().catch(() => false))), 'dialog closes after Insert')

const xml = await H.poll(async () => { await H.save(win); const x = H.docXml(file, 'Word'); return /<w:tbl>/.test(x) && x }, { timeout: 10000 })
r.ok(!!xml, 'a table was inserted into the document (w:tbl)')
const rows = ((xml || '').match(/<w:tr[ >]/g) || []).length
const cols = (((xml || '').match(/<w:tr[ >][\s\S]*?<\/w:tr>/) || [''])[0].match(/<w:tc>/g) || []).length
r.ok(rows === 3 && cols === 2, `table has the chosen size (3 rows × 2 columns; got ${rows} × ${cols})`)
await H.shot(win, 'F-table-inserted')

await app.close()
process.exit(r.done() ? 0 : 1)
