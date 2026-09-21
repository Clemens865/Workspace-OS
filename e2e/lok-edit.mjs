// Verifies native editing in the app (Phase 3a M3): open a doc in the live
// LOKit editor, click to place the cursor, type, save — and confirm the typed
// text persisted into the .docx.
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const ENGINE = '/Volumes/LOBuild/core/instdir/LibreOffice.app/Contents'
const HOST = path.join(root, 'scripts/lok/wos-lok-host')
const FUND = ENGINE + '/Resources/fundamentalrc'

if (!fs.existsSync(HOST) || !fs.existsSync(FUND)) {
  console.log('SKIP: engine or host not present')
  process.exit(0)
}

const DOC = '/tmp/wos-test/m3-edit.docx'
fs.copyFileSync('/tmp/wos-test/test-document.docx', DOC)
const MARK = 'M3LIVE'

const env = {
  ...process.env,
  WORKSPACE_TEST_ROOT: '/tmp/wos-test',
  WOS_LOK_INSTALL: ENGINE + '/Frameworks/',
  WOS_LOK_FUND: FUND,
  WOS_LOK_HOST: HOST,
}

const app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root, env })
const win = await app.firstWindow()
win.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`))
await win.waitForLoadState('domcontentloaded')
await win.waitForSelector('#root', { timeout: 10000 })
await win.waitForTimeout(700)

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m) } }

await win.getByText('m3-edit.docx').first().click()

// wait for live render
for (let i = 0; i < 30; i++) {
  const done = !(await win.getByText('Rendering…').isVisible().catch(() => false))
  const hasCanvas = await win.evaluate(() => { const c = document.querySelector('canvas'); return !!c && c.width > 100 })
  if (done && hasCanvas) break
  await win.waitForTimeout(400)
}
ok(await win.getByText('● Live').first().isVisible().catch(() => false), 'live editor open')

// click into the document body to place the cursor, then type
const canvas = win.locator('canvas').first()
await canvas.click({ position: { x: 180, y: 120 } })
await win.waitForTimeout(300)
await win.keyboard.type(MARK, { delay: 40 })
await win.waitForTimeout(600)

// Save button becomes enabled once dirty; click it
const saveBtn = win.getByTitle('Save (⌘S)')
ok(await saveBtn.isEnabled().catch(() => false), 'edits marked the document dirty (Save enabled)')
await saveBtn.click()
await win.waitForTimeout(1200)
ok(await win.getByText('Saved').first().isVisible().catch(() => false), 'save completed (button shows Saved)')

await win.screenshot({ path: path.join(root, 'e2e/lok-edit.png') })
await app.close()

// verify persistence in the .docx
let xml = ''
try { xml = execSync(`unzip -p ${DOC} word/document.xml`, { encoding: 'utf8' }) } catch { /* */ }
ok(xml.includes(MARK), `typed text persisted into .docx (found "${MARK}")`)

console.log(`\nM3 EDIT (app): ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
