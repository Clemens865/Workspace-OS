/**
 * Landscape adoption B5 exit test (docs/landscape/ADOPTION.md): browser tabs
 * have owners, and downloads are listed.
 *
 * In the real app, against a local test server: two agents each drive their
 * own tab; each agent's screen shows a capture of ITS page (two different
 * captures, at the same time) and the tab bar names the agent on each tab. A
 * file served as an attachment downloads into the workspace's Downloads folder
 * and appears, finished, in the browser's Downloads list.
 *
 * Run: npm run e2e:landscape
 */
import { _electron as electron } from 'playwright'
import fs from 'fs'
import http from 'http'
import os from 'os'
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

// Two pages that look nothing alike, and a file served as an attachment.
const page = (title, color) => `<!doctype html><title>${title}</title><body style="margin:0;background:${color};height:100vh"><h1 style="font:64px sans-serif;color:#fff;padding:40px">${title}</h1>`
const server = http.createServer((req, res) => {
  if (req.url === '/red') return res.end(page('Red page', '#c0392b'))
  if (req.url === '/blue') return res.end(page('Blue page', '#2c3e9b'))
  if (req.url === '/report.csv') {
    res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="report.csv"' })
    return res.end('a,b\n1,2\n')
  }
  res.writeHead(404).end()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wos-browser-own-')))
await killAll()
const app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root, env: { ...process.env, WORKSPACE_TEST_ROOT: ws } })
const win = await app.firstWindow({ timeout: 20000 })
win.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`))
await win.waitForSelector('#root', { timeout: 20000 })
const saved = await win.evaluate(() => JSON.stringify({ ...localStorage }))
await win.evaluate(() => {
  const K = 'workspace-os:settings'
  let c = {}
  try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* fresh */ }
  localStorage.setItem(K, JSON.stringify({ ...c, startOn: 'landscape', terminalOpen: false }))
})
await win.reload()
await win.waitForSelector('[data-shell="landscape"]', { timeout: 20000 })
for (let i = 0; i < 40 && (await win.$('[class*="_splash_"]')); i++) {
  await win.keyboard.press('Enter').catch(() => {})
  await win.waitForTimeout(400)
}
await win.waitForTimeout(1000)
const settle = (ms = 800) => win.waitForTimeout(ms)

try {
  const roster = await win.evaluate(() => window.workspace.agents.list())
  if (roster.length < 2) {
    console.log('  SKIP  ownership: needs two agents on the roster')
  } else {
    const [A, B] = [roster[0].name, roster[1].name]
    // Two tabs, one per page.
    for (const u of ['/red', '/blue']) {
      await win.evaluate((url) => window.dispatchEvent(new CustomEvent('wos:browser-open', { detail: { url } })), base + u)
      await win.waitForTimeout(1500)
    }
    const tabs = await win.$$eval('[data-tab-id]', (els) => els.map((e) => ({ id: e.getAttribute('data-tab-id'), title: e.getAttribute('title') })))
    const red = tabs.find((t) => /Red page/.test(t.title ?? ''))
    const blue = tabs.find((t) => /Blue page/.test(t.title ?? ''))
    check('both pages are open as tabs', !!red && !!blue, JSON.stringify(tabs))

    await win.evaluate(({ A, B, red, blue }) => {
      const s = window.__reviewStore
      s.openRun({ runId: 'e2e-own-a', sessionId: 'e2e-own-a', sessionName: A, agentName: A, prompt: 'Read the red page', mode: 'full', checkpointId: null })
      s.openRun({ runId: 'e2e-own-b', sessionId: 'e2e-own-b', sessionName: B, agentName: B, prompt: 'Read the blue page', mode: 'full', checkpointId: null })
      window.__browserDriver.record('e2e-own-a', 'browser.navigate', red)
      window.__browserDriver.record('e2e-own-b', 'browser.navigate', blue)
    }, { A, B, red: red?.id, blue: blue?.id })
    await settle()

    const owners = await win.$$eval('[data-tab-id]', (els) => Object.fromEntries(els.map((e) => [e.getAttribute('data-tab-id'), e.getAttribute('data-owner')])))
    const short = (n) => n.split(' — ')[0]
    check('the tab bar names the agent on each tab', owners[red.id] === short(A) && owners[blue.id] === short(B), JSON.stringify(owners))

    await win.click('[data-testid="stage-landscape"]').catch(() => {})
    await win.click('[data-dock="overview"]').catch(() => {})
    await settle(1200)
    const shotOf = (name) => win.waitForSelector(`[data-agent="${name.replace(/"/g, '\\"')}"] [data-testid="screen-shot"] img`, { timeout: 8000 }).then((h) => h.getAttribute('src')).catch(() => null)
    const [sa, sb] = await Promise.all([shotOf(A), shotOf(B)])
    check("each working agent's screen shows a capture", !!sa && !!sb && sa.startsWith('data:image/jpeg') && sb.startsWith('data:image/jpeg'))
    check('…of its own page (two different captures)', !!sa && !!sb && sa !== sb)
  }

  // ── downloads ──
  await win.evaluate((url) => window.dispatchEvent(new CustomEvent('wos:browser-open', { detail: { url } })), base + '/report.csv')
  const file = path.join(ws, 'Downloads', 'report.csv')
  for (let i = 0; i < 20 && !fs.existsSync(file); i++) await win.waitForTimeout(300)
  check('a download lands in the workspace Downloads folder', fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('1,2'))
  await settle(800)
  await win.click('[data-dock="menu"]')
  await settle(700)
  await win.click('[data-menu="browser"]')
  await settle(1200)
  await win.click('[data-testid="browser-downloads"]')
  await settle(400)
  const state = await win.getAttribute('[data-download="report.csv"]', 'data-state').catch(() => null)
  check('the Downloads list shows it, finished', state === 'completed', state)
} catch (e) {
  check('run completed', false, e.message)
} finally {
  await win
    .evaluate((saved) => {
      localStorage.clear()
      for (const [k, v] of Object.entries(JSON.parse(saved))) localStorage.setItem(k, v)
    }, saved)
    .catch(() => {})
  await app.close()
  server.close()
  fs.rmSync(ws, { recursive: true, force: true })
}
console.log(`\n${total - fails}/${total} passed`)
process.exit(fails ? 1 : 0)
