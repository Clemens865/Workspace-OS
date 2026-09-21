// Verifies the native LibreOfficeKit live view (Phase 3a M2): the LokRenderer
// opens an office doc via the sidecar and paints real tiles into a canvas.
// Requires the validation engine on /Volumes/LOBuild and a compiled wos-lok-host.
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const ENGINE = '/Volumes/LOBuild/core/instdir/LibreOffice.app/Contents'
const env = {
  ...process.env,
  WORKSPACE_TEST_ROOT: '/tmp/wos-test',
  WOS_LOK_INSTALL: ENGINE + '/Frameworks/',
  WOS_LOK_FUND: ENGINE + '/Resources/fundamentalrc',
  WOS_LOK_HOST: path.join(root, 'scripts/lok/wos-lok-host'),
}

if (!fs.existsSync(env.WOS_LOK_HOST) || !fs.existsSync(env.WOS_LOK_FUND)) {
  console.log('SKIP: engine or host not present (build the headless engine + wos-lok-host first)')
  process.exit(0)
}

const app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root, env })
const win = await app.firstWindow()
win.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`))
await win.waitForLoadState('domcontentloaded')
await win.waitForSelector('#root', { timeout: 10000 })
await win.waitForTimeout(700)

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m) } }

await win.getByText('test-document.docx').first().click()

// Wait for the live indicator + a canvas with rendered (non-white) content.
let rendered = false
for (let i = 0; i < 40; i++) {
  rendered = await win.evaluate(() => {
    const cv = document.querySelector('canvas')
    if (!cv || cv.width < 100 || cv.height < 100) return false
    const ctx = cv.getContext('2d')
    const { data } = ctx.getImageData(0, 0, cv.width, Math.min(cv.height, 400))
    let ink = 0
    for (let p = 0; p < data.length; p += 4) {
      if (data[p] < 120 && data[p + 1] < 120 && data[p + 2] < 120) ink++
    }
    return ink > 50 // real text pixels present
  }).catch(() => false)
  const errored = await win.getByText('Cannot render', { exact: false }).isVisible().catch(() => false)
  if (rendered || errored) break
  await win.waitForTimeout(500)
}
ok(rendered, 'docx renders live tiles into the canvas (real ink)')

const liveBadge = await win.getByText('● Live').first().isVisible().catch(() => false)
ok(liveBadge, 'live engine indicator present')

// Wait for the full render to finish (overlay clears, canvas becomes visible).
let done = false
for (let i = 0; i < 20; i++) {
  done = !(await win.getByText('Rendering…').isVisible().catch(() => false))
  if (done) break
  await win.waitForTimeout(400)
}
ok(done, 'render completes (overlay clears, canvas visible)')
await win.waitForTimeout(300)

await win.screenshot({ path: path.join(root, 'e2e/lok.png') })
console.log(`\nM2 LOK VIEW: ${pass} passed, ${fail} failed`)
await app.close()
process.exit(fail === 0 ? 0 : 1)
