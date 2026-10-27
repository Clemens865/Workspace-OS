// Verifies the PACKAGED Linux app renders live from the SYSTEM LibreOffice
// (apt install libreoffice) with no WOS_LOK_* env. Counterpart of lok-packaged.mjs.
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
process.env.WOS_START_ON ??= 'stage'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const APP = path.join(root, 'release/linux-unpacked/workspace-os')

if (process.platform !== 'linux') { console.log('SKIP: linux only'); process.exit(0) }
if (!fs.existsSync(APP)) { console.log('SKIP: packaged app not found (run npm run dist:linux)'); process.exit(0) }

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m) } }
ok(fs.existsSync('/usr/lib/libreoffice/program/fundamentalrc'), 'system LibreOffice present')
ok(fs.existsSync(path.join(root, 'release/linux-unpacked/resources/lok/wos-lok-host')), 'bundled wos-lok-host present')

const env = { ...process.env, WORKSPACE_TEST_ROOT: '/tmp/wos-test', WOS_USERDATA_DIR: '/tmp/wos-userdata' }
delete env.WOS_LOK_INSTALL
delete env.WOS_LOK_FUND
delete env.WOS_LOK_HOST

const app = await electron.launch({ executablePath: APP, args: [], env })
const win = await app.firstWindow()
win.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`))
await win.waitForLoadState('domcontentloaded')
await win.waitForSelector('#root', { timeout: 15000 })
await win.waitForTimeout(900)
// The splash resolves into an Enter button; dismiss it as the other suites do.
for (let i = 0; i < 40 && (await win.$('[class*="_splash_"]')); i++) {
  await win.keyboard.press('Enter').catch(() => {})
  await win.waitForTimeout(300)
}
await win.screenshot({ path: path.join(root, 'e2e/lok-packaged-linux-launch.png') })

async function renders(name) {
  await win.getByText(name).first().click()
  // The first canvas in the DOM is not the document; read the visible page canvas.
  for (let i = 0; i < 60; i++) {
    const inked = await win.evaluate(() => {
      const c = [...document.querySelectorAll('canvas[class*="_page_"]')].find((el) => el.offsetParent)
      if (!c || c.width < 100) return false
      const d = c.getContext('2d').getImageData(0, 0, c.width, Math.min(c.height, 400)).data
      let ink = 0
      for (let p = 0; p < d.length; p += 4) if (d[p] < 120 && d[p + 1] < 120 && d[p + 2] < 120) ink++
      return ink > 50
    }).catch(() => false)
    // A switch can leave the previous page canvas inked under the "Rendering…" overlay.
    const pending = await win.getByText(/^Rendering/).first().isVisible().catch(() => false)
    if (inked && !pending) return true
    await win.waitForTimeout(500)
  }
  return false
}

for (const name of ['test-document.docx', 'Harbour-Terminal-Q3.xlsx', 't.csv']) {
  ok(await renders(name), `packaged app renders ${name} live from the system engine`)
  await win.screenshot({ path: path.join(root, `e2e/lok-packaged-linux-${name.replace(/\W+/g, '-')}.png`) })
}

await app.close()
console.log(`\nLINUX PACKAGED: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
