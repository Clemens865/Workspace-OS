/**
 * The address bar must always show the page the active tab is actually on.
 *
 * Reported: clicking a link (including from an external file) loads into an
 * already-open tab — the CONTENT changes, the URL shown does not.
 *
 * The tab under test is opened in the BACKGROUND and activated afterwards,
 * which is the case that breaks: a tab's navigation listeners are bound once at
 * mount, so a tab that mounts while some OTHER tab is active carries that fact
 * with it forever. Session-restored tabs mount exactly this way, which is why
 * this shows up "sometimes" rather than always.
 */
import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'
import { killAll } from '../office/_harness.mjs'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')
let fails = 0
const check = (n, c, d) => { if (c) console.log(`  PASS  ${n}`); else { console.error(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); fails++ } }

await killAll()
const app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root })
const win = await app.firstWindow({ timeout: 20000 })
await win.waitForSelector('#root', { timeout: 20000 })
await win.evaluate(() => {
  const K = 'workspace-os:settings'
  const c = (() => { try { return JSON.parse(localStorage.getItem(K) || '{}') } catch { return {} } })()
  localStorage.setItem(K, JSON.stringify({ ...c, newShell: true }))
  localStorage.removeItem('workspace-os:browser-session')
})
await win.reload()
await win.waitForSelector('#root', { timeout: 20000 })
await win.waitForTimeout(1200)
await win.evaluate(() => {
  const h = [...document.querySelectorAll('button,[role=tab],a,[role=button]')]
    .find(e => /browser/i.test(e.textContent || '') || /browser/i.test(e.getAttribute('aria-label') || ''))
  if (h) h.click()
})
await win.waitForTimeout(2500)

const addressBar = () => win.evaluate(() => document.querySelector('input[aria-label="Address bar"]')?.value ?? '')
const activeGuestUrl = () => win.evaluate(() => {
  const wv = [...document.querySelectorAll('webview')].find(w => w.style.display !== 'none')
  return wv?.getURL?.() ?? ''
})

// A tab opened in the BACKGROUND — it mounts while another tab is active.
await win.evaluate(
  (u) => new Promise((res) => {
    window.dispatchEvent(new CustomEvent('wos:browser-tab-command', {
      detail: { kind: 'newTab', url: u, focus: false, resolve: res },
    }))
    setTimeout(res, 10000)
  }),
  'https://example.com/',
)
await win.waitForTimeout(3500)
const tabCount = await win.evaluate(() => document.querySelectorAll('[role="tab"]').length)
check('a background tab was opened', tabCount >= 2, `${tabCount} tabs`)

// Bring it forward by clicking it, exactly as a person would. Using the strip
// rather than the command's resolved id keeps the test independent of the
// command's return shape.
await win.evaluate(() => {
  const tabs = [...document.querySelectorAll('[role="tab"]')]
  tabs[tabs.length - 1]?.click()
})
await win.waitForTimeout(1800)

// Now navigate it — this is the link-opens-in-an-existing-tab case.
await win.evaluate(async () => {
  const wv = [...document.querySelectorAll('webview')].find(w => w.style.display !== 'none')
  try { await wv.loadURL('https://example.org/') } catch { /* superseded loads are fine */ }
})
await win.waitForTimeout(4500)

const shown = await addressBar()
const real = await activeGuestUrl()
check('the guest really navigated', real.includes('example.org'), real)
check('the address bar shows where the tab actually IS', shown.includes('example.org'),
  `address bar: "${shown}" — guest: "${real}"`)

await app.close().catch(() => {})
console.log(`\n  ADDRESS-SYNC e2e: ${3 - fails} passed, ${fails} failed\n`)
process.exit(fails ? 1 : 0)
