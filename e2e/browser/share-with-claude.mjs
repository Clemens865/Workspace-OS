/**
 * Can something started in the TERMINAL see the page the user is looking at?
 *
 * The reported failure: open a page, start zsh, run `claude`, ask "can you see
 * this job posting?" → "nothing came through with your message". Correct, and
 * only because nothing ever told it about the open page.
 *
 * Asserted against the real artefacts an agent would read — the context file
 * main writes and the captured page itself — not against the functions that
 * write them.
 */
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
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

// A workspace must be open, or there is nowhere to leave anything for an agent.
const wsRoot = await win.evaluate(async () => {
  const recents = await window.workspace.fs.recentWorkspaces()
  if (recents?.length) {
    await window.workspace.fs.openWorkspace(recents[0])
    return recents[0]
  }
  return null
})
if (!wsRoot) { console.log('\n  SKIP: no workspace to open.\n'); await app.close().catch(() => {}); process.exit(0) }
await win.waitForTimeout(1500)

await win.evaluate(() => {
  const h = [...document.querySelectorAll('button,[role=tab],a,[role=button]')]
    .find(e => /browser/i.test(e.textContent || '') || /browser/i.test(e.getAttribute('aria-label') || ''))
  if (h) h.click()
})
await win.waitForTimeout(2500)
await win.evaluate(async () => {
  const wv = document.querySelector('webview')
  for (let i = 0; i < 40; i++) {
    try { if (wv.getWebContentsId()) break } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 250))
  }
  try { await wv.loadURL('https://example.com/') } catch { /* superseded loads are fine */ }
})
await win.waitForTimeout(5000)

// ── 1. the harness KNOWS the page ─────────────────────────────────────────
// agent-context.json is what `wos-action context` answers from and what any
// agent can read directly.
const ctxFile = path.join(wsRoot, '.workspace-os', 'agent-context.json')
let ctx = null
for (let i = 0; i < 20 && !ctx; i++) {
  try {
    const raw = JSON.parse(fs.readFileSync(ctxFile, 'utf8'))
    if (raw.browserUrl) ctx = raw
  } catch { /* not written yet */ }
  if (!ctx) await win.waitForTimeout(500)
}
check('the harness records the page the user is looking at',
  !!ctx && String(ctx.browserUrl).includes('example.com'),
  ctx ? `${ctx.browserUrl} — ${ctx.browserTitle}` : `no browserUrl in ${ctxFile}`)

// ── 2. the button HANDS IT OVER ───────────────────────────────────────────
const captured = path.join(wsRoot, '.workspace-os', 'current-page.md')
fs.rmSync(captured, { force: true })

// The action chips live in the TERMINAL DOCK, so it has to be open — which is
// also true for the user: this button appears where the terminal is.
await win.evaluate(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true, bubbles: true }))
})
await win.waitForTimeout(2500)

const clicked = await win.evaluate(() => {
  const btn = [...document.querySelectorAll('button')]
    .find(b => /Give Claude this page/i.test(b.textContent || ''))
  if (!btn) return false
  btn.click()
  return true
})
check('the button is offered on the browser surface', clicked)
await win.waitForTimeout(4000)

const exists = fs.existsSync(captured)
check('clicking it captures the page for an agent to read', exists, captured)
if (exists) {
  const body = fs.readFileSync(captured, 'utf8')
  check('the captured file names the source url', body.includes('https://example.com/'))
  // The point of capturing rather than passing a link: the TEXT is there, so an
  // agent with no network access can still answer about the page.
  check('the captured file contains the page TEXT, not just a link',
    /domain/i.test(body), body.slice(0, 200))
}

await app.close().catch(() => {})
const total = 5
console.log(`\n  SHARE-PAGE e2e: ${total - fails} passed, ${fails} failed\n`)
process.exit(fails ? 1 : 0)
