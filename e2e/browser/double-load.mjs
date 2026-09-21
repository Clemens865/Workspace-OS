/**
 * Does the in-app browser re-load a page the page navigated itself?
 *
 * BrowserSurface renders <webview src={tab.url}> where tab.url is React state
 * fed by syncNav on did-navigate / did-navigate-in-page. So every navigation
 * the PAGE performs writes new React state, React re-renders, sees the src
 * attribute changed, and writes it — and writing src on a <webview> starts a
 * NAVIGATION. The page navigates; we navigate it again to where it already is.
 *
 * The clean probe is history.pushState. It is a pure in-page navigation: it
 * MUST NOT cause a page load in any browser, ever. If a real load follows one
 * here, nothing but our own src binding can have caused it.
 *
 * Why it matters beyond a flicker:
 *   - a SPA (Asana) loses in-page state → "it reloads and I'm on the same page"
 *   - an auth redirect chain gets re-issued from an already-consumed one-time
 *     code → the sign-in loop, and auth_context_expired
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
  const KEY = 'workspace-os:settings'
  const cur = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} } })()
  localStorage.setItem(KEY, JSON.stringify({ ...cur, newShell: true }))
})
await win.reload()
await win.waitForSelector('#root', { timeout: 20000 })
await win.waitForTimeout(1500)
await win.evaluate(() => {
  const hit = [...document.querySelectorAll('button,[role=tab],a,[role=button]')]
    .find(e => /browser/i.test(e.textContent || '') || /browser/i.test(e.getAttribute('aria-label') || '') || /browser/i.test(e.getAttribute('title') || ''))
  if (hit) hit.click()
})
await win.waitForTimeout(3000)

// Settle on a real page and grab the guest's webContents id.
const wcId = await win.evaluate(async () => {
  const wv = document.querySelector('webview')
  if (!wv) return 0
  for (let i = 0; i < 40; i++) {
    try { const id = wv.getWebContentsId(); if (id) break } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 250))
  }
  // Tolerate ERR_ABORTED: a superseded navigation is the very symptom under
  // test, so it must not abort the test that is measuring it.
  try { await wv.loadURL('https://example.com/') } catch (e) { globalThis.__loadErr = String(e) }
  await new Promise(r => setTimeout(r, 5000))
  return wv.getWebContentsId()
})
check('a guest is attached and settled on a real page', wcId > 0, `wcId=${wcId}`)

// Count REAL loads from the main process — the renderer cannot lie about these.
await app.evaluate(({ webContents }, id) => {
  const wc = webContents.fromId(id)
  globalThis.__loads = []
  globalThis.__navs = []
  // did-start-navigation fires for in-page navigations too; isSameDocument
  // separates "the page changed its own url" (fine) from "a real load"
  // (the bug). Recording both so the difference is visible, not assumed.
  wc.on('did-start-navigation', (e) => {
    globalThis.__navs.push({
      url: String(e?.url ?? '').slice(0, 120),
      sameDocument: !!e?.isSameDocument,
      mainFrame: !!e?.isMainFrame,
    })
    if (e?.isMainFrame && !e?.isSameDocument) globalThis.__loads.push(String(e.url).slice(0, 120))
  })
}, wcId)

// A pure in-page navigation. No browser may load a page for this.
await win.evaluate(async () => {
  const wv = document.querySelector('webview')
  await wv.executeJavaScript(`history.pushState({}, '', '/pushed-by-the-test')`)
})
await win.waitForTimeout(4000)

const loads = await app.evaluate(() => globalThis.__loads || [])
const navs = await app.evaluate(() => globalThis.__navs || [])
console.log(`\n  all navigation events seen:`)
for (const n of navs) console.log(`    ${n.sameDocument ? 'in-page ' : 'REAL LOAD'} main=${n.mainFrame} ${n.url}`)
console.log(`\n  loads triggered by ONE history.pushState: ${loads.length}`)
if (loads.length) console.log(`  ${JSON.stringify(loads, null, 2)}`)
check('pushState causes NO page load', loads.length === 0,
  `${loads.length} load(s) — React re-wrote the src attribute, re-navigating a page that had already navigated itself`)

await app.close().catch(() => {})
console.log(`\n  ${fails === 0 ? 'no double-load' : 'DOUBLE-LOAD CONFIRMED'}\n`)
process.exit(fails ? 1 : 0)
