/**
 * Does browsing actually fill the history index, in the real app?
 *
 * The unit tests prove the store works when called. They cannot prove the
 * BROWSER calls it — that the did-stop-loading listener fires, that the page
 * text survives executeJavaScript, that the IPC round-trip lands. This repo has
 * paid for that gap before (a green suite over a module nothing reached), so
 * the claim "history works" is only allowed to rest on this.
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

// Start from a known-clean index so a previous run cannot supply the evidence.
await win.evaluate(() => window.workspace.history.clear())

await win.evaluate(async () => {
  const wv = document.querySelector('webview')
  for (let i = 0; i < 40; i++) {
    try { if (wv.getWebContentsId()) break } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 250))
  }
  try { await wv.loadURL('https://example.com/') } catch { /* superseded loads are fine */ }
})
await win.waitForTimeout(6000)

const recent = await win.evaluate(() => window.workspace.history.recent(10))
check('the visit was recorded', recent.some(r => r.url.includes('example.com')), JSON.stringify(recent.map(r => r.url)))

// The whole reason this index exists: the page's TEXT is searchable.
//
// The phrase is derived from the stored snippet at RUNTIME rather than
// hardcoded. A first attempt asserted "illustrative examples" from memory of
// example.com's old copy; the page now says "documentation examples", so the
// test failed while the feature worked perfectly. A test that hardcodes someone
// else's prose fails on their schedule, not on ours.
//
// Words are taken from the BODY only, skipping any that appear in the title or
// url, so a hit cannot be explained by the title index.
const phrase = await win.evaluate(() => {
  const row = window.workspace.history.recent(10).then(rows => rows.find(r => r.url.includes('example.com')))
  return row.then(r => {
    if (!r) return ''
    const title = (r.title || '').toLowerCase()
    const words = (r.snippet || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 5 && !title.includes(w) && !r.url.includes(w))
    return words.slice(0, 2).join(' ')
  })
})
check('the stored page has body text to search', !!phrase, `derived phrase: "${phrase}"`)
const hits = phrase ? await win.evaluate((q) => window.workspace.history.search(q), phrase) : []
check('the page BODY is full-text searchable', hits.length > 0, `searched "${phrase}" → ${JSON.stringify(hits.map(h => h.url))}`)

// Omnibox: typing a prefix offers the page back.
const sugg = await win.evaluate(() => window.workspace.history.suggest('exam', 8))
check('the omnibox suggests it from a prefix', sugg.some(s => s.url.includes('example.com')), JSON.stringify(sugg))

// Bookmarks are the same row, starred.
await win.evaluate(() => window.workspace.history.star('https://example.com/'))
const marks = await win.evaluate(() => window.workspace.history.bookmarks())
check('starring makes it a bookmark', marks.some(b => b.url.includes('example.com')))
const starredHits = await win.evaluate((q) => window.workspace.history.search(q), phrase)
check('a bookmark stays full-text searchable (one store, not two)', starredHits.length > 0)

// Deletion must take the indexed TEXT with it, not just the listing.
await win.evaluate(() => window.workspace.history.forget('https://example.com/'))
const afterList = await win.evaluate(() => window.workspace.history.recent(10))
const afterText = await win.evaluate((q) => window.workspace.history.search(q), phrase)
check('forgetting removes it from the list', !afterList.some(r => r.url.includes('example.com')))
check('forgetting removes the INDEXED TEXT too', afterText.length === 0, JSON.stringify(afterText))

// about:blank is where every tab mounts; it must never appear as history.
check('about:blank never appears in history', !afterList.some(r => r.url.startsWith('about:')), JSON.stringify(afterList.map(r => r.url)))

await app.close().catch(() => {})
console.log(`\n  HISTORY e2e: ${9 - fails} passed, ${fails} failed\n`)
process.exit(fails ? 1 : 0)
