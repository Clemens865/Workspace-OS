/**
 * Apps (real app, real sandbox, a fake Claude).
 *
 * - The dock's Apps shows the gallery; the SVG Generator is added as a copy in
 *   the workspace's Apps/ and opens full size, in the Workspace OS kit.
 * - The app works through its bridge only: its AI call reaches the model (in a
 *   temporary folder, as the app), its storage lands in Apps/<slug>/data/.
 * - The sandbox holds: no reach into the app, no network, no localStorage, no
 *   web lookup without "ai.web", and an unknown request is refused.
 * - "New app" opens the builder: a chat whose run may edit only that app's
 *   folder (and loads no settings that could widen it); the app reloads
 *   beside the chat and keeps its state; Duplicate makes an own copy.
 *
 * Run: npm run e2e:landscape
 */
import { _electron as electron } from 'playwright'
import fs from 'fs'
import os from 'os'
import path from 'path'
import http from 'http'
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

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wos-apps-')))
const ws = path.join(tmp, 'workspace')
fs.mkdirSync(ws)
// A local server: if an app could reach the network, this would see it.
let hits = 0
const server = http.createServer((_q, r) => {
  hits++
  r.end('reached')
})
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
const port = server.address().port

const callsFile = path.join(tmp, 'calls.json')
const fake = path.join(tmp, 'claude.cjs')
const COUNTER = `<!doctype html><html><head><title>Counter</title><link rel="stylesheet" href="style.css"></head><body><div class="wos-app"><div class="wos-main"><h1 id="n">Count: 0</h1><button id="inc" class="wos-btn primary">+1</button></div></div><script src="app.js"></script></body></html>`
const COUNTER_JS = `let n = 0; const show = () => (document.getElementById('n').textContent = 'Count: ' + n); wos.storage.get('n').then((v) => { n = v || 0; show() }); document.getElementById('inc').onclick = async () => { n++; show(); await wos.storage.set('n', n) }`
fs.writeFileSync(
  fake,
  `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (!args.includes('-p')) { process.stdout.write('2.1.266 (Claude Code)\\n'); process.exit(0); }
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { prompt += c; });
process.stdin.on('end', () => {
  const file = ${JSON.stringify(callsFile)};
  const calls = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const system = args[args.indexOf('--append-system-prompt') + 1] || '';
  calls.push({ prompt, args, system, cwd: process.cwd() });
  fs.writeFileSync(file, JSON.stringify(calls));
  let text = 'Done.';
  if (system.includes('You are the AI inside "SVG Generator"')) text = '<svg viewBox="0 0 256 256"><circle cx="128" cy="128" r="80" fill="#d97757"/></svg>';
  // A resumed turn carries no system prompt: the fix request is known by its words.
  if (prompt.includes("design check found")) {
    fs.writeFileSync(path.join(process.cwd(), 'Apps', 'new-app', 'style.css'), 'h1 { color: var(--ink) }');
    text = 'Fixed: the heading now uses the ink token.';
  } else if (system.includes('You build and change ONE app')) {
    const dir = path.join(process.cwd(), 'Apps', 'new-app');
    fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify({ name: 'Counter', description: 'Counts, and remembers.', icon: '🔢', permissions: [], entry: 'index.html' }));
    fs.writeFileSync(path.join(dir, 'index.html'), ${JSON.stringify(COUNTER)});
    fs.writeFileSync(path.join(dir, 'app.js'), ${JSON.stringify(COUNTER_JS)});
    fs.writeFileSync(path.join(dir, 'style.css'), 'h1 { color: #ff0000 }');
    text = 'Built a counter that remembers its count. Press +1.';
  }
  process.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', session_id: 'aaaaaaaa-bbbb-cccc-dddd-00000000000' + calls.length, is_error: false, result: text }) + '\\n');
});
`,
)
fs.chmodSync(fake, 0o755)
// WOS_SHOT_DIR=<dir>: keep pictures for a look by eye.
const shot = async (name) => process.env.WOS_SHOT_DIR && (await win.waitForTimeout(700), await win.screenshot({ path: path.join(process.env.WOS_SHOT_DIR, name) }))
const calls = () => (fs.existsSync(callsFile) ? JSON.parse(fs.readFileSync(callsFile, 'utf8')) : [])

await killAll()
const app = await electron.launch({
  args: [path.join(root, 'out/main/index.js')],
  cwd: root,
  env: { ...process.env, WORKSPACE_TEST_ROOT: ws, CLAUDE_BIN: fake, WOS_ACTION_DIR: path.join(root, 'resources/wos-action'), WOS_NO_MEANING: '1', WOS_NO_TIDY: '1' },
})
const win = await app.firstWindow({ timeout: 20000 })
win.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`))
await win.waitForSelector('#root', { timeout: 20000 })
const saved = await win.evaluate(() => JSON.stringify({ ...localStorage }))
await win.evaluate(() => {
  const K = 'workspace-os:settings'
  let c = {}
  try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* fresh */ }
  localStorage.setItem(K, JSON.stringify({ ...c, startOn: 'landscape', terminalOpen: false, sessionCases: 'manual', agentModel: '', learnFromSessions: false }))
})
await win.reload()
await win.waitForSelector('[data-shell="landscape"]', { timeout: 20000 })
for (let i = 0; i < 40 && (await win.$('[class*="_splash_"]')); i++) {
  await win.keyboard.press('Enter').catch(() => {})
  await win.waitForTimeout(400)
}
const settle = (ms = 800) => win.waitForTimeout(ms)
const until = async (fn, ms = 15000) => {
  for (let t = 0; t < ms; t += 300) {
    if (await fn()) return true
    await settle(300)
  }
  return false
}
const appFrame = async () => {
  const el = await win.waitForSelector('[data-testid="app-frame"]', { timeout: 10000 })
  for (let i = 0; i < 30; i++) {
    const f = await el.contentFrame()
    if (f && (await f.evaluate(() => typeof window.wos === 'object').catch(() => false))) return f
    await settle(200)
  }
  return el.contentFrame()
}

try {
  await win.click('[data-dock="apps"]')
  await win.waitForSelector('[data-testid="apps-view"]', { timeout: 8000 })
  check('the dock opens Apps, with the gallery to add from', !!(await win.$('[data-template="svg-generator"]')))

  // ── a built-in app, added and run ──
  await win.click('[data-testid="apps-add-svg-generator"]')
  let f = await appFrame()
  const manifest = JSON.parse(fs.readFileSync(path.join(ws, 'Apps/svg-generator/app.json'), 'utf8'))
  check('it is added as a copy in the workspace’s Apps/ and opens', manifest.from === 'svg-generator' && fs.existsSync(path.join(ws, 'Apps/svg-generator/app.js')) && !!f)
  const sandbox = await win.getAttribute('[data-testid="app-frame"]', 'sandbox')
  const look = await f.evaluate(() => ({ font: getComputedStyle(document.body).fontFamily, bg: getComputedStyle(document.body).backgroundColor, kit: !!document.querySelector('style[data-wos-kit]') }))
  check('…in a frame with scripts but no origin, in the Workspace OS kit', sandbox === 'allow-scripts allow-modals' && look.kit && /Inter/.test(look.font) && look.bg === 'rgb(251, 252, 253)', JSON.stringify({ sandbox, look }))

  const before = calls().length
  await f.fill('#what', 'A sun over hills')
  await f.click('#go')
  await until(async () => (await f.getAttribute('#preview', 'src').catch(() => null))?.startsWith('data:image/svg+xml'), 10000)
  const ai = calls()[before]
  check('its AI call reaches the model as that app, with no tools, outside the workspace', !!ai && /You are the AI inside "SVG Generator"/.test(ai.system) && /Draw: A sun over hills/.test(ai.prompt) && !ai.args.includes('--allowedTools') && ai.cwd !== ws && !ai.cwd.startsWith(ws), ai && JSON.stringify({ cwd: ai.cwd, args: ai.args.slice(0, 12) }))
  await shot('app-svg.png')
  check('…the SVG shows, and is kept in the app’s own storage', /circle/.test(decodeURIComponent((await f.getAttribute('#preview', 'src')) ?? '')) && /circle/.test(fs.readFileSync(path.join(ws, 'Apps/svg-generator/data/store.json'), 'utf8')))

  // ── the sandbox holds ──
  const probe = await f.evaluate(async (port) => {
    const out = {}
    try { out.parent = window.parent.workspace ? 'reached' : 'none' } catch { out.parent = 'blocked' }
    try { localStorage.setItem('x', '1'); out.local = 'allowed' } catch { out.local = 'blocked' }
    try { await fetch(`http://127.0.0.1:${port}/`); out.net = 'reached' } catch { out.net = 'blocked' }
    out.web = await wos.ai.complete('x', { web: true }).then(() => 'allowed', (e) => e.message)
    out.unknown = await new Promise((ok) => {
      const id = 999
      addEventListener('message', (e) => e.data?.id === id && ok(e.data.error || 'ok'))
      parent.postMessage({ __wos: 1, type: 'call', id, method: 'mail.send', args: {} }, '*')
    })
    return out
  }, port)
  await settle(500)
  check('an app cannot reach the workspace app, its storage or the network', probe.parent === 'blocked' && probe.local === 'blocked' && probe.net === 'blocked' && hits === 0, JSON.stringify({ ...probe, hits }))
  check('…web lookup needs "ai.web", and an unknown request is refused', /not allowed to use web lookup/.test(probe.web) && /cannot do/.test(probe.unknown), JSON.stringify(probe))

  // ── the builder ──
  await win.click('[data-testid="apps-back"]')
  await win.click('[data-testid="apps-new"]')
  await win.waitForSelector('[data-testid="chat-app-preview"]', { timeout: 8000 })
  check('"New app" opens the builder chat with the app beside it', (await win.getAttribute('[data-testid="chat-app-preview"]', 'data-app')) === 'new-app' && /What should this app do/.test((await win.textContent('[data-testid="chat-thread"]')) ?? ''))
  const b = calls().length
  await win.click('[data-testid="chat-view"] textarea')
  await win.keyboard.type('A counter that remembers its count')
  await win.keyboard.press('Enter')
  await until(() => calls().length > b)
  const build = calls()[b]
  const allowed = build ? build.args.slice(build.args.indexOf('--allowedTools') + 1) : []
  check('the builder runs with the app brief, may edit only that app’s folder, and loads no settings', !!build && /You build and change ONE app/.test(build.system) && build.args[build.args.indexOf('--setting-sources') + 1] === '' && allowed.includes('Edit(./Apps/new-app/**)') && !allowed.some((t) => /^(Write|Edit|Bash)$/.test(t)) && !build.args.includes('--mcp-config'), build && build.args.join(' '))
  check('…and is told the sandbox, the bridge and the design kit', !!build && /No network at all/.test(build.system) && /wos\.storage\.get/.test(build.system) && /\.wos-btn/.test(build.system))
  // The design check finds the hard-coded red, and the builder fixes it once, on its own.
  const fixed = await until(async () => /Design check: all fixed/.test((await win.textContent('[data-testid="chat-thread"]')) ?? ''), 20000)
  const fixCall = calls().find((c) => /design check found/.test(c.prompt))
  check('the design check catches a hard-coded colour, and the builder fixes it on its own', fixed && /#ff0000/.test(fixCall?.prompt ?? '') && /Design check: 1 thing to fix \(colour\)/.test((await win.textContent('[data-testid="chat-thread"]')) ?? '') && fs.readFileSync(path.join(ws, 'Apps/new-app/style.css'), 'utf8').includes('var(--ink)'), (await win.textContent('[data-testid="chat-thread"]'))?.slice(-400))
  await until(async () => !(await win.$('[data-testid="chat-stop"]')), 10000)
  await settle(800)
  f = await appFrame()
  const counter = await until(async () => /Count: 0/.test((await f.textContent('#n').catch(() => '')) ?? ''), 8000)
  check('the app reloads beside the chat as it is built', counter)
  await shot('app-builder.png')
  await f.click('#inc')
  await f.click('#inc')
  await settle(500)
  await win.click('[data-testid="chat-app-open"]')
  await win.waitForSelector('[data-testid="apps-view"]', { timeout: 8000 })
  f = await appFrame()
  check('"Open in Apps" runs it full size, and it kept its count', await until(async () => /Count: 2/.test((await f.textContent('#n').catch(() => '')) ?? ''), 6000))
  await win.click('[data-testid="apps-duplicate"]')
  await settle(1000)
  const copy = JSON.parse(fs.readFileSync(path.join(ws, 'Apps/new-app-copy/app.json'), 'utf8'))
  check('Duplicate makes an own copy, without the data', copy.name === 'Counter (copy)' && !fs.existsSync(path.join(ws, 'Apps/new-app-copy/data')))
  await win.click('[data-testid="apps-back"]')
  await settle(500)
  await shot('app-gallery.png')
  const cards = await win.$$eval('[data-app-card]', (els) => els.map((e) => e.getAttribute('data-app-card')))
  check('the gallery lists every app', ['new-app', 'new-app-copy', 'svg-generator'].every((s) => cards.includes(s)), JSON.stringify(cards))
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
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log(`\n${total - fails}/${total} passed`)
process.exit(fails ? 1 : 0)
