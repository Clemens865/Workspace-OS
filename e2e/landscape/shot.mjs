/**
 * Screenshot helper for the landscape shell (design review, not a test).
 *   node e2e/landscape/shot.mjs <out-dir> [steps]
 * steps: comma list of overview | agent | menu | stage | grid (default: overview,agent,menu)
 */
import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'
import { killAll } from '../office/_harness.mjs'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')
const out = process.argv[2] ?? '/tmp'
const steps = (process.argv[3] ?? 'overview,agent,menu').split(',')

await killAll()
const app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root })
const win = await app.firstWindow({ timeout: 20000 })
win.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`))
win.on('console', (m) => m.type() === 'error' && console.log(`  [console] ${m.text()}`))
await win.waitForSelector('#root', { timeout: 20000 })
await win.evaluate(() => {
  const K = 'workspace-os:settings'
  let c = {}
  try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* fresh */ }
  localStorage.setItem(K, JSON.stringify({ ...c, newShell: true, landscapeShell: true, terminalOpen: false }))
})
await win.reload()
await win.waitForSelector('[data-shell="landscape"]', { timeout: 20000 })
for (let i = 0; i < 40 && (await win.$('[class*="_splash_"]')); i++) {
  await win.keyboard.press('Enter').catch(() => {})
  await win.waitForTimeout(400)
}
await win.waitForTimeout(1500)
try {
  for (const s of steps) {
    if (s === 'agent') {
      // The screen nearest the middle of the window (the row's ends sit off-screen).
      const pt = await win.evaluate(() => {
        const faces = [...document.querySelectorAll('[data-testid="agent-face"]')].map((f) => f.getBoundingClientRect())
        const cx = innerWidth / 2
        const r = faces.filter((b) => b.width > 40).sort((a, b) => Math.abs(a.left + a.width / 2 - cx) - Math.abs(b.left + b.width / 2 - cx))[0]
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      })
      await win.mouse.click(pt.x, pt.y)
      await win.waitForTimeout(1600)
    } else if (s === 'menu') {
      await win.keyboard.press('Escape')
      await win.waitForTimeout(500)
      await win.click('[data-dock="menu"]')
      await win.waitForTimeout(1200)
    } else if (s === 'overview') {
      await win.click('[data-dock="overview"]').catch(() => {})
      await win.waitForTimeout(1200)
    }
    await win.screenshot({ path: path.join(out, `landscape-${s}.png`) })
    console.log(`  shot ${s}`)
  }
} finally {
  await win.evaluate(() => {
    const K = 'workspace-os:settings'
    let c = {}
    try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* ignore */ }
    localStorage.setItem(K, JSON.stringify({ ...c, landscapeShell: false }))
  }).catch(() => {})
  await app.close()
}
