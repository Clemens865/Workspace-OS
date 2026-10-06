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
const handsFile = path.join(tmp, 'hands.json')
const ACTION_CLI = path.join(root, 'resources/wos-action/action-cli.cjs')
const fake = path.join(tmp, 'claude.cjs')
const COUNTER = `<!doctype html><html><head><title>Counter</title><link rel="stylesheet" href="style.css"></head><body><div class="wos-app"><div class="wos-main"><h1 id="n">Count: 0</h1><button id="inc" class="wos-btn primary">+1</button></div></div><script src="app.js"></script></body></html>`
// The first build forgets to save: the app's own tests catch it, and the builder fixes it.
const COUNTER_JS_BUGGY = `let n = 0; const show = () => (document.getElementById('n').textContent = 'Count: ' + n); wos.storage.get('n').then((v) => { n = v || 0; show() }); document.getElementById('inc').onclick = () => { n++; show() }`
const TESTS = { scenarios: [
  { name: 'Counts up', check: 'Pressing +1 raises the count', steps: [{ do: 'expect', target: '#n', contains: 'Count: 0' }, { do: 'click', text: '+1' }, { do: 'click', target: '#inc' }, { do: 'expect', target: '#n', equals: 'Count: 2' }, { do: 'expectJs', js: "(await wos.storage.get('n')) === 2" }] },
  { name: 'Remembers after a reload', check: 'The count survives a reload', store: { n: 5 }, steps: [{ do: 'expect', target: '#n', contains: 'Count: 5' }, { do: 'click', target: '#inc' }, { do: 'reload' }, { do: 'expect', target: '#n', contains: 'Count: 6' }] },
] }
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
  let files = [];
  try { files = fs.readdirSync(process.cwd()).slice(0, 8); } catch {}
  calls.push({ prompt, args, system, cwd: process.cwd(), files });
  fs.writeFileSync(file, JSON.stringify(calls));
  let text = 'Done.';
  if (system.includes('You are the AI inside "SVG Generator"')) text = prompt.includes('Critique it as an art director') ? '<svg viewBox="0 0 512 512"><rect width="512" height="512" fill="#383c2b"/><circle id="refined" cx="256" cy="256" r="120" fill="#d4f04a"/></svg>' : '<svg viewBox="0 0 512 512"><circle cx="256" cy="256" r="160" fill="#d97757"/></svg>';
  // The app harness: the product brief, then the review of the running app.
  else if (system.includes('You are the product lead')) text = '# Counter\\nCounts, and remembers.\\n## Core jobs\\n- Count\\n## Acceptance checks\\n- [ ] Pressing +1 raises the count\\n- [ ] The count survives a reload\\n- [ ] The count has a label\\n## Later\\n- Add a reset';
  else if (system.includes('demanding QA lead')) {
    const first = !calls.slice(0, -1).some((c) => (c.system || '').includes('demanding QA lead'));
    text = JSON.stringify({ checks: [{ check: 'Pressing +1 raises the count', met: true }, { check: 'The count has a label', met: !first, note: first ? 'no label next to the number' : '' }], looks: [], next: ['Add a reset button', 'Count in steps of five', 'Show a history of counts'] });
  }
  else if (system.includes('senior QA engineer')) text = ${JSON.stringify(JSON.stringify(TESTS))};
  // A resumed turn carries no system prompt: the fix request is known by its words.
  if (prompt.includes("end-to-end tests (Apps/new-app/TESTS.json) ran in the live app")) {
    fs.writeFileSync(path.join(process.cwd(), 'Apps', 'new-app', 'app.js'), ${JSON.stringify(COUNTER_JS)});
    text = 'The count is now saved after each press.';
  } else if (prompt.includes('review of the running app against its brief')) {
    fs.writeFileSync(path.join(process.cwd(), 'Apps', 'new-app', 'index.html'), ${JSON.stringify(COUNTER.replace('<h1 id="n">', '<p class="wos-label">Clicks</p><h1 id="n">'))});
    text = 'Added a label above the count.';
  } else if (prompt.includes("design check found")) {
    fs.writeFileSync(path.join(process.cwd(), 'Apps', 'new-app', 'style.css'), 'h1 { color: var(--ink) }');
    text = 'Fixed: the heading now uses the ink token.';
  } else if (system.includes('You build and change ONE app')) {
    const dir = path.join(process.cwd(), 'Apps', 'new-app');
    fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify({ name: 'Counter', description: 'Counts, and remembers.', icon: '🔢', permissions: [], entry: 'index.html' }));
    fs.writeFileSync(path.join(dir, 'index.html'), ${JSON.stringify(COUNTER)});
    fs.writeFileSync(path.join(dir, 'app.js'), ${JSON.stringify(COUNTER_JS_BUGGY)});
    fs.writeFileSync(path.join(dir, 'style.css'), 'h1 { color: #ff0000 }');
    // Mid-turn, the builder looks at and uses what it built (the real wos-action CLI, with its run's token).
    const cli = (...a) => { try { return JSON.parse(require('node:child_process').execFileSync(process.execPath, [${JSON.stringify(ACTION_CLI)}, 'run', ...a], { env: process.env, encoding: 'utf8' })) } catch (e) { try { return JSON.parse(String(e.stdout)) } catch { return { ok: false, error: e.message } } } };
    const hands = { reload: cli('app.reload'), click: cli('app.click', '{"text":"+1"}'), check: cli('app.check', '{"target":"#n","equals":"Count: 1"}'), miss: cli('app.check', '{"target":"#n","equals":"Count: 7"}'), look: cli('app.look'), write: cli('app.check', '{"js":"(await wos.storage.set(\\'probe\\', 1), true)"}'), data: cli('app.data'), browser: cli('browser.navigate', '{"url":"https://example.com"}') };
    hands.shotThere = !!hands.look.result && fs.existsSync(path.join(process.cwd(), hands.look.result.screenshot.split(' ')[0]));
    fs.writeFileSync(${JSON.stringify(handsFile)}, JSON.stringify(hands));
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
  check('…it asks as a designer, in the format and palette picked, not "keep it simple"', /senior brand designer/.test(ai.system) && !/keep it simple/i.test(ai.system) && /viewBox="0 0 512 512"/.test(ai.prompt) && /Palette \(Night olive\)/.test(ai.prompt) && ai.args[ai.args.indexOf('--setting-sources') + 1] === '', ai.prompt)
  // The art director: the drawing, rendered, goes back to the model as an image it alone may read.
  await until(async () => /refined/.test(decodeURIComponent((await f.getAttribute('#preview', 'src').catch(() => '')) ?? '')), 15000)
  const director = calls().slice(before).find((c) => /Critique it as an art director/.test(c.prompt))
  const dTools = director ? director.args.slice(director.args.indexOf('--allowedTools') + 1, director.args.indexOf('--allowedTools') + 2) : []
  check('…the art director looks at the rendered drawing and its better version is shown', !!director && director.files.includes('image-1.png') && dTools[0] === 'Read(./**)' && /image-1\.png/.test(director.prompt) && !director.cwd.startsWith(ws) && !(await f.isHidden('#versions')), director && JSON.stringify({ files: director.files, tools: dTools }))
  await f.click('#versions [data-v="draft"]')
  check('…and the draft is still there to compare', !/refined/.test(decodeURIComponent((await f.getAttribute('#preview', 'src')) ?? '')))

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
  // The brief comes first now; the build is the builder's call.
  const isBuild = (c) => /You build and change ONE app/.test(c.system)
  await until(() => calls().slice(b).some(isBuild), 20000)
  const build = calls().slice(b).find(isBuild)
  const allowed = build ? build.args.slice(build.args.indexOf('--allowedTools') + 1) : []
  check('the builder runs with the app brief, may edit only that app’s folder, and loads no settings', !!build && /You build and change ONE app/.test(build.system) && build.args[build.args.indexOf('--setting-sources') + 1] === '' && allowed.includes('Edit(./Apps/new-app/**)') && !allowed.some((t) => /^(Write|Edit|Bash)$/.test(t) || (/^Bash\(/.test(t) && t !== 'Bash(wos-action:*)')) && !build.args.includes('--mcp-config'), build && build.args.join(' '))
  check('…and is told the sandbox, the bridge and the design kit', !!build && /No network at all/.test(build.system) && /wos\.storage\.get/.test(build.system) && /\.wos-btn/.test(build.system))
  await until(() => fs.existsSync(handsFile), 30000)
  const hands = fs.existsSync(handsFile) ? JSON.parse(fs.readFileSync(handsFile, 'utf8')) : {}
  check('the builder may drive its app mid-turn (wos-action, no other shell), and its click is real', allowed.includes('Bash(wos-action:*)') && hands.reload?.ok && hands.click?.ok && hands.check?.result === 'holds' && /does not hold: "#n" is "Count: 1", expected "Count: 7"/.test(hands.miss?.result ?? ''), JSON.stringify(hands).slice(0, 600))
  check('…it sees the page’s controls and a screenshot it can read', (hands.look?.result?.items ?? []).some((i) => /^button#inc(\.[\w.-]+)? "\+1" at /.test(i) || /^#inc "\+1" at /.test(i)) && hands.shotThere && Array.isArray(hands.look?.result?.errors), JSON.stringify(hands.look).slice(0, 400))
  check('…on scratch data, and its grant reaches nothing but its own app', hands.write?.result === 'holds' && JSON.stringify(hands.data?.result?.store) === '{"probe":1}' && !fs.existsSync(path.join(ws, 'Apps/new-app/data/store.json')) && /not granted/.test(hands.browser?.error ?? ''), JSON.stringify({ data: hands.data, browser: hands.browser }))
  const briefCall = calls().slice(b).find((c) => /You are the product lead/.test(c.system))
  check('a new app starts from a product brief, and the build is held to it', !!briefCall && /A counter that remembers its count/.test(briefCall.prompt) && /^# Counter/.test(fs.readFileSync(path.join(ws, 'Apps/new-app/BRIEF.md'), 'utf8')) && /Apps\/new-app\/BRIEF\.md: read it first/.test(build?.prompt ?? '') && /Product brief written \(BRIEF\.md\): 3 acceptance checks/.test((await win.textContent('[data-testid="chat-thread"]')) ?? ''), build?.prompt)
  // The design check finds the hard-coded red, and the builder fixes it once, on its own.
  const fixed = await until(async () => /Design check: all fixed/.test((await win.textContent('[data-testid="chat-thread"]')) ?? ''), 20000)
  const fixCall = calls().find((c) => /design check found/.test(c.prompt))
  check('the design check catches a hard-coded colour, and the builder fixes it on its own', fixed && /#ff0000/.test(fixCall?.prompt ?? '') && /Design check: 1 thing to fix \(colour\)/.test((await win.textContent('[data-testid="chat-thread"]')) ?? '') && fs.readFileSync(path.join(ws, 'Apps/new-app/style.css'), 'utf8').includes('var(--ink)'), (await win.textContent('[data-testid="chat-thread"]'))?.slice(-400))
  // The app's own tests: written from the brief and files, run in the live preview with real clicks, failures fixed.
  const tested = await until(async () => /Tests: all 2 passed in the running app after 1 fix round/.test((await win.textContent('[data-testid="chat-thread"]')) ?? ''), 40000)
  let thread = (await win.textContent('[data-testid="chat-thread"]')) ?? ''
  const testsCall = calls().find((c) => /senior QA engineer/.test(c.system))
  check('the app’s tests are written from its brief and files', !!testsCall && /The count survives a reload/.test(testsCall.prompt) && /id="inc"/.test(testsCall.prompt) && /A counter that remembers its count/.test(testsCall.prompt) && testsCall.args[testsCall.args.indexOf('--setting-sources') + 1] === '' && JSON.parse(fs.readFileSync(path.join(ws, 'Apps/new-app/TESTS.json'), 'utf8')).scenarios.length === 2 && /Tests written \(TESTS\.json\): 2 scenarios/.test(thread), testsCall?.prompt?.slice(0, 300))
  const testFix = calls().find((c) => /end-to-end tests \(Apps\/new-app\/TESTS\.json\) ran in the live app/.test(c.prompt))
  check('…they run in the live app with real clicks, and catch the count that is never saved', /Tests: 0 of 2 passed \(failing: Counts up, Remembers after a reload\)\. Fixing, round 1 of 3/.test(thread) && /"Counts up".*step 5 failed: This was not true/.test(testFix?.prompt ?? '') && /"Remembers after a reload".*step 4 failed: .*Count: 5.*expected it to contain "Count: 6"/.test(testFix?.prompt ?? '') && /Apps\/new-app\/\.tests\/1\.png \(look at it|Apps\/new-app\/\.tests\/1\.png; look at it/.test(testFix?.prompt ?? ''), testFix?.prompt ?? thread.slice(-600))
  check('…the builder fixes it, and they pass on the next run', tested && /await wos\.storage\.set/.test(fs.readFileSync(path.join(ws, 'Apps/new-app/app.js'), 'utf8')), thread.slice(-500))
  check('…on scratch data: the person’s own saved data is untouched', !fs.existsSync(path.join(ws, 'Apps/new-app/data/store.json')))
  // The review: the running app (a screenshot) against the brief, one fix, then three next steps.
  const offered = await until(async () => !!(await win.$('[data-testid="chat-suggest"]')), 40000)
  const reviewCall = calls().find((c) => /demanding QA lead/.test(c.system))
  thread = (await win.textContent('[data-testid="chat-thread"]')) ?? ''
  check('the review looks at a screenshot of the running app with its brief, and sends what is missing back once', offered && reviewCall?.files.includes('image-1.png') && /The count has a label/.test(reviewCall?.prompt ?? '') && /Review: 1 of 2 checks met\. Fixing…/.test(thread) && /Clicks/.test(fs.readFileSync(path.join(ws, 'Apps/new-app/index.html'), 'utf8')), thread.slice(-500))
  check('…the review hears how the tests went, and the tests run again after its fix', /end-to-end tests, just run in the live app with real clicks: all 2 passed/.test(reviewCall?.prompt ?? '') && /Tests after the review fix: all 2 passed/.test(thread), thread.slice(-500))
  const chips = await win.$$eval('[data-suggest]', (els) => els.map((e) => e.getAttribute('data-suggest')))
  check('…then offers three next steps to click', chips.length === 3 && chips[0] === 'Add a reset button', JSON.stringify(chips))
  await shot('app-harness.png')
  const n = calls().length
  await win.click('[data-suggest="Add a reset button"]')
  await until(() => calls().slice(n).some((c) => c.prompt.includes('Add a reset button')), 10000)
  check('…and a click asks for it', /Add a reset button/.test((await win.textContent('[data-testid="chat-thread"]')) ?? '') && calls().slice(n).some((c) => c.prompt.includes('Add a reset button')))
  await until(async () => !(await win.$('[data-testid="chat-stop"]')) && calls().filter((c) => /demanding QA lead/.test(c.system)).length >= 2, 40000)
  await settle(1500)
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
