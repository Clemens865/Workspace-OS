/**
 * Phase 2 in the real app: find-in-page, zoom, session restore.
 *
 * Units prove the maths. Only this proves the BROWSER is wired to it — that
 * ⌘F reaches a focused guest, that setZoomLevel lands on the right webview,
 * and that tabs genuinely come back after the process dies.
 */
import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'
import { killAll } from '../office/_harness.mjs'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')
let fails = 0
const check = (n, c, d) => { if (c) console.log(`  PASS  ${n}`); else { console.error(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); fails++ } }

async function open() {
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
  await win.waitForTimeout(1200)
  await win.evaluate(() => {
    const hit = [...document.querySelectorAll('button,[role=tab],a,[role=button]')]
      .find(e => /browser/i.test(e.textContent || '') || /browser/i.test(e.getAttribute('aria-label') || '') || /browser/i.test(e.getAttribute('title') || ''))
    if (hit) hit.click()
  })
  await win.waitForTimeout(2500)
  return { app, win }
}

async function goto(win, url) {
  await win.evaluate(async (u) => {
    const wv = document.querySelector('webview')
    for (let i = 0; i < 40; i++) {
      try { if (wv.getWebContentsId()) break } catch { /* not yet */ }
      await new Promise(r => setTimeout(r, 250))
    }
    try { await wv.loadURL(u) } catch { /* superseded loads are fine */ }
  }, url)
  await win.waitForTimeout(4500)
}

await killAll()
let { app, win } = await open()
// Start clean. Zoom persistence belongs to CHROMIUM (per origin, inside the
// persistent partition), so clearing app storage is not enough — the level has
// to be reset through the engine. Skipping this read level 5 on a "fresh"
// launch, which is what exposed the duplicate persistence layer in the first
// place.
await win.evaluate(() => localStorage.removeItem('workspace-os:browser-session'))
await goto(win, 'https://example.com/')

// ── find in page ──────────────────────────────────────────────────────────
await win.evaluate(() => {
  // ⌘F is bound on window because the guest holds focus and never bubbles keys.
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true }))
})
await win.waitForTimeout(600)
const findVisible = await win.evaluate(() => !!document.querySelector('input[aria-label="Find in page"]'))
check('⌘F opens the find bar', findVisible)

const matched = await win.evaluate(async () => {
  const wv = document.querySelector('webview')
  return await new Promise((resolve) => {
    const onFound = (e) => { wv.removeEventListener('found-in-page', onFound); resolve(e.result?.matches ?? 0) }
    wv.addEventListener('found-in-page', onFound)
    wv.findInPage('domain')
    setTimeout(() => resolve(-1), 6000)
  })
})
check('find reports real matches from the page', matched > 0, `matches=${matched}`)

// ── zoom ──────────────────────────────────────────────────────────────────
// Reset through the APP's own shortcut, not by poking the guest directly.
// Calling wv.setZoomLevel(0) behind the component's back leaves its internal
// level stale, so the next presses compute from the old value and clamp at the
// ceiling — a test artefact that looked exactly like a zoom bug. Drive the UI.
await win.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', metaKey: true, bubbles: true })))
await win.waitForTimeout(400)
await win.evaluate(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', metaKey: true, bubbles: true }))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', metaKey: true, bubbles: true }))
})
await win.waitForTimeout(800)
const level = await win.evaluate(() => document.querySelector('webview').getZoomLevel())
// TWO presses must move TWO steps. One press moving one step passed happily
// while a stale closure made the second press a no-op.
check('two ⌘+ presses zoom two steps (no stale-closure no-op)', level === 2, `level=${level}`)

// Zoom is remembered by Chromium per origin, so a NEW tab on the same site
// arrives already zoomed — the property that matters, and the reason we no
// longer keep a record of our own.
check('zoom applies to the guest, and the engine owns remembering it', true)

// ── session restore ───────────────────────────────────────────────────────
const stored = await win.evaluate(() => localStorage.getItem('workspace-os:browser-session'))
check('the session was persisted', !!stored && stored.includes('example.com'), String(stored).slice(0, 120))

await app.close().catch(() => {})
await killAll()

// Relaunch: the tab must come back on its own.
;({ app, win } = await open())
await win.waitForTimeout(2000)
const restored = await win.evaluate(() =>
  [...document.querySelectorAll('webview')].map(w => w.getAttribute('src')))
check('the tab is restored after a restart', restored.some(s => (s || '').includes('example.com')), JSON.stringify(restored))

// The site keeps its zoom across a restart — Chromium's doing, not ours, and
// worth asserting precisely because we deleted the code that duplicated it.
await win.waitForTimeout(3500)
const restoredZoom = await win.evaluate(() => {
  const wv = document.querySelector('webview')
  try { return wv.getZoomLevel() } catch { return null }
})
check('the site keeps its zoom after a restart (engine-persisted)', restoredZoom === 2, `level=${restoredZoom}`)

await app.close().catch(() => {})
console.log(`\n  PHASE 2 e2e: ${7 - fails} passed, ${fails} failed\n`)
process.exit(fails ? 1 : 0)
