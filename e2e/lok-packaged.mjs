// Verifies the PACKAGED app renders live from its BUNDLED engine (Phase 3a M5)
// with no WOS_LOK_* env — i.e. the SSD validation build is not needed.
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const APP = path.join(root, 'release/mac-arm64/Workspace OS.app/Contents/MacOS/Workspace OS')

if (!fs.existsSync(APP)) { console.log('SKIP: packaged app not found (run npm run dist:mac)'); process.exit(0) }

// Confirm the engine + host are actually inside the bundle.
const RES = path.join(root, 'release/mac-arm64/Workspace OS.app/Contents/Resources')
const bundledSoffice = path.join(RES, 'libreoffice/LibreOffice.app/Contents/Frameworks/libsofficeapp.dylib')
const bundledHost = path.join(RES, 'lok/wos-lok-host')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m) } }
ok(fs.existsSync(bundledSoffice), 'bundled headless engine present in .app')
ok(fs.existsSync(bundledHost), 'bundled wos-lok-host present in .app')

// Launch the packaged binary directly. NO WOS_LOK_* env — must use the bundle.
const env = { ...process.env, WORKSPACE_TEST_ROOT: '/tmp/wos-test' }
delete env.WOS_LOK_INSTALL
delete env.WOS_LOK_FUND
delete env.WOS_LOK_HOST

const app = await electron.launch({ executablePath: APP, args: [], env })
const win = await app.firstWindow()
win.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`))
await win.waitForLoadState('domcontentloaded')
await win.waitForSelector('#root', { timeout: 15000 })
await win.waitForTimeout(900)

await win.getByText('test-document.docx').first().click()
let rendered = false
for (let i = 0; i < 50; i++) {
  rendered = await win.evaluate(() => {
    const c = document.querySelector('canvas')
    if (!c || c.width < 100) return false
    const d = c.getContext('2d').getImageData(0, 0, c.width, Math.min(c.height, 400)).data
    let ink = 0
    for (let p = 0; p < d.length; p += 4) if (d[p] < 120 && d[p + 1] < 120 && d[p + 2] < 120) ink++
    return ink > 50
  }).catch(() => false)
  if (rendered) break
  await win.waitForTimeout(500)
}
ok(rendered, 'packaged app renders docx live from the BUNDLED engine (no env)')
ok(await win.getByText('● Live').first().isVisible().catch(() => false), 'live editor active in packaged app')

await win.screenshot({ path: path.join(root, 'e2e/lok-packaged.png') })
await app.close()
console.log(`\nM5 PACKAGED: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
