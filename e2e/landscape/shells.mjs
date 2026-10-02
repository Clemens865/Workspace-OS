/**
 * Landscape phase 7 (docs/landscape/PLAN.md §2, §7): the landscape is the only
 * shell. The app boots into it with no setting; its fonts and token scope
 * load; Settings offers "Open on: Landscape | Stage" and the graphics quality,
 * not a shell switch; "Open on: Stage" (and the test hook WOS_START_ON) opens
 * on the flat stage, whose Landscape button leads back.
 *
 * Run: npm run e2e:landscape
 */
import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'
import { killAll } from '../office/_harness.mjs'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')

/** The startup splash waits for Enter (or its button); dismiss it as a user would. */
async function dismissSplash(win) {
  for (let i = 0; i < 40; i++) {
    if (!(await win.$('[class*="_splash_"]'))) return
    await win.keyboard.press('Enter').catch(() => {})
    await win.waitForTimeout(400)
  }
}

let fails = 0
let total = 0
const check = (n, c, d) => {
  total++
  if (c) console.log(`  PASS  ${n}`)
  else {
    console.error(`  FAIL  ${n}${d ? ` — ${d}` : ''}`)
    fails++
  }
}

const env = { ...process.env }
delete env.WOS_START_ON
await killAll()
let app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root, env })
let win = await app.firstWindow({ timeout: 20000 })
win.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`))
await win.waitForSelector('#root', { timeout: 20000 })

const setSettings = (o) =>
  win.evaluate((o) => {
    const K = 'workspace-os:settings'
    let c = {}
    try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* fresh */ }
    localStorage.setItem(K, JSON.stringify({ ...c, ...o }))
  }, o)
const view = () => win.getAttribute('[data-shell="landscape"]', 'data-view')

try {
  // Old shell flags left behind by earlier versions must not matter.
  await setSettings({ newShell: false, landscapeShell: false, startOn: 'landscape' })
  await win.reload()
  const land = await win.waitForSelector('[data-shell="landscape"]', { timeout: 15000 }).catch(() => null)
  check('boots into the landscape, whatever old shell flags say', !!land && (await view()) === 'overview')
  const scoped = await win.evaluate(() => getComputedStyle(document.querySelector('[data-shell="landscape"]')).getPropertyValue('--wl-ink').trim())
  check('.wl token scope applies', scoped === '#1b2730', scoped)
  await win.evaluate(() => document.fonts.ready)
  const fonts = await win.evaluate(() => ({ serif: document.fonts.check('44px Newsreader'), sans: document.fonts.check('15px Inter') }))
  check('Newsreader and Inter are bundled and load', fonts.serif && fonts.sans, JSON.stringify(fonts))
  check('there is no "back to the current shell"', !(await win.$('[data-testid="landscape-exit"]')))

  await dismissSplash(win)
  await win.click('[data-dock="menu"]')
  await win.waitForTimeout(600)
  await win.click('[data-menu="settings"]')
  await win.waitForSelector('[data-testid="start-stage"]', { timeout: 5000 })
  check('Settings offers "Open on", not a shell switch', !!(await win.$('[data-testid="start-landscape"]')) && !(await win.$('[data-testid="shell-landscape"]')))
  check('…and the landscape graphics quality', !!(await win.$('[data-testid="landscape-quality-auto"]')))
  await win.click('[data-testid="start-stage"]')
  await win.keyboard.press('Escape')
  await win.waitForTimeout(400)

  await win.reload()
  await win.waitForSelector('[data-shell="landscape"]', { timeout: 15000 })
  await win.waitForTimeout(800)
  check('"Open on: Stage" opens on the stage', (await view()) === 'stage')
  await dismissSplash(win)
  await win.click('[data-testid="stage-landscape"]')
  await win.waitForTimeout(700)
  check("the stage's Landscape button leads to the landscape", (await view()) === 'overview')
  await setSettings({ startOn: 'landscape' })
  await win.waitForTimeout(800) // localStorage reaches disk asynchronously
  await app.close()

  // The test hook: WOS_START_ON=stage opens on the stage regardless of the setting.
  app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root, env: { ...env, WOS_START_ON: 'stage' } })
  win = await app.firstWindow({ timeout: 20000 })
  await win.waitForSelector('[data-shell="landscape"]', { timeout: 20000 })
  await win.waitForTimeout(1200)
  check('WOS_START_ON=stage opens on the stage (e2e hook)', (await view()) === 'stage')
} finally {
  await setSettings({ startOn: 'landscape' }).catch(() => {})
  await win.waitForTimeout(800).catch(() => {})
  await app.close()
}

console.log(`\n${total - fails}/${total} passed`)
process.exit(fails ? 1 : 0)
