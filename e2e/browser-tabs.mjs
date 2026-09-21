/**
 * E2E for WOS-005 / WOS-007: a NEW browser tab must be able to navigate.
 * Asserts the guest actually attaches and the page really loads — not that a
 * function was called.
 */
import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'
import { killAll } from './office/_harness.mjs'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
let fails = 0
const check = (n, c, d) => { if (c) console.log(`  ✓ ${n}`); else { console.error(`  ✗ ${n}${d?` — ${d}`:''}`); fails++ } }

await killAll()
const app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root })
const win = await app.firstWindow({ timeout: 20000 })
await win.waitForSelector('#root', { timeout: 20000 })

// The Browser surface lives in the NEW shell only — the old layout has no
// Browser entry at all. Turn it on the way Settings does, then reload.
await win.evaluate(() => {
  const KEY = 'workspace-os:settings'
  const cur = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} } })()
  localStorage.setItem(KEY, JSON.stringify({ ...cur, newShell: true }))
})
await win.reload()
await win.waitForSelector('#root', { timeout: 20000 })
await win.waitForTimeout(1500)

const opened = await win.evaluate(() => {
  const hit = [...document.querySelectorAll('button,[role=tab],a,[role=button]')]
    .find(e => /browser/i.test(e.textContent || '') || /browser/i.test(e.getAttribute('aria-label') || '') || /browser/i.test(e.getAttribute('title') || ''))
  if (hit) { hit.click(); return true }
  return false
})
check('found a way into the Browser surface', opened)
await win.waitForTimeout(3000)

// A webview must exist AND have a src — the WOS-005 root cause was no src.
const state = await win.evaluate(() => {
  const wvs = [...document.querySelectorAll('webview')]
  return { count: wvs.length, srcs: wvs.map(w => w.getAttribute('src')), popups: wvs.map(w => w.getAttribute('allowpopups')) }
})
check('a webview is mounted', state.count > 0, JSON.stringify(state))
check('every webview has a src (WOS-005)', state.count > 0 && state.srcs.every(s => !!s), JSON.stringify(state.srcs))
check('allowpopups is set (WOS-007)', state.count > 0 && state.popups.every(p => p === 'true'), JSON.stringify(state.popups))

// The guest really attached: getWebContentsId() throws when it hasn't.
const attached = await win.evaluate(async () => {
  const wv = document.querySelector('webview')
  if (!wv) return 'no webview'
  for (let i = 0; i < 40; i++) {
    try { const id = wv.getWebContentsId(); if (id) return 'attached:' + id } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 250))
  }
  return 'never attached'
})
check('the guest webContents attached (the actual WOS-005 failure)', String(attached).startsWith('attached:'), String(attached))

// THE reported scenario, tested by BEHAVIOUR: open a new tab, type a domain,
// press Enter, and require that the page actually loads. Asserting that the
// guest "attached" was the wrong test — what the user reported is that nothing
// navigates, and that is what has to be proven.
const plusClicked = await win.evaluate(() => {
  const plus = [...document.querySelectorAll('button')]
    .find(b => (b.getAttribute('title') || b.getAttribute('aria-label') || b.textContent || '').trim().match(/^(\+|new tab)$/i))
  if (!plus) return false
  plus.click()
  return true
})
check('opened a new tab', plusClicked)
await win.waitForTimeout(1200)

// Type into the address bar and submit, exactly as a user does.
const submitted = await win.evaluate(() => {
  // The address bar specifically — a loose /search/ match grabbed the memory
  // panel's search box instead, which is not in a form.
  const input = document.querySelector('form input[class*="urlInput"]')
    || [...document.querySelectorAll('input')].find(i => /enter a website/i.test(i.placeholder || ''))
  if (!input) return 'no address input'
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, 'example.com')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  const form = input.closest('form')
  if (!form) return 'no form'
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  return 'submitted'
})
check('typed a domain into the address bar and submitted', submitted === 'submitted', String(submitted))

/**
 * ATTACHMENT is the assertion, not the src attribute.
 *
 * This check used to accept `getAttribute('src')` as proof, and swallowed the
 * getURL() failure as a comment. That is exactly how WOS-005 came back: the old
 * fallback wrote `wv.src = url` onto a webview with no guest, so the attribute
 * read example.com while nothing was attached and nothing painted. The test
 * agreed with the model and the model was wrong.
 *
 * getURL() throws unless a guest is attached AND dom-ready has fired, which
 * makes it the one cheap signal that cannot be faked by writing an attribute.
 */
const loaded = await win.evaluate(async () => {
  let lastErr = 'no webview'
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 250))
    for (const w of [...document.querySelectorAll('webview')]) {
      try {
        const u = w.getURL()
        if (/example\.com/.test(u)) return 'navigated:' + u
      } catch (e) {
        lastErr = 'UNATTACHED (src=' + (w.getAttribute('src') || '') + ')'
      }
    }
  }
  return 'never navigated — ' + lastErr
})
check('the NEW tab attaches a guest and navigates', String(loaded).startsWith('navigated:'), String(loaded))

/**
 * NO webview may be left without a guest.
 *
 * The behavioural check above passes even when the bug is present, because the
 * address bar may drive the first tab — which navigates perfectly — while the
 * newly opened one sits there dead. Both times WOS-005 was closed, it was
 * closed on evidence like that.
 *
 * This is the structural truth instead: a webview whose getURL() throws has no
 * guest and can never paint. A blank tab must therefore render NO webview at
 * all rather than a permanently guestless one.
 */
const orphans = await win.evaluate(() => {
  const out = []
  document.querySelectorAll('webview').forEach((w, i) => {
    try { w.getURL() } catch { out.push('webview[' + i + '] src=' + (w.getAttribute('src') || '(none)')) }
  })
  return out
})
check('no webview is left without a guest', orphans.length === 0, orphans.join(' | '))

await win.screenshot({ path: path.join(__dirname, 'browser-tabs.png') }).catch(()=>{})
// Restore the shell setting. Leaving newShell on in localStorage broke every
// office e2e afterwards, because those drive the old layout.
await win.evaluate(() => {
  const K = 'workspace-os:settings'
  const cur = (() => { try { return JSON.parse(localStorage.getItem(K) || '{}') } catch { return {} } })()
  localStorage.setItem(K, JSON.stringify({ ...cur, newShell: false }))
}).catch(() => {})
await app.close()
console.log(fails === 0 ? '\nBROWSER E2E PASS' : `\n${fails} check(s) FAILED`)
process.exit(fails === 0 ? 0 : 1)
