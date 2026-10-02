/**
 * Dark mode (real app): the theme setting, the night landscape, and every
 * surface in dark materials.
 *
 * - Settings → Theme → Dark sets the theme and keeps it.
 * - The WebGL landscape is night: real window pixels (captured by main) are
 *   dark where the light theme's sky is bright, and bright again in Light.
 * - Every stage surface, and the landscape views, wear dark materials: no
 *   visible chrome panel is still a bright light-theme fill. Documents and web
 *   pages keep their own colours by design (webview contents are not in this
 *   DOM; office canvases and xterm are exempt).
 * - Match macOS follows the system setting.
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

const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wos-dark-')))
fs.writeFileSync(path.join(ws, 'Notes.md'), '# Notes\n')
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
  localStorage.setItem(K, JSON.stringify({ ...c, startOn: 'landscape', terminalOpen: false, landscapeQuality: 'full' }))
  localStorage.setItem('workspace-os:theme', 'light')
})
await win.reload()
await win.waitForSelector('[data-shell="landscape"]', { timeout: 20000 })
for (let i = 0; i < 40 && (await win.$('[class*="_splash_"]')); i++) {
  await win.keyboard.press('Enter').catch(() => {})
  await win.waitForTimeout(400)
}
await win.waitForTimeout(1500)
const settle = (ms = 800) => win.waitForTimeout(ms)
const theme = () => win.evaluate(() => document.documentElement.getAttribute('data-theme'))

/** Mean luminance (0..1) of a small patch of the real window, captured by main. */
const lum = (x, y) =>
  app.evaluate(async ({ BrowserWindow }, { x, y }) => {
    const w = BrowserWindow.getAllWindows()[0]
    const img = await w.webContents.capturePage({ x, y, width: 12, height: 12 })
    const b = img.toBitmap() // BGRA
    let s = 0
    for (let i = 0; i < b.length; i += 4) s += (0.0722 * b[i] + 0.7152 * b[i + 1] + 0.2126 * b[i + 2]) / 255
    return s / (b.length / 4)
  }, { x, y })

/** Visible chrome painted in a bright light-theme fill (documents, terminals and pages exempt). */
const brightPanels = () =>
  win.evaluate(() => {
    const probe = document.createElement('i')
    probe.style.color = 'var(--wl-ink)'
    document.querySelector('.wl')?.appendChild(probe)
    const ink = getComputedStyle(probe).color.match(/\d+/g).slice(0, 3).join(',')
    probe.remove()
    const EXEMPT = /lok|Lok|canvas|Canvas|xterm|monaco|Pdf|pdf|Image|Media|Tldraw|thumb|Thumb|webview|Swatch|swatch|preview|Preview|avatar|Avatar/
    const hits = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width < 24 || r.height < 16) continue
      const s = getComputedStyle(el)
      if (s.visibility !== 'visible' || s.display === 'none' || Number(s.opacity) < 0.5) continue
      const m = s.backgroundColor.match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/)
      if (!m) continue
      const [r0, g0, b0, a = 1] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])]
      if (a < 0.5) continue
      const l = (0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0) / 255
      if (l < 0.78) continue
      let p = el
      let exempt = false
      while (p) {
        if (EXEMPT.test(typeof p.className === 'string' ? p.className : '') || p.tagName === 'WEBVIEW') { exempt = true; break }
        p = p.parentElement
      }
      if (exempt) continue
      // Small badges, and primary buttons filled with the ink colour (light ink in the dark), are meant to be light.
      if (r.width * r.height < 4000) continue
      if (`${r0},${g0},${b0}` === ink) continue
      hits.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0].slice(0, 36)} ${s.backgroundColor}`)
    }
    return [...new Set(hits)].slice(0, 5)
  })

try {
  // ── the light sky, measured, before switching ──
  const skyLight = await lum(700, 230)
  check('in Light, the landscape sky is bright', skyLight > 0.7, skyLight.toFixed(2))

  // ── Settings → Dark ──
  await win.click('[data-dock="menu"]')
  await settle()
  await win.click('[data-menu="settings"]')
  await win.waitForSelector('[data-testid="settings-panel"]', { timeout: 6000 })
  await win.click('[data-testid="theme-dark"]')
  await settle(400)
  check('Settings → Dark switches the theme', (await theme()) === 'dark')
  check('…and keeps it', (await win.evaluate(() => localStorage.getItem('workspace-os:theme'))) === 'dark')
  const settingsBright = await brightPanels()
  check('Settings itself is dark', settingsBright.length === 0, settingsBright.join(' | '))
  await win.keyboard.press('Escape')
  await settle(400)
  await win.click('[data-testid="stage-landscape"]')
  await settle(2200) // the night eases in

  // ── the night landscape, measured ──
  const skyDark = await lum(700, 230)
  check('in Dark, the landscape is night (real pixels)', skyDark < 0.3, skyDark.toFixed(2))
  const overviewBright = await brightPanels()
  check('the landscape views are dark', overviewBright.length === 0, overviewBright.join(' | '))
  await win.click('[data-switch="today"]')
  await settle(1200)
  const todayBright = await brightPanels()
  check('today: dark', todayBright.length === 0, todayBright.join(' | '))
  for (const d of ['inbox', 'cases', 'library']) {
    await win.click(`[data-dock="${d}"]`)
    await settle(1000)
    const b = await brightPanels()
    check(`${d}: dark`, b.length === 0, b.join(' | '))
  }

  // ── every stage surface ──
  await win.click('[data-dock="menu"]')
  await settle()
  const rails = await win.$$eval('[data-menu]', (els) => els.map((e) => e.getAttribute('data-menu')))
  for (const r of rails) {
    if (r === 'home') continue // Today, a landscape view
    await win.click('[data-dock="menu"]').catch(() => {})
    await settle(600)
    await win.click(`[data-menu="${r}"]`)
    await settle(1400)
    const b = await brightPanels()
    check(`${r}: dark`, b.length === 0, b.join(' | '))
    if (r === 'settings') await win.keyboard.press('Escape')
    await win.click('[data-testid="stage-landscape"]').catch(() => {})
    await settle(500)
  }

  // ── Match macOS ──
  await win.evaluate(() => {
    localStorage.setItem('workspace-os:theme', 'system')
  })
  await win.emulateMedia({ colorScheme: 'light' })
  await win.reload()
  await win.waitForSelector('[data-shell="landscape"]', { timeout: 20000 })
  check('Match macOS follows a light system', (await theme()) === 'light', await theme())
  await win.emulateMedia({ colorScheme: 'dark' })
  await settle(600)
  check('…and switches live when the system goes dark', (await theme()) === 'dark', await theme())
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
