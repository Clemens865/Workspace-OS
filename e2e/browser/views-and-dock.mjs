/**
 * Files view modes (icon / gallery / column) and terminal hide-vs-minimise.
 *
 * The claim worth testing for minimise is not "the bar appears" — it is that
 * the SESSION SURVIVES. Minimising that killed the shell would be hiding with
 * extra steps, and the user would find out only after losing a running command.
 * So the dock is checked for still being mounted while collapsed.
 *
 * For the view modes, the checks read what each view actually puts on screen
 * rather than which class is set, for the same reason as e2e/browser/layout.mjs.
 */
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { killAll } from '../office/_harness.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')
const WS = '/tmp/wos-views-e2e'

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

fs.rmSync(WS, { recursive: true, force: true })
fs.mkdirSync(path.join(WS, 'Clients', 'Acme'), { recursive: true })
for (const n of ['Report.docx', 'Budget.xlsx', 'notes.md']) fs.writeFileSync(path.join(WS, n), 'x')
fs.writeFileSync(path.join(WS, 'Clients', 'Acme', 'nested.docx'), 'x')

await killAll()
const app = await electron.launch({
  args: [path.join(root, 'out/main/index.js')],
  cwd: root,
  env: { ...process.env, WORKSPACE_TEST_ROOT: WS },
})
const win = await app.firstWindow({ timeout: 20000 })

/** The startup splash waits for Enter (or its button); dismiss it as a user would. */
async function dismissSplash() {
  for (let i = 0; i < 40 && (await win.$('[class*="_splash_"]')); i++) {
    await win.keyboard.press('Enter').catch(() => {})
    await win.waitForTimeout(400)
  }
}
await win.waitForSelector('#root', { timeout: 20000 })
await win.evaluate(() => {
  const K = 'workspace-os:settings'
  const c = (() => {
    try {
      return JSON.parse(localStorage.getItem(K) || '{}')
    } catch {
      return {}
    }
  })()
  localStorage.setItem(K, JSON.stringify({ ...c, newShell: true, terminalOpen: false, terminalMinimized: false }))
  localStorage.removeItem('workspace-os:files-view')
})
await win.reload()
await win.waitForSelector('#root', { timeout: 20000 })
await dismissSplash()
await win.waitForTimeout(1400)

try {
  // ─────────────────────────────────────────────── Files view modes
  await win.evaluate(() => {
    const h = [...document.querySelectorAll('button,[role=tab],a,[role=button]')].find(
      (e) => /files/i.test(e.textContent || '') || /files/i.test(e.getAttribute('aria-label') || ''),
    )
    if (h) h.click()
  })
  await win.waitForTimeout(1800)

  const B = '[data-testid="file-browser"]'
  check('the browser is showing', await win.isVisible(B))

  // List is the default, and is the only view with sortable column headers.
  check(
    'list view is the default',
    await win.isVisible(`${B} button[aria-label="Sort by size"]`),
  )

  // ── icon ──
  await win.click(`${B} button[aria-label="Icons view"]`)
  await win.waitForTimeout(600)
  const tiles = await win.evaluate(
    () => document.querySelectorAll('[data-testid="file-browser"] [class*=tileName]').length,
  )
  check('icon view draws a tile per entry', tiles === 4, `${tiles} tiles`)
  check(
    'the column headers are gone — they mean nothing over a grid',
    !(await win.isVisible(`${B} button[aria-label="Sort by size"]`)),
  )
  check(
    '…but the same sort is still offered',
    await win.isVisible(`${B} button:has-text("Date")`),
  )

  // ── gallery ──
  await win.click(`${B} button[aria-label="Gallery view"]`)
  await win.waitForTimeout(600)
  const stripCount = await win.evaluate(
    () => document.querySelectorAll('[data-testid="file-browser"] [class*=stripName]').length,
  )
  check('gallery view shows a filmstrip', stripCount === 4, `${stripCount} strip items`)
  const galleryName = await win.evaluate(
    () => document.querySelector('[data-testid="file-browser"] [class*=galleryName]')?.textContent ?? '',
  )
  check('gallery previews something without being asked', galleryName.length > 0, galleryName)

  // Selecting in the strip must change the preview, not open the file.
  await win.click(`${B} [class*=stripItem]:has-text("Budget.xlsx")`)
  await win.waitForTimeout(500)
  const after = await win.evaluate(
    () => document.querySelector('[data-testid="file-browser"] [class*=galleryName]')?.textContent ?? '',
  )
  check('clicking the strip moves the preview', after === 'Budget.xlsx', after)
  check('…and does NOT open the file', await win.isVisible(B))

  // ── column ──
  await win.click(`${B} button[aria-label="Columns view"]`)
  await win.waitForTimeout(700)
  let cols = await win.evaluate(
    () => document.querySelectorAll('[data-testid="file-browser"] [class*=column]:not([class*=columns])').length,
  )
  check('column view starts with one column', cols === 1, `${cols} columns`)

  await win.click(`${B} [class*=colName]:has-text("Clients")`)
  await win.waitForTimeout(800)
  cols = await win.evaluate(
    () => document.querySelectorAll('[data-testid="file-browser"] [class*=column]:not([class*=columns])').length,
  )
  check('entering a folder ADDS a column, keeping the parent on screen', cols === 2, `${cols} columns`)

  await win.click(`${B} [class*=colName]:has-text("Acme")`)
  await win.waitForTimeout(800)
  cols = await win.evaluate(
    () => document.querySelectorAll('[data-testid="file-browser"] [class*=column]:not([class*=columns])').length,
  )
  check('and again, so the whole path stays visible', cols === 3, `${cols} columns`)

  // The choice is a way of working — it should outlive a restart.
  const stored = await win.evaluate(() => localStorage.getItem('workspace-os:files-view'))
  check('the view choice is persisted', stored === 'column', String(stored))
  await win.reload()
  await win.waitForSelector('#root', { timeout: 20000 })
  await dismissSplash()
  await win.waitForTimeout(1600)
  await win.evaluate(() => {
    const h = [...document.querySelectorAll('button,[role=tab],a,[role=button]')].find(
      (e) => /files/i.test(e.textContent || '') || /files/i.test(e.getAttribute('aria-label') || ''),
    )
    if (h) h.click()
  })
  await win.waitForTimeout(1800)
  check(
    'it is still in column view after a restart',
    await win.evaluate(
      () => document.querySelectorAll('[data-testid="file-browser"] [class*=column]:not([class*=columns])').length > 0,
    ),
  )

  // ─────────────────────────────────────────── terminal hide / minimise
  const dockMounted = () =>
    win.evaluate(() => !!document.querySelector('[class*=dockBottom], [class*=dockRight]'))
  const dockHeight = () =>
    win.evaluate(() => {
      const d = document.querySelector('[class*=dockBottom]')
      return d ? Math.round(d.getBoundingClientRect().height) : -1
    })
  const barVisible = () => win.isVisible('[class*=dockBar]').catch(() => false)

  check('the terminal starts hidden', !(await dockMounted()))

  // ⌘J opens it.
  await win.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true, bubbles: true })),
  )
  await win.waitForTimeout(900)
  check('⌘J opens the terminal', await dockMounted())
  const openHeight = await dockHeight()
  check('…at a real size', openHeight > 100, `${openHeight}px`)

  // ⌥⌘J minimises — the dock must STAY MOUNTED.
  await win.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true, altKey: true, bubbles: true })),
  )
  await win.waitForTimeout(900)
  check('⌥⌘J collapses the terminal to nothing', (await dockHeight()) <= 1, `${await dockHeight()}px`)
  check(
    'the dock is STILL MOUNTED — the shell session survives a minimise',
    await dockMounted(),
    'unmounting it would kill the session, which is the whole point of minimising',
  )
  check('a bar is left behind so the terminal can be found again', await barVisible())

  // ⌘J from minimised RESTORES rather than hiding — "show" means show.
  await win.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true, bubbles: true })),
  )
  await win.waitForTimeout(900)
  check('⌘J restores a minimised terminal instead of hiding it', (await dockHeight()) > 100, `${await dockHeight()}px`)

  // Minimise again, then the bar's close button must hide it entirely.
  await win.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true, altKey: true, bubbles: true })),
  )
  await win.waitForTimeout(800)
  await win.click('button[aria-label="Hide the terminal"]')
  await win.waitForTimeout(800)
  check('hiding from the bar removes the dock entirely', !(await dockMounted()))
  check('and the bar goes with it', !(await barVisible()))

  const settings = await win.evaluate(() => localStorage.getItem('workspace-os:settings'))
  check('hiding also clears the minimised flag', /"terminalMinimized":false/.test(settings ?? ''), String(settings))
} finally {
  try {
    await app.close()
  } catch {
    /* already gone */
  }
  await killAll()
}

console.log(`\n  VIEWS+DOCK e2e: ${total - fails} passed, ${fails} failed\n`)
process.exit(fails ? 1 : 0)
