/**
 * Landscape phase 0 exit test (docs/landscape/PLAN.md): the real app boots in
 * all three shells, Settings → Design switches between them, and the landscape
 * chunk brings its own fonts and token scope.
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

await killAll()
const app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root })
const win = await app.firstWindow({ timeout: 20000 })
win.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`))
await win.waitForSelector('#root', { timeout: 20000 })

/** Write the two shell flags, reload, and let the shell mount. */
const useShell = async (flags) => {
  await win.evaluate((f) => {
    const K = 'workspace-os:settings'
    let c = {}
    try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* corrupt: start fresh */ }
    localStorage.setItem(K, JSON.stringify({ ...c, ...f }))
  }, flags)
  await win.reload()
  await win.waitForSelector('#root', { timeout: 20000 })
  await win.waitForTimeout(1600)
}
const rootHasContent = () => win.evaluate(() => (document.getElementById('root')?.children.length ?? 0) > 0)

try {
  // 1. Landscape
  await useShell({ landscapeShell: true, newShell: true })
  const land = await win.waitForSelector('[data-shell="landscape"]', { timeout: 15000 }).catch(() => null)
  check('landscape shell mounts', !!land)
  const scoped = await win.evaluate(() => {
    const el = document.querySelector('[data-shell="landscape"]')
    if (!el) return null
    const cs = getComputedStyle(el)
    return { ink: cs.getPropertyValue('--wl-ink').trim(), font: cs.fontFamily }
  })
  check('.wl token scope applies', scoped?.ink === '#1b2730', JSON.stringify(scoped))
  await win.evaluate(() => document.fonts.ready)
  const fonts = await win.evaluate(() => ({
    serif: document.fonts.check('44px Newsreader'),
    sans: document.fonts.check('15px Inter'),
  }))
  check('Newsreader and Inter are bundled and load', fonts.serif && fonts.sans, JSON.stringify(fonts))

  // Menu opens Settings, and Settings → Design offers the landscape option.
  await dismissSplash(win)
  await win.click('[data-dock="menu"]')
  await win.waitForTimeout(600)
  await win.click('[data-menu="settings"]')
  const option = await win.waitForSelector('[data-testid="shell-landscape"]', { timeout: 5000 }).catch(() => null)
  check('Menu → Settings shows the shell switch', !!option)
  await win.keyboard.press('Escape')
  await win.waitForTimeout(400)
  await win.click('[data-testid="stage-landscape"]')
  await win.waitForTimeout(600)

  // 2. Back to the current shell from inside the landscape.
  await win.click('[data-testid="landscape-exit"]')
  await win.waitForTimeout(1200)
  const current = await win.evaluate(() => !document.querySelector('[data-shell="landscape"]') && !!document.querySelector('[data-expanded]'))
  check('"Back to the current shell" lands in WorkspaceShell', current)

  // 3. Classic still boots.
  await useShell({ landscapeShell: false, newShell: false })
  check('classic shell boots', (await rootHasContent()) && !(await win.$('[data-shell="landscape"]')))
} finally {
  // Leave the default behind: the new shell, landscape off.
  await useShell({ landscapeShell: false, newShell: true }).catch(() => {})
  await app.close()
}

console.log(`\n${total - fails}/${total} passed`)
process.exit(fails ? 1 : 0)
