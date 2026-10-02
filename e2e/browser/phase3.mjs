/**
 * Phase 3 in the real app: the panel offers what the PAGE makes possible, and
 * the history view can actually be reached.
 *
 * The claim under test is the discoverability one — that somebody who knows no
 * shortcuts and has read no documentation is still shown what they can do, and
 * that the offer changes with the page. A unit test over the ranking cannot see
 * whether the signals ever reach it.
 */
import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'
import { killAll } from '../office/_harness.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'
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
await win.evaluate(() => localStorage.removeItem('workspace-os:browser-session'))

const goto = async (url) => {
  await win.evaluate(async (u) => {
    const wv = document.querySelector('webview')
    for (let i = 0; i < 40; i++) {
      try { if (wv.getWebContentsId()) break } catch { /* not yet */ }
      await new Promise(r => setTimeout(r, 250))
    }
    try { await wv.loadURL(u) } catch { /* superseded loads are fine */ }
  }, url)
  await win.waitForTimeout(5000)
}
const offers = () => win.evaluate(() =>
  [...document.querySelectorAll('section[aria-label="What you can do here"] button')].map(b => b.textContent || ''))

// A text page: a summary is worth offering, a spreadsheet is not.
await goto('https://example.com/')
const textOffers = await offers()
check('the panel offers something without being asked', textOffers.length > 0, JSON.stringify(textOffers))
check('a plain page does NOT offer the spreadsheet', !textOffers.some(t => /spreadsheet/i.test(t)), JSON.stringify(textOffers))
check('the offers are plain language, not feature names',
  textOffers.some(t => /Find something on this page|Read the whole site|Ask a question/i.test(t)), JSON.stringify(textOffers))
check('shortcuts are shown next to the actions that have one',
  textOffers.some(t => t.includes('⌘F')), JSON.stringify(textOffers))

// A page WITH a real data table must change the offer. This is the claim that
// the list responds to what you are looking at.
await goto('https://en.wikipedia.org/wiki/List_of_countries_by_population_(United_Nations)')
const tableOffers = await offers()
check('a page with a table offers the spreadsheet', tableOffers.some(t => /spreadsheet/i.test(t)), JSON.stringify(tableOffers))
check('and it is offered FIRST, being the least discoverable thing here',
  /spreadsheet/i.test(tableOffers[0] || ''), JSON.stringify(tableOffers.slice(0, 2)))

// The long tail stays reachable by looking, not by knowing.
const moreLabel = await win.evaluate(() => {
  const btns = [...document.querySelectorAll('section[aria-label="What you can do here"] button')]
  const more = btns.find(b => /Everything else/i.test(b.textContent || ''))
  if (more) { more.click(); return more.textContent }
  return ''
})
await win.waitForTimeout(300)
const expanded = await offers()
check('everything else is reachable by looking', /Everything else/.test(moreLabel) && expanded.length > tableOffers.length,
  `${moreLabel} → ${expanded.length} vs ${tableOffers.length}`)

// History search — Phase 1 shipped the index with no way in.
await win.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', metaKey: true, shiftKey: true, bubbles: true })))
await win.waitForTimeout(700)
const histOpen = await win.evaluate(() => !!document.querySelector('[aria-label="Search everything you have read"]'))
check('the history view opens', histOpen)

const found = await win.evaluate(async () => {
  const input = document.querySelector('[aria-label="Search everything you have read"] input')
  if (!input) return -1
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, 'domain')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 1500))
  return document.querySelectorAll('[aria-label="Search everything you have read"] button[title^="http"]').length
})
check('searching the TEXT of pages you read returns hits', found > 0, `rows=${found}`)

await app.close().catch(() => {})
console.log(`\n  PHASE 3 e2e: ${9 - fails} passed, ${fails} failed\n`)
process.exit(fails ? 1 : 0)
