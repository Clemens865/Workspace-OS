#!/usr/bin/env node
/**
 * The window style (Settings → Appearance → Window) on a packaged Windows or
 * Linux app, as a person uses it: choose Clean, restart, point at the top
 * edge, use the bar, move away.
 *
 *   node e2e/window-style.mjs <app executable>
 *
 * Exit 1 on any failed check. macOS has no window style and is skipped.
 */
import { _electron as electron } from 'playwright'
import fs from 'fs'
import os from 'os'
import path from 'path'

if (process.platform === 'darwin') { console.log('SKIP: macOS keeps its own window'); process.exit(0) }
const exe = process.argv[2]
if (!exe || !fs.existsSync(exe)) { console.error(`app not found: ${exe}`); process.exit(2) }
const OUT = path.resolve('e2e/shots-window-style')
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-winstyle-ud-'))
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-winstyle-ws-'))
fs.writeFileSync(path.join(WS, 'README.md'), '# Test workspace\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const failures = []
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const env = { ...process.env, WOS_USERDATA_DIR: UD, WORKSPACE_TEST_ROOT: WS, WOS_NO_TIDY: '1' }
delete env.WOS_WINDOW_STYLE

async function launch() {
  const app = await electron.launch({ executablePath: exe, args: process.platform === 'linux' ? ['--no-sandbox'] : [], env })
  const win = await app.firstWindow({ timeout: 90000 })
  await win.waitForSelector('#root', { timeout: 90000 })
  let clear = 0
  for (let i = 0; i < 150 && clear < 6; i++) {
    if (await win.$('[class*="_splash_"]')) {
      clear = 0
      await win.keyboard.press('Enter').catch(() => {})
      await win.getByRole('button', { name: /^Enter$/ }).first().click({ timeout: 500 }).catch(() => {})
    } else clear++
    await sleep(300)
  }
  return { app, win }
}

try {
  // 1. Standard by default; choose Clean in Settings.
  let { app, win } = await launch()
  check((await win.evaluate(() => window.workspace.window.style())).current === 'standard', 'a new install opens with the standard window')
  check((await win.locator('[data-testid="clean-titlebar-zone"]').count()) === 0, 'no clean title bar in the standard style')
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('wos:open-rail', { detail: { rail: 'settings' } })))
  const section = win.locator('[data-testid="settings-window"]')
  await section.waitFor({ timeout: 20000 })
  await section.scrollIntoViewIfNeeded()
  await win.locator('[data-testid="window-style-clean"]').click()
  await win.locator('[data-testid="window-style-restart"]').waitFor({ timeout: 5000 }).catch(() => {})
  check((await win.locator('[data-testid="window-style-restart"]').count()) === 1, 'choosing Clean offers Restart now')
  const saved = JSON.parse(fs.readFileSync(path.join(UD, 'host-settings.json'), 'utf-8'))
  check(saved.windowStyle === 'clean', 'the choice is stored in host-settings.json')
  check((await win.locator('[data-testid="window-taskbar-settings"]').count()) === (process.platform === 'win32' ? 1 : 0), 'the taskbar settings button shows on Windows only')
  await win.screenshot({ path: path.join(OUT, '1-settings.png') })
  await app.close()

  // 2. After the restart: no title bar until the pointer reaches the top edge.
  ;({ app, win } = await launch())
  check((await win.evaluate(() => window.workspace.window.style())).current === 'clean', 'the restarted window has the clean style')
  const bar = win.locator('[data-testid="clean-titlebar"]')
  check((await bar.count()) === 0, 'the bar is hidden at first')
  await win.mouse.move(400, 300)
  await win.mouse.move(400, 1, { steps: 5 })
  await bar.waitFor({ timeout: 3000 }).catch(() => {})
  check((await bar.count()) === 1, 'pointing at the top edge shows the bar')
  for (const name of ['Minimise', 'Close']) check((await bar.getByRole('button', { name }).count()) === 1, `the bar has ${name}`)
  check((await bar.getByRole('button', { name: /^(Maximise|Restore)$/ }).count()) === 1, 'the bar has Maximise or Restore')
  await win.screenshot({ path: path.join(OUT, '2-bar.png') })
  if (process.platform === 'win32') {
    const before = await win.evaluate(() => window.workspace.window.isMaximized())
    await bar.getByRole('button', { name: /^(Maximise|Restore)$/ }).click()
    await sleep(800)
    check((await win.evaluate(() => window.workspace.window.isMaximized())) !== before, 'Maximise/Restore changes the window')
    await win.evaluate(() => window.workspace.window.maximize())
  }
  await win.mouse.move(400, 300, { steps: 5 })
  await win.mouse.move(420, 320)
  for (let i = 0; i < 20 && (await bar.count()); i++) await sleep(200)
  check((await bar.count()) === 0, 'moving down into the app hides the bar')
  await win.screenshot({ path: path.join(OUT, '3-hidden.png') })
  await app.close()
} catch (err) {
  failures.push(String(err))
  console.error(err)
}
console.log(failures.length ? `${failures.length} check(s) failed` : 'all checks passed')
process.exit(failures.length ? 1 : 0)
