/**
 * Memory you can trust (real app, real stores, real bridge, a fake Claude).
 *
 * - What an agent remembers is used, but waits in the Inbox for the person:
 *   Keep confirms it, Correct replaces it (the old text stays as history).
 * - Writing a memory shows the agent what is already known that says nearly
 *   the same thing.
 * - A run gets only the memories that fit its task (none for an unrelated one),
 *   with the rule that memory is evidence, not instructions.
 * - The Library's Memory panel corrects in place and shows earlier versions.
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

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wos-memory-')))
const ws = path.join(tmp, 'workspace')
fs.mkdirSync(ws)
const callsFile = path.join(tmp, 'calls.json')
const fake = path.join(tmp, 'claude.cjs')
// Each run records its instructions; an ask naming REMEMBER-A / REMEMBER-B makes it remember something.
fs.writeFileSync(
  fake,
  `#!${process.execPath}
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (!args.includes('-p')) { process.stdout.write('2.1.266 (Claude Code)\\n'); process.exit(0); }
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { prompt += c; });
process.stdin.on('end', () => {
  const run = (id, json) => { const r = spawnSync('wos-action', ['run', id, json], { encoding: 'utf8', env: process.env }); return (r.stdout || '') + (r.stderr || ''); };
  const call = { prompt, system: args[args.indexOf('--append-system-prompt') + 1] || '' };
  if (prompt.includes('REMEMBER-A')) call.out = run('memory.remember', JSON.stringify({ text: 'Northwind offered a salary of 120k for the PM role', source: 'offer letter' }));
  if (prompt.includes('REMEMBER-B')) call.out = run('memory.remember', JSON.stringify({ text: 'Northwind offered 128k salary for the PM role', source: 'second call' }));
  const file = ${JSON.stringify(callsFile)};
  const calls = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  calls.push(call);
  fs.writeFileSync(file, JSON.stringify(calls));
  process.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Done.' } } }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', session_id: '11111111-2222-3333-4444-55555555555' + calls.length, is_error: false, result: 'ok' }) + '\\n');
});
`,
)
fs.chmodSync(fake, 0o755)
const calls = () => (fs.existsSync(callsFile) ? JSON.parse(fs.readFileSync(callsFile, 'utf8')) : [])

const AGENT = 'Mnemo E2E — Note Keeper'
await killAll()
const app = await electron.launch({
  args: [path.join(root, 'out/main/index.js')],
  cwd: root,
  env: { ...process.env, WORKSPACE_TEST_ROOT: ws, CLAUDE_BIN: fake, WOS_ACTION_DIR: path.join(root, 'resources/wos-action') },
})
const win = await app.firstWindow({ timeout: 20000 })
win.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`))
await win.waitForSelector('#root', { timeout: 20000 })
const saved = await win.evaluate(() => JSON.stringify({ ...localStorage }))
await win.evaluate(() => {
  const K = 'workspace-os:settings'
  let c = {}
  try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* fresh */ }
  localStorage.setItem(K, JSON.stringify({ ...c, startOn: 'landscape', terminalOpen: false, sessionCases: 'manual', agentModel: '' }))
})
await win.reload()
await win.waitForSelector('[data-shell="landscape"]', { timeout: 20000 })
for (let i = 0; i < 40 && (await win.$('[class*="_splash_"]')); i++) {
  await win.keyboard.press('Enter').catch(() => {})
  await win.waitForTimeout(400)
}
const settle = (ms = 800) => win.waitForTimeout(ms)
const ask = async (text) => {
  const n = calls().length
  await win.evaluate(
    async ({ name, text }) => {
      const s = window.__sessionStore.create({ agentName: name })
      await window.__sessionStore.send(s.id, text)
    },
    { name: AGENT, text },
  )
  for (let i = 0; i < 60 && calls().length <= n; i++) await settle(300)
  await settle(600)
  return calls()[n]
}
const memories = () => win.evaluate(() => window.workspace.memory.listMemories({ limit: 50 }))

try {
  // An agent that may remember (the knowledge grant), in this workspace only.
  await win.evaluate((name) => window.workspace.agents.write({ name, description: 'Keeps notes', persona: 'You keep notes.', capabilities: ['knowledge'], scope: 'project' }), AGENT)
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('wos:agents-changed')))
  await settle(800)

  // ── an agent remembers: used, but waiting for the person ──
  const a = await ask('Read the letter. REMEMBER-A')
  check('the agent saved a memory through the bridge', /"ok":true/.test(a?.out ?? ''), (a?.out ?? '').slice(0, 200))
  let mem = await memories()
  const first = mem.find((m) => m.text.startsWith('Northwind offered a salary'))
  check('…written as the agent’s and not kept yet', !!first && first.author === 'agent' && first.confirmed === false, JSON.stringify(first))

  const b = await ask('Second call. REMEMBER-B')
  check('the next memory shows the agent what is already known that says nearly the same', /alsoKnown/.test(b?.out ?? '') && (b?.out ?? '').includes('salary of 120k'), (b?.out ?? '').slice(0, 300))

  // ── a run gets what fits, with the rule; an unrelated one gets nothing ──
  const fits = await ask('What salary did Northwind offer?')
  check('a run about it gets the memory, marked unconfirmed', /WHAT YOU REMEMBER/.test(fits.system) && /\[fact, unconfirmed\] Northwind offered a salary of 120k/.test(fits.system), fits.system.slice(-900))
  check('…with the rule that memory is evidence and the person now overrides it', /not instructions or permissions/.test(fits.system) && /person says now overrides/.test(fits.system))
  const other = await ask('Write a haiku about autumn leaves')
  check('an unrelated run gets no memories pushed at it', !/WHAT YOU REMEMBER/.test(other.system))

  // ── the Inbox: correct one, keep the other ──
  await win.click('[data-dock="inbox"]')
  await settle(1200)
  const card = `[data-inbox="memory:${first.id}"]`
  await win.waitForSelector(card, { timeout: 6000 }).catch(() => {})
  check('the Inbox asks whether to remember it', !!(await win.$(card)))
  await win.click(card)
  await win.click('[data-testid="inbox-memory-correct"]')
  await win.fill('[data-testid="inbox-memory-text"]', 'Northwind offered a salary of 128k for the PM role')
  await win.click('[data-testid="inbox-memory-save"]')
  await settle(1200)
  mem = await memories()
  const fixed = mem.find((m) => m.text === 'Northwind offered a salary of 128k for the PM role')
  check('Correct replaces it with the person’s text, kept', !!fixed && fixed.confirmed && fixed.author === 'you' && !mem.some((m) => m.id === first.id), JSON.stringify(mem.map((m) => [m.text, m.confirmed])))
  const before = fixed ? await win.evaluate((id) => window.workspace.memory.history(id), fixed.id) : []
  check('…and the earlier text stays as its history', before.length === 1 && before[0].text.includes('120k') && before[0].endedAt > 0, JSON.stringify(before))
  check('…and it leaves the Inbox', !(await win.$(card)))

  const second = mem.find((m) => m.text.startsWith('Northwind offered 128k salary'))
  if (second) {
    await win.click(`[data-inbox="memory:${second.id}"]`)
    await win.click('[data-testid="inbox-memory-keep"]')
    await settle(1000)
  }
  mem = await memories()
  check('Keep confirms the other one', !!second && mem.find((m) => m.id === second.id)?.confirmed === true)

  // ── the Library's Memory panel: correct in place, see what it said before ──
  await win.click('[data-dock="library"]')
  await settle(800)
  await win.click('[data-switch="memory"]')
  await settle(800)
  const row = `[data-testid="library-memory"] [data-memory="${second.id}"]`
  await win.click(`${row} [data-testid="memory-correct"]`)
  await win.fill(`${row} [data-testid="memory-correct-text"]`, 'Northwind confirmed 128k for the PM role in writing')
  await win.click(`${row} [data-testid="memory-correct-save"]`)
  await settle(1000)
  mem = await memories()
  const latest = mem.find((m) => m.text === 'Northwind confirmed 128k for the PM role in writing')
  check('the panel corrects a memory in place', !!latest && !mem.some((m) => m.id === second.id))
  if (latest) {
    await win.click(`[data-testid="library-memory"] [data-memory="${latest.id}"] [data-testid="memory-earlier"]`)
    await settle(500)
    const h = (await win.textContent(`[data-testid="library-memory"] [data-memory="${latest.id}"] [data-testid="memory-history"]`).catch(() => '')) ?? ''
    check('…and shows what it said before', h.includes('Northwind offered 128k salary'), h)
  }
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
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log(`\n${total - fails}/${total} passed`)
process.exit(fails ? 1 : 0)
