/**
 * Landscape phase 3 exit test (docs/landscape/PLAN.md §3a): the graphics
 * budget, measured on this machine's real GPU with WebGL timer queries.
 *
 *   idle (no input for longer than the drift timeout) → 0 frames
 *   a stage surface open over the landscape          → 0 backdrop frames
 *   scrolling the team                                → ≤ 4 ms GPU per frame
 *   Off                                               → no WebGL at all
 *   reduced motion                                    → Light (no drift)
 *
 * Prints the measured numbers either way, so a pass is a real figure.
 * Run: npm run e2e:landscape
 */
import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'
import { killAll } from '../office/_harness.mjs'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')

const BUDGET_MS = 4
const IDLE_MS = 20_000

let fails = 0
let total = 0
const check = (n, c, d) => {
  total++
  if (c) console.log(`  PASS  ${n}${d ? `  (${d})` : ''}`)
  else {
    console.error(`  FAIL  ${n}${d ? ` — ${d}` : ''}`)
    fails++
  }
}

await killAll()
const app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root })
const win = await app.firstWindow({ timeout: 20000 })
win.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`))
await win.waitForSelector('#root', { timeout: 20000 })

const setSettings = (o) =>
  win.evaluate((o) => {
    const K = 'workspace-os:settings'
    let c = {}
    try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* fresh */ }
    localStorage.setItem(K, JSON.stringify({ ...c, ...o }))
  }, o)
const boot = async () => {
  await win.reload()
  await win.waitForSelector('[data-shell="landscape"]', { timeout: 20000 })
  for (let i = 0; i < 40 && (await win.$('[class*="_splash_"]')); i++) {
    await win.keyboard.press('Enter').catch(() => {})
    await win.waitForTimeout(400)
  }
  await win.waitForTimeout(1500)
}
const perf = (fn) => win.evaluate((f) => {
  const p = window.__landscapePerf
  if (!p) return null
  return { supported: p.supported, frames: p.frames(), avg: p.gpuAvgMs(), max: p.gpuMaxMs(), quality: p.quality(), reset: f === 'reset' ? (p.reset(), true) : false }
}, fn)
const fmt = (n) => (n == null ? 'n/a' : `${n.toFixed(2)} ms`)

try {
  await setSettings({ startOn: 'landscape', landscapeQuality: 'full', terminalOpen: false })
  await boot()
  const p0 = await perf()
  check('the WebGL backdrop is running', !!p0 && (await win.getAttribute('[data-testid="landscape-layer"]', 'data-quality')) === 'full', JSON.stringify(p0))
  console.log(`  info  GPU timer queries ${p0?.supported ? 'available' : 'NOT available on this GPU/driver'}`)

  // ── scrolling: the busiest thing a user does here ──
  await win.mouse.move(760, 460)
  await win.waitForTimeout(300)
  await perf('reset')
  for (let i = 0; i < 24; i++) {
    await win.mouse.wheel(0, i % 12 < 6 ? 14 : -14)
    await win.waitForTimeout(60)
  }
  await win.waitForTimeout(400)
  const busy = await perf()
  check('scrolling draws frames (the loop runs while things move)', busy.frames > 10, `${busy.frames} frames`)
  if (busy.supported) check(`scrolling stays within ${BUDGET_MS} ms GPU per frame`, busy.avg != null && busy.avg <= BUDGET_MS, `avg ${fmt(busy.avg)}, max ${fmt(busy.max)}`)
  else console.log('  SKIP  GPU time: no timer queries on this machine')

  // ── idle: nothing moves, nobody is there ──
  console.log(`  ...   waiting ${Math.round((IDLE_MS + 1500) / 1000)} s without input for the idle check`)
  await win.waitForTimeout(IDLE_MS + 1500)
  await perf('reset')
  await win.waitForTimeout(3000)
  const idle = await perf()
  check('idle: 0 frames', idle.frames === 0, `${idle.frames} frames in 3 s`)

  // ── a stage surface open: the backdrop must stop ──
  await win.click('[data-dock="library"]')
  await win.waitForTimeout(1200)
  await perf('reset')
  await win.mouse.move(500, 500)
  await win.mouse.move(900, 300)
  await win.mouse.wheel(0, 40)
  await win.waitForTimeout(3000)
  const covered = await perf()
  check('with the stage open, 0 backdrop frames (even with input)', covered.frames === 0, `${covered.frames} frames in 3 s`)
  await win.click('[data-testid="stage-landscape"]')
  await win.waitForTimeout(800)

  // ── Off: no WebGL ──
  await setSettings({ landscapeQuality: 'off' })
  await boot()
  const off = await win.evaluate(() => ({ q: document.querySelector('[data-testid="landscape-layer"]')?.getAttribute('data-quality'), perf: !!window.__landscapePerf && document.querySelector('[data-testid="landscape-canvas"]')?.className.includes('canvasOn') }))
  check('Off: flat CSS, no WebGL backdrop', off.q === 'off' && !off.perf, JSON.stringify(off))

  // ── reduced motion → Light ──
  await setSettings({ landscapeQuality: 'auto' })
  await win.emulateMedia({ reducedMotion: 'reduce' })
  await boot()
  const q = await win.getAttribute('[data-testid="landscape-layer"]', 'data-quality')
  check('reduced motion: Auto resolves to Light', q === 'light', q)
  await win.emulateMedia({ reducedMotion: 'no-preference' })
} finally {
  await setSettings({ landscapeQuality: 'auto' }).catch(() => {})
  await app.close()
}

console.log(`\n${total - fails}/${total} passed`)
process.exit(fails ? 1 : 0)
