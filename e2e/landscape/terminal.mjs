/**
 * The floating terminal and the one dock (real app).
 *
 * - The dock is one component in two places: the landscape's glass dock and
 *   the stage top bar carry the same items, Terminal included; the stage has
 *   no second "Home" (Home is Today).
 * - The terminal floats: it opens over the landscape without leaving it, can
 *   be moved and resized (and remembers where), snaps to the right edge to
 *   dock, and floats again; a shell typed into keeps its session through
 *   every move (the output stays, nothing restarts).
 *
 * Run: npm run e2e:landscape
 */
import { _electron as electron } from 'playwright'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { killAll } from '../office/_harness.mjs'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')

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

const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wos-term-')))
await killAll()
const app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root, env: { ...process.env, WORKSPACE_TEST_ROOT: ws } })
const win = await app.firstWindow({ timeout: 20000 })
win.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`))
await win.waitForSelector('#root', { timeout: 20000 })
const saved = await win.evaluate(() => JSON.stringify({ ...localStorage }))
await win.evaluate(() => {
  const K = 'workspace-os:settings'
  let c = {}
  try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* fresh */ }
  localStorage.setItem(K, JSON.stringify({ ...c, startOn: 'landscape', terminalOpen: false, terminalMinimized: false, terminalPlacement: 'float', terminalFloat: null }))
})
await win.reload()
await win.waitForSelector('[data-shell="landscape"]', { timeout: 20000 })
for (let i = 0; i < 40 && (await win.$('[class*="_splash_"]')); i++) {
  await win.keyboard.press('Enter').catch(() => {})
  await win.waitForTimeout(400)
}
await win.waitForTimeout(1000)
const settle = (ms = 700) => win.waitForTimeout(ms)
const view = () => win.getAttribute('[data-shell="landscape"]', 'data-view')
const box = (sel) => win.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null }, sel)
const termText = () => win.evaluate(() => [...document.querySelectorAll('[data-testid="terminal-dock"] .xterm-rows')].map((e) => e.textContent).join('\n'))
const settings = () => win.evaluate(() => JSON.parse(localStorage.getItem('workspace-os:settings') || '{}'))

try {
  // ── one dock, two places ──
  const items = (sel) => win.$$eval(sel, (els) => els.map((e) => e.textContent.replace(/\d+$/, '').trim()))
  const land = await items('[data-testid="landscape-dock"] button')
  check('the landscape dock carries the five places and the Terminal', land.join(',') === 'Overview,Inbox,Cases,Library,Menu,Terminal', land.join(','))

  // ── the terminal floats over the landscape ──
  await win.click('[data-dock="terminal"]')
  await win.waitForSelector('[data-testid="terminal-float"]', { timeout: 6000 }).catch(() => {})
  check('the dock’s Terminal opens a floating terminal', !!(await win.$('[data-testid="terminal-float"]')))
  check('…without leaving the landscape', (await view()) === 'overview', await view())
  const f0 = await box('[data-testid="terminal-float"]')
  const onTop = await win.evaluate((b) => {
    const el = document.elementFromPoint(b.x + b.w / 2, b.y + b.h / 2)
    return !!el?.closest('[data-testid="terminal-float"]')
  }, f0)
  check('…on top of the landscape, and reachable', onTop)

  // A shell session, typed into.
  await win.waitForSelector('[data-testid="terminal-dock"] .xterm-rows', { timeout: 8000 })
  await settle(1200)
  await win.click('[data-testid="terminal-float"] .xterm-screen')
  await win.keyboard.type('echo wos-$((6*7))')
  await win.keyboard.press('Enter')
  await settle(1200)
  check('the floating shell runs commands', (await termText()).includes('wos-42'))

  // ── move and resize ──
  const bar = await box('[data-testid="terminal-float-bar"]')
  await win.mouse.move(bar.x + 60, bar.y + bar.h / 2)
  await win.mouse.down()
  await win.mouse.move(bar.x + 60 - 200, bar.y + bar.h / 2 - 80, { steps: 8 })
  await win.mouse.up()
  await settle()
  const f1 = await box('[data-testid="terminal-float"]')
  check('dragging the title bar moves the window', Math.abs(f1.x - (f0.x - 200)) <= 2 && Math.abs(f1.y - (f0.y - 80)) <= 12, `${JSON.stringify(f0)} → ${JSON.stringify(f1)}`)
  const se = await box('[data-testid="terminal-float"] [data-handle="se"]')
  await win.mouse.move(se.x + se.w / 2, se.y + se.h / 2)
  await win.mouse.down()
  await win.mouse.move(se.x + se.w / 2 + 120, se.y + se.h / 2 + 60, { steps: 8 })
  await win.mouse.up()
  await settle()
  const f2 = await box('[data-testid="terminal-float"]')
  check('dragging a corner resizes it', Math.abs(f2.w - (f1.w + 120)) <= 2 && Math.abs(f2.h - (f1.h + 60)) <= 2 && f2.x === f1.x && f2.y === f1.y, `${JSON.stringify(f1)} → ${JSON.stringify(f2)}`)
  const stored = (await settings()).terminalFloat
  check('…and remembers where it is', stored && Math.abs(stored.w - f2.w) <= 2 && Math.abs(stored.x - f2.x) <= 2, JSON.stringify(stored))

  // ── ⌘J hides and shows it, still in the landscape ──
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await win.click('[data-dock="overview"]').catch(() => {})
  await win.keyboard.press(`${mod}+j`)
  await settle()
  check('⌘J hides the floating terminal', !(await win.$('[data-testid="terminal-float"]')))
  await win.keyboard.press(`${mod}+j`)
  await settle()
  check('…and brings it back, in the landscape', !!(await win.$('[data-testid="terminal-float"]')) && (await view()) === 'overview')
  await settle(500)
  check('hiding did not end the shell (its output is still there)', (await termText()).includes('wos-42'))

  // ── snap to the right edge: it docks; the session lives on ──
  const bar2 = await box('[data-testid="terminal-float-bar"]')
  const vw = await win.evaluate(() => window.innerWidth)
  await win.mouse.move(bar2.x + 60, bar2.y + bar2.h / 2)
  await win.mouse.down()
  await win.mouse.move(vw - 6, bar2.y + 40, { steps: 10 })
  check('dragging to the right edge offers to dock there', !!(await win.$('[data-testid="terminal-snap"][data-zone="right"]')))
  await win.mouse.up()
  await settle(900)
  check('…and dropping docks it on the right', (await settings()).terminalPlacement === 'right' && !(await win.$('[data-testid="terminal-float"]')))
  check('a docked terminal is on the stage', (await view()) === 'stage' && !!(await box('[data-testid="terminal-dock"]'))?.w)
  check('…the same shell, not a new one (its output is still there)', (await termText()).includes('wos-42'))

  await win.click('[data-testid="terminal-float-btn"]')
  await settle(900)
  check('Float undocks it again', !!(await win.$('[data-testid="terminal-float"]')) && (await settings()).terminalPlacement === 'float')
  check('…still the same shell', (await termText()).includes('wos-42'))

  // ── the stage top bar is the same dock; no second Home ──
  const stageItems = await items('[data-testid="stage-nav"] button')
  check('the stage top bar is the same dock', stageItems.join(',') === land.join(','), stageItems.join(','))
  const tabs = await win.$$eval('[class*="_tabs_"] [class*="_tab_"]', (els) => els.map((e) => e.textContent.trim()))
  check('the stage shows no second Home', !tabs.includes('Home'), tabs.join(','))
  await win.click('[data-testid="stage-landscape"]')
  await settle()
  check('the dock’s Overview leads to the team', (await view()) === 'overview')
} catch (e) {
  check('run completed', false, e.message)
} finally {
  await win
    .evaluate((saved) => {
      localStorage.clear()
      for (const [k, v] of Object.entries(JSON.parse(saved))) localStorage.setItem(k, v)
    }, saved)
    .catch(() => {})
  await app.close()
  fs.rmSync(ws, { recursive: true, force: true })
}
console.log(`\n${total - fails}/${total} passed`)
process.exit(fails ? 1 : 0)
