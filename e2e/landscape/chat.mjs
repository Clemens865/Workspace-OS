/**
 * Chat (real app, real session engine, a fake Claude).
 *
 * - The dock's Chat opens a conversation; a reply renders as Markdown (heading,
 *   bold, code with a copy button, a link) and raw HTML in it stays text.
 * - A chat runs with the light chat brief and web lookup, and its next turn
 *   resumes the same Claude conversation.
 * - A file attached by the clip is uploaded into the workspace and read by the
 *   run; the message shows it.
 * - A page the chat makes opens beside it, in a sandboxed frame.
 * - Conversations are saved in the workspace (older ones move over from the
 *   window's storage), survive a reload, and are found by what was said.
 *
 * Run: npm run e2e:landscape
 */
import { _electron as electron } from 'playwright'
import fs from 'fs'
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

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wos-chat-')))
const ws = path.join(tmp, 'workspace')
fs.mkdirSync(ws)
const outside = path.join(tmp, 'Quarterly notes.txt')
fs.writeFileSync(outside, 'Revenue grew 12 percent in Q3.\n')
const callsFile = path.join(tmp, 'calls.json')
// A page to ask about, served locally (no network in a test).
const http = await import('http')
const server = http.createServer((_q, r) => r.end('<!doctype html><title>Bakery</title><h1>Brot</h1><p>Fresh sourdough every morning.</p>'))
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
const pageUrl = `http://127.0.0.1:${server.address().port}/`
const fake = path.join(tmp, 'claude.cjs')
const REPLY = '## Plan\\n\\n- **first** step\\n\\n```js\\nlet a = 1\\n```\\n\\nRaw: <img src=x onerror="window.__pwned=1">\\n\\nSee [the site](https://example.com).'
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
  calls.push({ prompt, args, system: args[args.indexOf('--append-system-prompt') + 1] || '' });
  fs.writeFileSync(file, JSON.stringify(calls));
  let text = '${REPLY}';
  if (prompt.includes('MAKE-PAGE')) {
    fs.mkdirSync(path.join(process.cwd(), 'Artifacts'), { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), 'Artifacts', 'Hello page.html'), '<!doctype html><h1 id="hi">Hello from the artifact</h1><script>document.getElementById("hi").textContent += " (its script ran)"</script>');
    text = 'I made **a page**: Artifacts/Hello page.html';
  }
  const m = /Context files[^\\n]*\\n([^\\n]+)/.exec(prompt);
  if (m) text = 'I read ' + path.basename(m[1].trim()) + ': ' + fs.readFileSync(m[1].trim(), 'utf8').trim();
  for (const part of text.match(/[\\s\\S]{1,20}/g)) process.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: part } } }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', session_id: 'aaaaaaaa-bbbb-cccc-dddd-00000000000' + calls.length, is_error: false, result: 'ok' }) + '\\n');
});
`,
)
fs.chmodSync(fake, 0o755)
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
// Settings for the test, and one session from before (kept in the window's storage) to move over.
await win.evaluate((ws) => {
  const K = 'workspace-os:settings'
  let c = {}
  try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* fresh */ }
  localStorage.setItem(K, JSON.stringify({ ...c, startOn: 'landscape', terminalOpen: false, sessionCases: 'manual', agentModel: '', learnFromSessions: false }))
  localStorage.setItem('workspace-os:browser-assistant', JSON.stringify({ open: true, width: 340 }))
  const t = Date.now() - 3 * 86_400_000
  localStorage.setItem(`wos:sessions:${ws}`, JSON.stringify([{ id: 'sold1', title: 'An older session', agentName: null, caseId: null, createdAt: t, lastAt: t, turns: 1, files: [], lastRunId: null, messages: [{ role: 'user', text: 'about the garden', at: t }] }]))
}, ws)
const reload = async () => {
  await win.reload()
  await win.waitForSelector('[data-shell="landscape"]', { timeout: 20000 })
  for (let i = 0; i < 40 && (await win.$('[class*="_splash_"]')); i++) {
    await win.keyboard.press('Enter').catch(() => {})
    await win.waitForTimeout(400)
  }
}
await reload()
const settle = (ms = 800) => win.waitForTimeout(ms)
const until = async (fn, ms = 15000) => {
  for (let t = 0; t < ms; t += 300) {
    if (await fn()) return true
    await settle(300)
  }
  return false
}
const say = async (text) => {
  const n = calls().length
  await win.click('[data-testid="chat-view"] textarea, [data-testid="chat-view"] [contenteditable="true"]')
  await win.keyboard.type(text)
  await win.keyboard.press('Enter')
  await until(() => calls().length > n)
  await until(async () => !(await win.$('[data-testid="chat-stop"]')), 8000)
  await settle(500)
  return calls()[n]
}

try {
  await win.click('[data-dock="chat"]')
  await win.waitForSelector('[data-testid="chat-view"]', { timeout: 8000 })
  check('the dock opens Chat, ready for a first message', /What’s on your mind/.test((await win.textContent('[data-testid="chat-thread"]')) ?? ''))
  check('…and its history already holds the session kept in the window before', !!(await win.$('[data-chat-item="sold1"]')))

  const first = await say('Hello there, plan my week')
  check('a chat runs with the light chat brief, not the office manual', /talking with the person in the Chat of Workspace OS/.test(first?.system ?? '') && !/office-docgen skill/.test(first?.system ?? ''), (first?.system ?? '').slice(0, 200))
  const allowed = first ? first.args.slice(first.args.indexOf('--allowedTools') + 1) : []
  check('…with web lookup and no shell', allowed.includes('WebSearch') && !allowed.includes('Bash'), allowed.join(' ').slice(0, 300))
  const thread = '[data-testid="chat-thread"]'
  check('the reply renders as Markdown: heading, bold, code with a copy button, a link', !!(await win.$(`${thread} h2`)) && !!(await win.$(`${thread} strong`)) && !!(await win.$(`${thread} [data-chat-copy]`)) && !!(await win.$(`${thread} [data-chat-link="https://example.com"]`)))
  check('…and raw HTML in it stays text', !(await win.$(`${thread} img`)) && /<img src=x/.test((await win.textContent(thread)) ?? '') && !(await win.evaluate(() => window.__pwned)))
  check('the conversation is in the history, named by its first message', /Hello there, plan my week/.test((await win.textContent('[data-testid="chat-history"]')) ?? ''))

  const second = await say('And the weekend?')
  check('the next message resumes the same conversation', second?.args.includes('--resume') && second.args[second.args.indexOf('--resume') + 1] === 'aaaaaaaa-bbbb-cccc-dddd-000000000001', second?.args.join(' '))

  // ── a file from outside the workspace, attached by the clip ──
  await win.setInputFiles('[data-testid="chat-file-input"]', outside)
  await until(async () => !!(await win.$('[data-attachment="Quarterly notes.txt"]')), 6000)
  check('an attached file shows before sending', !!(await win.$('[data-attachment="Quarterly notes.txt"]')))
  const read = await say('What is in it?')
  const up = /Context files[^\n]*\n([^\n]+)/.exec(read?.prompt ?? '')?.[1]?.trim()
  check('…it is uploaded into the workspace and handed to the run', !!up && up.startsWith(path.join(ws, '.workspace-os', 'uploads')) && fs.readFileSync(up, 'utf8').includes('Revenue grew 12 percent'), up)
  check('…the reply used it, and the message shows it', /I read Quarterly notes\.txt: Revenue grew 12 percent/.test((await win.textContent(thread)) ?? '') && /Quarterly notes\.txt/.test(await win.$$eval(`${thread} [data-role="user"]`, (els) => els[els.length - 1]?.textContent ?? '')), (await win.textContent(thread))?.slice(-300))

  // ── a page it makes opens beside it ──
  await say('MAKE-PAGE please')
  const card = await until(async () => !!(await win.$('[data-chat-artifact="Hello page.html"]')), 6000)
  check('the page it made shows under the reply', card)
  const opened = await until(async () => !!(await win.$('[data-testid="chat-artifact"][data-kind="html"]')), 6000)
  const frame = await win.$('[data-testid="chat-artifact-frame"]')
  const sandbox = frame ? await frame.getAttribute('sandbox') : null
  const inner = frame ? await frame.contentFrame() : null
  let ran = ''
  for (let i = 0; i < 20 && !/script ran/.test(ran); i++) {
    ran = (await inner?.textContent('#hi').catch(() => '')) ?? ''
    await settle(250)
  }
  check('…and opens beside the chat in a sandboxed frame, where its own script runs', opened && /^allow-scripts/.test(sandbox ?? '') && !/allow-same-origin/.test(sandbox ?? '') && /Hello from the artifact \(its script ran\)/.test(ran), `${opened} ${sandbox} ${ran}`)
  // WOS_SHOT_DIR=<dir>: keep pictures of the chat for a look by eye.
  const shots = process.env.WOS_SHOT_DIR
  if (shots) {
    await settle(800)
    await win.screenshot({ path: path.join(shots, 'chat-artifact.png') })
  }
  await win.click('[data-testid="chat-artifact-close"]')
  if (shots) {
    await settle(600)
    await win.screenshot({ path: path.join(shots, 'chat-thread.png') })
  }

  // ── saved in the workspace, back after a reload, found by its words ──
  const file = path.join(ws, '.workspace-os', 'sessions.json')
  await until(() => fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('MAKE-PAGE please'), 5000)
  const stored = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []
  const chat = stored.find((s) => s.kind === 'chat')
  check('conversations are saved in the workspace, with the older one moved over', !!chat && chat.messages.length >= 8 && stored.some((s) => s.id === 'sold1'), JSON.stringify(stored.map((s) => [s.id, s.kind, s.messages.length])))
  await reload()
  await win.click('[data-dock="chat"]')
  await win.waitForSelector('[data-testid="chat-view"]', { timeout: 8000 })
  await win.click(`[data-chat-item="${chat?.id}"]`).catch(() => {})
  await settle(600)
  check('after a reload the chat is still there, every message', /Hello there, plan my week[\s\S]*MAKE-PAGE please/.test((await win.textContent(thread)) ?? ''))
  await win.fill('[data-testid="chat-search"]', 'weekend')
  await settle(300)
  const found = await win.$$eval('[data-chat-item]', (els) => els.map((e) => e.getAttribute('data-chat-item')))
  check('search finds a chat by what was said in it', found.length === 1 && found[0] === chat?.id, JSON.stringify(found))

  // ── beside your work: the same conversation next to the stage ──
  await win.fill('[data-testid="chat-search"]', '')
  await settle(300)
  await win.click('[data-testid="chat-beside"]')
  await until(async () => (await win.getAttribute('[data-shell="landscape"]', 'data-view')) === 'stage', 5000)
  const side = '[data-testid="chat-side"]'
  await win.waitForSelector(side, { timeout: 5000 }).catch(() => {})
  check('"Beside your work" puts the same conversation beside the stage', (await win.getAttribute(side, 'data-session').catch(() => null)) === chat?.id && /MAKE-PAGE please/.test((await win.textContent(side)) ?? ''))
  const n = calls().length
  await win.click(`${side} textarea`)
  await win.keyboard.type('One more thing from the side')
  await win.keyboard.press('Enter')
  await until(() => calls().length > n)
  const fromSide = calls()[n]
  check('…a message there continues it (same Claude conversation)', fromSide?.args.includes('--resume') && /One more thing from the side/.test(fromSide.prompt), fromSide?.args.join(' '))
  await until(async () => !(await win.$(`${side} [data-testid="chat-stop"]`)), 8000)
  await win.click('[data-testid="chat-side-home"]')
  await until(async () => !!(await win.$('[data-testid="chat-view"]')), 5000)
  check('"Chat" takes it home: the Chat view, on this conversation, with the side message', !(await win.$(side)) && /One more thing from the side/.test((await win.textContent(thread).catch(() => '')) ?? '') && !!(await win.$(`[data-chat-item="${chat?.id}"][class*="historyOn"]`)))

  // ── a web link opens in the in-app browser, the chat beside it ──
  await win.click(`${thread} [data-chat-link="https://example.com"]`)
  await until(async () => (await win.getAttribute('[data-shell="landscape"]', 'data-view')) === 'stage', 5000)
  check('a web link in a reply opens the in-app browser with the chat beside it', (await win.getAttribute('[data-shell="landscape"]', 'data-view')) === 'stage' && (await win.getAttribute(side, 'data-session').catch(() => null)) === chat?.id)
  await win.click('[data-testid="stage-chat"]')
  await settle(300)
  const hidden = !(await win.$(side))
  await win.click('[data-testid="stage-chat"]')
  await settle(300)
  check('the stage\'s Chat button hides and shows it', hidden && !!(await win.$(side)))

  // ── asking about a page starts a chat beside it ──
  await win.evaluate((url) => window.dispatchEvent(new CustomEvent('wos:browser-open', { detail: { url } })), pageUrl)
  const asked = await until(async () => !!(await win.$('textarea[placeholder^="Ask about this page"]:not([disabled])')), 15000)
  if (asked) {
    const m = calls().length
    await win.fill('textarea[placeholder^="Ask about this page"]', 'What do they sell?')
    await win.keyboard.press('Enter')
    await until(() => calls().length > m)
    const pageCall = calls()[m]
    const sideId = await win.getAttribute(side, 'data-session').catch(() => null)
    check('a question about the page opens a new chat beside it, told the page', !!sideId && sideId !== chat?.id && /in the in-app browser: http:\/\/127\.0\.0\.1/.test(pageCall?.prompt ?? '') && /Fresh sourdough/.test(pageCall?.prompt ?? '') && /talking with the person in the Chat/.test(pageCall?.system ?? ''), (pageCall?.prompt ?? '').slice(0, 300))
    const kept = await win.evaluate((id) => window.__sessionStore.get(id), sideId)
    if (shots) {
      await until(async () => !(await win.$(`${side} [data-testid="chat-stop"]`)), 8000)
      await settle(800)
      await win.screenshot({ path: path.join(shots, 'chat-side.png') })
    }
    check('…saved in the chat history under the question', kept?.kind === 'chat' && kept.title === 'What do they sell' && kept.messages[0]?.text === 'What do they sell?', JSON.stringify(kept && { kind: kept.kind, title: kept.title, first: kept.messages[0]?.text }))
  } else check('the browser\'s page assistant is there to ask', false)
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
