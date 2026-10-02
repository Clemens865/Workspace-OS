// Phase 3a goal tests — real authoring workflows, end-to-end in the app.
// Headline: create a NEW Word doc, write a heading + a paragraph, format, save,
// and confirm it all persisted into the .docx.
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const ENGINE = '/Volumes/LOBuild/core/instdir/LibreOffice.app/Contents'
const HOST = path.join(root, 'scripts/lok/wos-lok-host')
if (!fs.existsSync(HOST) || !fs.existsSync(ENGINE + '/Resources/fundamentalrc')) { console.log('SKIP: engine/host missing'); process.exit(0) }

// clean prior generated docs
for (const f of fs.readdirSync('/tmp/wos-test')) if (/^New (Document|Spreadsheet|Presentation)/.test(f)) fs.rmSync('/tmp/wos-test/' + f)

const env = {
  ...process.env, WORKSPACE_TEST_ROOT: '/tmp/wos-test',
  WOS_LOK_INSTALL: ENGINE + '/Frameworks/', WOS_LOK_FUND: ENGINE + '/Resources/fundamentalrc', WOS_LOK_HOST: HOST,
}
const app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root, env })
const win = await app.firstWindow()
win.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`))
await win.waitForSelector('#root', { timeout: 15000 }); await win.waitForTimeout(900)

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m) } }
const waitRender = async () => { for (let i = 0; i < 40; i++) { const r = await win.evaluate(() => { const c = document.querySelector('canvas'); return !!c && c.width > 100 }).catch(() => 0); if (r && !(await win.getByText('Rendering…').isVisible().catch(() => 0))) return; await win.waitForTimeout(400) } }

// --- WORKFLOW: create a new Word document ---
await win.getByTitle('New document').click()
await win.getByText('Word document').click()
await waitRender()
ok(await win.getByText('● Live').first().isVisible().catch(() => false), 'new Word document created & open in editor')

// heading
const canvas = win.locator('canvas').first()
await canvas.click({ position: { x: 120, y: 60 } })
await win.waitForTimeout(200)
await win.locator('select').first().selectOption('Heading 1').catch(() => {})
await win.waitForTimeout(300)
await win.keyboard.type('Hello', { delay: 50 })
await win.keyboard.press('Enter')
await win.locator('select').first().selectOption('Default Paragraph Style').catch(() => {})
await win.keyboard.type('This is a small paragraph of body text.', { delay: 25 })
await win.waitForTimeout(500)

// save
await win.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')
await win.waitForTimeout(1500)
ok(await win.getByText('Saved').first().isVisible().catch(() => false), 'document saved')

await win.screenshot({ path: path.join(root, 'e2e/lok-workflows.png') })
await app.close()

// --- verify persistence in the created .docx ---
const created = fs.readdirSync('/tmp/wos-test').find((f) => /^New Document.*\.docx$/.test(f))
ok(!!created, `new .docx exists on disk (${created})`)
let xml = ''
try { xml = execSync(`unzip -p '/tmp/wos-test/${created}' word/document.xml`, { encoding: 'utf8' }) } catch { /* */ }
ok(xml.includes('Hello'), 'heading text "Hello" persisted')
ok(xml.includes('This is a small paragraph'), 'body paragraph persisted')
ok(/Heading\s*1|Heading1/.test(xml), 'a Heading style was applied')

console.log(`\nWORKFLOWS: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
