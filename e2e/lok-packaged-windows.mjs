// Verifies the PACKAGED Windows app (release/win-unpacked): it starts, renders a
// .docx and a .pptx live from the installed LibreOffice, and installs the wos-*
// CLI shims that run on the app's own executable (no system Node). Calc is not
// checked here: LibreOffice 25.8+ renders Calc tiles black on Windows (#2).
//
//   node e2e/lok-packaged-windows.mjs <fixtures-dir>
//
// WOS_E2E_APP points at an installed app instead of release/win-unpacked.
// WOS_E2E_EXPECT=claude,python also requires the app to find Claude Code and to
// build its Python env (the docs/WINDOWS.md install, checked by CI).
import { _electron as electron } from 'playwright'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
process.env.WOS_START_ON ??= 'stage'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const APP = process.env.WOS_E2E_APP || path.join(root, 'release', 'win-unpacked', 'Workspace OS.exe')
const EXPECT = new Set((process.env.WOS_E2E_EXPECT || '').split(',').map((s) => s.trim()).filter(Boolean))
const FIXTURES = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'wos-fixtures'))
const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-userdata-'))
const SHOTS = path.join(root, 'e2e', 'shots-windows')

if (process.platform !== 'win32') { console.log('SKIP: windows only'); process.exit(0) }
if (!fs.existsSync(APP)) {
  if (process.env.WOS_E2E_APP) { console.log(`FAIL: no app at ${APP}`); process.exit(1) }
  console.log(`SKIP: packaged app not found at ${APP} (run electron-builder --win)`); process.exit(0)
}
fs.mkdirSync(SHOTS, { recursive: true })

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const lo = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'LibreOffice', 'program')
ok(fs.existsSync(path.join(lo, 'mergedlo.dll')) || fs.existsSync(path.join(lo, 'sofficeapp.dll')), `LibreOffice installed in ${lo}`)
ok(fs.existsSync(path.join(path.dirname(APP), 'resources', 'lok', 'wos-lok-host.exe')), 'bundled wos-lok-host.exe present')

const env = { ...process.env, WORKSPACE_TEST_ROOT: FIXTURES, WOS_USERDATA_DIR: USERDATA }
for (const k of ['WOS_LOK_INSTALL', 'WOS_LOK_FUND', 'WOS_LOK_HOST']) delete env[k]

const app = await electron.launch({ executablePath: APP, args: [], env })
const win = await app.firstWindow()
win.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`))
await win.waitForLoadState('domcontentloaded')
await win.waitForSelector('#root', { timeout: 30000 })
for (let i = 0; i < 40 && (await win.$('[class*="_splash_"]')); i++) {
  await win.keyboard.press('Enter').catch(() => {})
  await win.waitForTimeout(300)
}
await win.screenshot({ path: path.join(SHOTS, 'launch.png') })
ok(true, 'app window up')
const frame = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return { full: w.isFullScreen(), max: w.isMaximized() } })
ok(!frame.full && frame.max, `opens maximised, not full screen (${JSON.stringify(frame)})`)

async function renders(name) {
  await win.getByText(name).first().click()
  for (let i = 0; i < 90; i++) {
    const inked = await win.evaluate(() => {
      const c = [...document.querySelectorAll('canvas[class*="_page_"]')].find((el) => el.offsetParent)
      if (!c || c.width < 100) return false
      const d = c.getContext('2d').getImageData(0, 0, c.width, Math.min(c.height, 400)).data
      let ink = 0
      for (let p = 0; p < d.length; p += 4) if (d[p] < 120 && d[p + 1] < 120 && d[p + 2] < 120) ink++
      return ink > 50 && ink < (d.length / 4) * 0.98
    }).catch(() => false)
    const pending = await win.getByText(/^Rendering/).first().isVisible().catch(() => false)
    if (inked && !pending) return true
    await win.waitForTimeout(500)
  }
  return false
}

for (const name of ['test-document.docx', 'test-deck.pptx']) {
  if (!fs.existsSync(path.join(FIXTURES, name))) { console.log(`  skip ${name} (no fixture)`); continue }
  ok(await renders(name), `renders ${name} live from the installed LibreOffice`)
  await win.screenshot({ path: path.join(SHOTS, `${name.replace(/\W+/g, '-')}.png`) })
}

// The app finds Claude Code and warms its Python env in the background at startup.
if (EXPECT.size) {
  let status = null
  for (let i = 0; i < 120; i++) {
    status = await win.evaluate(() => window.workspace.system.status()).catch(() => null)
    if (status && (!EXPECT.has('python') || status.python)) break
    await win.waitForTimeout(2000)
  }
  if (EXPECT.has('claude')) ok(!!status?.claude?.ok, `finds Claude Code (${status?.claude?.path ?? 'not found'})`)
  if (EXPECT.has('python')) ok(!!status?.python, 'built its Python env for document generation')
}

await app.close()

const bin = path.join(USERDATA, 'bin')
for (const shim of ['wos-metric.cmd', 'wos-metric', 'wos-case.cmd', 'wos-action.cmd', 'wos-gen.cmd', 'wos-mcp-token.cmd']) {
  ok(fs.existsSync(path.join(bin, shim)), `shim installed: ${shim}`)
}
try {
  const out = execFileSync('cmd.exe', ['/d', '/c', path.join(bin, 'wos-metric.cmd'), 'list', '--json'], { encoding: 'utf8', env: { ...process.env, WOS_USERDATA_DIR: USERDATA }, timeout: 60000 })
  ok(/^\s*[[{]/.test(out), `wos-metric.cmd runs on the app executable (${out.trim().slice(0, 60)})`)
} catch (e) {
  ok(false, `wos-metric.cmd runs on the app executable: ${(e.stderr || e.message || '').toString().slice(0, 300)}`)
}

console.log(`\nWINDOWS PACKAGED: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
