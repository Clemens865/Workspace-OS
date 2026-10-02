/**
 * Landscape phase 1 exit test (docs/landscape/PLAN.md §7): the flat stage.
 *
 * - every real rail surface is reachable in two actions (dock Menu → item),
 *   lands on the stage with that surface active, and the stage's Landscape
 *   button returns to where the user was;
 * - ⌘K and ⌘P open over the landscape; ⌘J brings the stage forward with the
 *   terminal dock; ⌘B shows the stage's rail;
 * - the dock's Inbox opens the landscape Inbox; Cases / Library open their stand-in surfaces.
 *
 * Every check reads real state: which layer is visible (computed visibility),
 * which rail button is current, whether an element has a non-zero box.
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
await win.evaluate(() => {
  const K = 'workspace-os:settings'
  let c = {}
  try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* start fresh */ }
  localStorage.setItem(K, JSON.stringify({ ...c, newShell: true, landscapeShell: true, terminalOpen: false }))
})
await win.reload()
await win.waitForSelector('[data-shell="landscape"]', { timeout: 20000 })
// The startup splash covers the window for a moment; wait it out.
await dismissSplash(win)
await win.waitForTimeout(600)

const state = () =>
  win.evaluate(() => {
    const layer = document.querySelector('[data-testid="landscape-layer"]')
    const rail = document.querySelector('nav[aria-label="Primary"] [aria-current="page"]')
    return {
      view: document.querySelector('[data-shell="landscape"]')?.getAttribute('data-view'),
      landscapeVisible: !!layer && getComputedStyle(layer).visibility === 'visible',
      rail: rail?.getAttribute('title') ?? null,
    }
  })
const settle = () => win.waitForTimeout(650)
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

try {
  let s = await state()
  check('opens on the overview, landscape visible', s.view === 'overview' && s.landscapeVisible, JSON.stringify(s))

  // ── Menu → every surface ──
  const items = await (async () => {
    await win.click('[data-dock="menu"]')
    await settle()
    return win.$$eval('[data-menu]', (els) => els.map((e) => ({ rail: e.getAttribute('data-menu'), label: e.querySelector('span')?.textContent })))
  })()
  check('Menu lists the surfaces', items.length >= 11, `${items.length} items`)

  for (const it of items) {
    if ((await state()).view !== 'menu') {
      await win.click('[data-dock="menu"]')
      await settle()
    }
    await win.click(`[data-menu="${it.rail}"]`)
    await settle()
    s = await state()
    const ok = s.view === 'stage' && !s.landscapeVisible && s.rail === it.label
    check(`Menu → ${it.label} opens it on the stage`, ok, JSON.stringify(s))
    // Settings is a modal on the stage; close it the way a user would.
    if (it.rail === 'settings') await win.keyboard.press('Escape')
    await win.click('[data-testid="stage-landscape"]')
    await settle()
    s = await state()
    check(`Landscape button returns from ${it.label}`, s.view === 'menu' && s.landscapeVisible, JSON.stringify(s))
  }

  // ── Dock stand-ins ──
  await win.click('[data-dock="inbox"]')
  await settle()
  s = await state()
  check('dock inbox opens the Inbox in the landscape', s.view === 'inbox' && s.landscapeVisible, JSON.stringify(s))
  for (const [dock, label] of [['cases', 'Cockpit'], ['library', 'Knowledge']]) {
    await win.click(`[data-dock="${dock}"]`)
    await settle()
    s = await state()
    check(`dock ${dock} opens ${label} on the stage`, s.view === 'stage' && s.rail === label, JSON.stringify(s))
    await win.click('[data-testid="stage-landscape"]')
    await settle()
  }
  await win.click('[data-dock="overview"]')
  await settle()

  // ── Shortcuts from the landscape ──
  await win.keyboard.press(`${mod}+k`)
  await win.waitForTimeout(300)
  const cmdk = await win.$('input[placeholder="Search files and document contents…"]')
  check('⌘K opens the command bar over the landscape', !!cmdk && (await cmdk.isVisible()))
  await win.keyboard.press('Escape')
  await win.waitForTimeout(250)
  if (await win.$('input[placeholder="Search files and document contents…"]')) await win.keyboard.press(`${mod}+k`)

  await win.keyboard.press(`${mod}+p`)
  await win.waitForTimeout(300)
  const qo = await win.$('input[placeholder="Go to file…"]')
  check('⌘P opens Quick Open over the landscape', !!qo && (await qo.isVisible()))
  await win.keyboard.press('Escape')
  await win.waitForTimeout(250)
  if (await win.$('input[placeholder="Go to file…"]')) await win.keyboard.press(`${mod}+p`)

  await win.keyboard.press(`${mod}+j`)
  await settle()
  s = await state()
  const dockBox = await win.evaluate(() => {
    const d = document.querySelector('[data-testid="terminal-dock"]')
    const r = d?.getBoundingClientRect()
    return r ? Math.round(r.width * r.height) : 0
  })
  check('⌘J brings the stage forward with the terminal dock', s.view === 'stage' && dockBox > 0, `${JSON.stringify(s)} dock area ${dockBox}`)
  await win.keyboard.press(`${mod}+j`)
  await win.waitForTimeout(300)

  // ── ⌘B on the stage shows its rail ──
  const railWidth = () =>
    win.evaluate(() => {
      const r = document.querySelector('nav[aria-label="Primary"]')?.getBoundingClientRect()
      const op = document.querySelector('nav[aria-label="Primary"]')
      return r && op ? Math.round(r.right) * (getComputedStyle(op).opacity === '0' ? 0 : 1) : 0
    })
  const before = await railWidth()
  await win.keyboard.press(`${mod}+b`)
  await win.waitForTimeout(700)
  const after = await railWidth()
  check('⌘B shows the stage rail (hidden by default)', before <= 0 && after > 40, `before ${before}, after ${after}`)
} finally {
  await win.evaluate(() => {
    const K = 'workspace-os:settings'
    let c = {}
    try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* ignore */ }
    localStorage.setItem(K, JSON.stringify({ ...c, landscapeShell: false, newShell: true, terminalOpen: false }))
  }).catch(() => {})
  await app.close()
}

console.log(`\n${total - fails}/${total} passed`)
process.exit(fails ? 1 : 0)
