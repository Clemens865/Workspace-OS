// Verifies multi-part editing in the app (Phase 3a M4): a presentation shows
// slide tabs and switching slides re-renders; a spreadsheet shows its sheet.
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const ENGINE = '/Volumes/LOBuild/core/instdir/LibreOffice.app/Contents'
const HOST = path.join(root, 'scripts/lok/wos-lok-host')
const FUND = ENGINE + '/Resources/fundamentalrc'
if (!fs.existsSync(HOST) || !fs.existsSync(FUND)) { console.log('SKIP: engine/host missing'); process.exit(0) }

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

const canvasSig = () => win.evaluate(() => {
  const c = document.querySelector('canvas'); if (!c) return ''
  const ctx = c.getContext('2d'); const d = ctx.getImageData(0, 0, Math.min(c.width, 200), Math.min(c.height, 200)).data
  let s = 0; for (let i = 0; i < d.length; i += 16) s += d[i]; return `${c.width}x${c.height}:${s}`
})

// --- presentation: 2 slides, switch ---
await win.getByText('test-deck.pptx').first().click()
for (let i = 0; i < 30; i++) {
  if (!(await win.getByText('Rendering…').isVisible().catch(() => false)) &&
      (await win.evaluate(() => { const c = document.querySelector('canvas'); return !!c && c.width > 100 }))) break
  await win.waitForTimeout(400)
}
ok(await win.getByText('Slide 2').first().isVisible().catch(() => false), 'presentation shows slide tabs')
const sig1 = await canvasSig()
await win.getByText('Slide 2').first().click()
await win.waitForTimeout(1500)
const sig2 = await canvasSig()
ok(sig1 && sig2 && sig1 !== sig2, 'switching to Slide 2 re-renders a different canvas')

await win.screenshot({ path: path.join(root, 'e2e/lok-parts.png') })

// --- spreadsheet renders ---
await win.getByText('test-sheet.xlsx').first().click()
let sheetOk = false
for (let i = 0; i < 30; i++) {
  sheetOk = await win.evaluate(() => { const c = document.querySelector('canvas'); return !!c && c.width > 100 }).catch(() => false)
  const live = await win.getByText('● Live').first().isVisible().catch(() => false)
  if (sheetOk && live) break
  await win.waitForTimeout(400)
}
ok(sheetOk, 'spreadsheet renders live')

await app.close()
console.log(`\nM4 MULTIPART: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
