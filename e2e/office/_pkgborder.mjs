// Verifies the UNO model bridge (cell borders) works in the PACKAGED app —
// i.e. the host resolves the bundled UNO libs at runtime (DYLD on spawn).
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')
const APP = path.join(root, 'release/mac-arm64/Workspace OS.app/Contents/MacOS/Workspace OS')
if (!fs.existsSync(APP)) { console.log('SKIP: packaged app missing'); process.exit(0) }

try { execSync('pkill -9 -f "Workspace OS"; pkill -9 -f wos-lok-host', { stdio: 'ignore' }) } catch { /* */ }
await new Promise((r) => setTimeout(r, 3000))

const env = { ...process.env, WORKSPACE_TEST_ROOT: '/tmp/wos-test' }
delete env.WOS_LOK_INSTALL; delete env.WOS_LOK_FUND; delete env.WOS_LOK_HOST

const app = await electron.launch({ executablePath: APP, args: [], env })
const win = await app.firstWindow()
win.on('pageerror', (e) => console.log('[pageerror]', e.message))
await win.waitForSelector('#root', { timeout: 20000 })
await win.waitForTimeout(1500)

const FILE = '/tmp/wos-test/pkgborder.xlsx'
fs.copyFileSync('/tmp/wos-test/test-sheet.xlsx', FILE)
await win.getByText('pkgborder.xlsx').first().click()
for (let i = 0; i < 40; i++) {
  const ok = await win.evaluate(() => { const c = document.querySelector('canvas'); return !!c && c.width > 100 }).catch(() => false)
  if (ok) break
  await win.waitForTimeout(400)
}
await win.waitForTimeout(900)

await win.locator('canvas').first().click({ position: { x: 120, y: 120 }, force: true })
await win.waitForTimeout(400)
const res = await win.evaluate(() => window.workspace.lok.setBorder('all', 255, 53)).catch((e) => 'THREW:' + e.message)
console.log('PACKAGED setBorder returned:', res)

const saveBtn = win.getByTitle('Save (⌘S)')
if (await saveBtn.isEnabled().catch(() => false)) await saveBtn.click()
for (let i = 0; i < 25; i++) { if (await win.getByText('Saved').first().isVisible().catch(() => false)) break; await win.waitForTimeout(150) }
await win.waitForTimeout(600)

let borders = false
try { borders = /<top style="[a-z]/.test(execSync(`unzip -p '${FILE}' xl/styles.xml`, { encoding: 'utf8' })) } catch { /* */ }
console.log('PACKAGED borders in styles.xml:', borders)
await app.close()
console.log(res === true && borders ? 'PKG_BORDER_OK' : 'PKG_BORDER_FAIL')
process.exit(res === true && borders ? 0 : 1)
