/**
 * WOS-011 (fill the window) and WOS-012 (collapsible Assistant), in the real app.
 *
 * Both are layout features, and layout is exactly where a passing test can mean
 * nothing — a class that is applied but styles nothing looks identical to a
 * working feature from the DOM. So every check here reads a MEASURED geometry:
 * the rail's real width, the topbar's real height, the page's real width. If
 * the CSS stops working the numbers stop moving, whatever the markup says.
 */
import { _electron as electron } from 'playwright'
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

await killAll()
const app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root })
const win = await app.firstWindow({ timeout: 20000 })
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
  localStorage.setItem(K, JSON.stringify({ ...c, newShell: true }))
  localStorage.removeItem('workspace-os:browser-session')
  localStorage.removeItem('workspace-os:browser-assistant')
})
await win.reload()
await win.waitForSelector('#root', { timeout: 20000 })
await win.waitForTimeout(1400)

/** Width of the rail — the grid's first column, measured, not inferred. */
const railWidth = () =>
  win.evaluate(() => {
    const rootEl = document.querySelector('[data-expanded]')
    const rail = rootEl?.firstElementChild
    return rail ? Math.round(rail.getBoundingClientRect().width) : -1
  })

/** Height of the tab strip. */
const topbarHeight = () =>
  win.evaluate(() => {
    const bar = document.querySelector('[class*=topbar]')
    return bar ? Math.round(bar.getBoundingClientRect().height) : -1
  })

const isExpanded = () =>
  win.evaluate(() => document.querySelector('[data-expanded]')?.getAttribute('data-expanded'))

// ─────────────────────────────────────────────── WOS-011 · fill the window
const railBefore = await railWidth()
const topbarBefore = await topbarHeight()
check('the rail is on screen to begin with', railBefore > 40, `${railBefore}px`)
check('the tab strip is on screen to begin with', topbarBefore > 20, `${topbarBefore}px`)
check('the shell starts un-expanded', (await isExpanded()) === 'false')

// Expand via the real control, the way a person would.
await win.click('button[aria-label="Fill the window"]')
await win.waitForTimeout(900) // let the 320ms transitions settle

check('the shell reports itself expanded', (await isExpanded()) === 'true')
const railAfter = await railWidth()
const topbarAfter = await topbarHeight()
check('the rail is gone — really zero width, not merely class-toggled', railAfter <= 1, `${railAfter}px`)
check('the tab strip collapsed to nothing', topbarAfter <= 1, `${topbarAfter}px`)

const exitVisible = await win.isVisible('button[aria-label="Exit full window"]').catch(() => false)
check('an exit control is visible — an expanded surface must never be a trap', exitVisible)

// Esc must get out. This is the escape hatch someone reaches for by reflex.
await win.keyboard.press('Escape')
await win.waitForTimeout(900)
check('Esc leaves the expanded surface', (await isExpanded()) === 'false')
check('the rail came back', (await railWidth()) > 40, `${await railWidth()}px`)
check('the tab strip came back', (await topbarHeight()) > 20, `${await topbarHeight()}px`)

// ⌘B reclaims just the rail — this was a no-op before WOS-011.
await win.evaluate(() =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true })),
)
await win.waitForTimeout(700)
check('⌘B hides the rail (it used to be wired to an empty function)', (await railWidth()) <= 1, `${await railWidth()}px`)
check('…and the tab strip stays, because this is the lighter gesture', (await topbarHeight()) > 20)
await win.evaluate(() =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true })),
)
await win.waitForTimeout(700)
check('⌘B brings the rail back', (await railWidth()) > 40)

// ─────────────────────────────────────────── WOS-012 · the Assistant panel
await win.evaluate(() => {
  const h = [...document.querySelectorAll('button,[role=tab],a,[role=button]')].find(
    (e) => /browser/i.test(e.textContent || '') || /browser/i.test(e.getAttribute('aria-label') || ''),
  )
  if (h) h.click()
})
await win.waitForTimeout(2500)

/** The page column's real width — what the user actually gets back. */
const pageWidth = () =>
  win.evaluate(() => {
    const m = document.querySelector('[class*=bmain]')
    return m ? Math.round(m.getBoundingClientRect().width) : -1
  })

const pageWithPanel = await pageWidth()
check('the assistant is open by default, as it shipped', await win.isVisible('button[aria-label="Hide the assistant"]'))

await win.click('button[aria-label="Hide the assistant"]')
await win.waitForTimeout(800)

const pageWithoutPanel = await pageWidth()
check(
  'hiding the assistant gives the width back to the PAGE',
  pageWithoutPanel > pageWithPanel + 200,
  `page went ${pageWithPanel}px → ${pageWithoutPanel}px`,
)
check('a control to bring it back is visible', await win.isVisible('button[aria-label="Show the assistant"]'))

// The choice has to survive a restart, or it is a preference you set forever.
const stored = await win.evaluate(() => localStorage.getItem('workspace-os:browser-assistant'))
check('the collapsed choice is persisted', /"open":false/.test(stored ?? ''), String(stored))

await win.reload()
await win.waitForSelector('#root', { timeout: 20000 })
await win.waitForTimeout(1400)
await win.evaluate(() => {
  const h = [...document.querySelectorAll('button,[role=tab],a,[role=button]')].find(
    (e) => /browser/i.test(e.textContent || '') || /browser/i.test(e.getAttribute('aria-label') || ''),
  )
  if (h) h.click()
})
await win.waitForTimeout(2500)
check(
  'it is still collapsed after a reload',
  await win.isVisible('button[aria-label="Show the assistant"]'),
)

await win.click('button[aria-label="Show the assistant"]')
await win.waitForTimeout(800)
check('and it reopens', await win.isVisible('button[aria-label="Hide the assistant"]'))
check(
  'reopening narrows the page again',
  (await pageWidth()) < pageWithoutPanel - 200,
  `${await pageWidth()}px vs ${pageWithoutPanel}px`,
)

await app.close().catch(() => {})
console.log(`\n  LAYOUT e2e: ${total - fails} passed, ${fails} failed\n`)
process.exit(fails ? 1 : 0)
