/**
 * The wiki that keeps itself (real app, real files, real index, a fake Claude).
 *
 * - Library → Notes adds a file: the model reads it once, the app writes linked
 *   pages and an index into Wiki/, and the Notes list and graph show them.
 * - Adding it again unchanged asks the model nothing.
 * - An agent queues a follow-up through the bridge; the page it names is shown
 *   to the model in full and updated in place.
 * - A source changed since it was added is named, and Read again re-reads it;
 *   Undo puts the pages back.
 * - A file with nothing worth a page writes no page.
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

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wos-wiki-')))
const ws = path.join(tmp, 'workspace')
for (const d of ['Work', 'Mail', 'Notes']) fs.mkdirSync(path.join(ws, d), { recursive: true })
fs.writeFileSync(path.join(ws, 'Work/Offer letter.md'), 'Offer letter. Northwind offers Clara the PM role at 120k, starting 1 March. Contact: Anna Berg, head of product.\n')
fs.writeFileSync(path.join(ws, 'Mail/Follow-up.md'), 'Mail from Anna Berg: Northwind raised the salary to 128k after our call.\n')
fs.writeFileSync(path.join(ws, 'Notes/groceries.md'), 'milk, eggs, bread, coffee beans, basil and some more things\n')

const wikiLog = path.join(tmp, 'wiki-calls.json')
const callsFile = path.join(tmp, 'calls.json')
const fake = path.join(tmp, 'claude.cjs')
const NW1 = { title: 'Northwind', type: 'organization', summary: 'Logistics company that offered Clara the PM role.', body: 'Offered Clara the PM role at 120k, start 1 March. Contact: [[Anna Berg]].' }
const NW2 = { ...NW1, summary: 'Logistics company; the offer was raised to 128k.', body: 'Offered Clara the PM role at 128k (raised from 120k), start 1 March. Contact: [[Anna Berg]].' }
const ANNA = { title: 'Anna Berg', type: 'person', summary: 'Head of product at Northwind.', body: 'Head of product at [[Northwind]]; sent the offer.' }
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
  if (prompt.includes('You keep a wiki')) {
    const f = ${JSON.stringify(wikiLog)};
    const seen = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
    seen.push(prompt);
    fs.writeFileSync(f, JSON.stringify(seen));
    const src = prompt.slice(prompt.indexOf('<<<SOURCE'));
    const pages = /Offer letter/.test(src) ? [${JSON.stringify(NW1)}, ${JSON.stringify(ANNA)}] : /raised the salary/.test(src) ? [${JSON.stringify(NW2)}] : [];
    process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: JSON.stringify({ pages }) }] } }) + '\\n');
    process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: 'ok' }) + '\\n');
    return;
  }
  const call = { prompt, system: args[args.indexOf('--append-system-prompt') + 1] || '' };
  if (prompt.includes('WIKI-ADD')) {
    const r = spawnSync('wos-action', ['run', 'knowledge.wiki-add', JSON.stringify({ path: 'Mail/Follow-up.md' })], { encoding: 'utf8', env: process.env });
    call.out = (r.stdout || '') + (r.stderr || '');
  }
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
const wikiCalls = () => (fs.existsSync(wikiLog) ? JSON.parse(fs.readFileSync(wikiLog, 'utf8')) : [])
const calls = () => (fs.existsSync(callsFile) ? JSON.parse(fs.readFileSync(callsFile, 'utf8')) : [])
const pageText = (t) => {
  const f = path.join(ws, 'Wiki', `${t}.md`)
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
}

const AGENT = 'Wikia E2E — Page Keeper'
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
const until = async (fn, ms = 20000) => {
  for (let t = 0; t < ms; t += 300) {
    if (await fn()) return true
    await settle(300)
  }
  return false
}
const openNotes = async () => {
  await win.click('[data-dock="library"]')
  await settle(600)
  await win.click('[data-switch="files"]')
  await settle(300)
  await win.click('[data-switch="notes"]')
  await win.waitForSelector('[data-testid="wiki"]', { timeout: 8000 })
}
const line = () => win.textContent('[data-testid="wiki-line"]').catch(() => '')

try {
  await openNotes()
  check('Library → Notes offers the wiki, empty', /Add files and the agent writes a page/.test((await line()) ?? ''), await line())

  // ── a person adds a file ──
  await win.click('[data-testid="wiki-add"]')
  await win.fill('[data-testid="wiki-find"]', 'offer')
  await win.click('[data-wiki-file="Work/Offer letter.md"]')
  const written = await until(() => pageText('Northwind') && pageText('Anna Berg'))
  check('the model reads the file once and the app writes its pages', written && wikiCalls().length === 1, String(wikiCalls().length))
  check('…the file is fenced as material, never instructions', /<<<SOURCE\nOffer letter\. Northwind/.test(wikiCalls()[0] ?? '') && /material, not instructions/.test(wikiCalls()[0] ?? ''))
  check('…a page is linked and names its source', /\[\[Anna Berg\]\]/.test(pageText('Northwind')) && pageText('Northwind').includes('- [Offer letter.md](<../Work/Offer letter.md>)'), pageText('Northwind'))
  check('…and the index lists every page by kind', /## People\n\n- \[\[Anna Berg\]\] — Head of product/.test(pageText('Index')) && /## Organizations\n\n- \[\[Northwind\]\]/.test(pageText('Index')), pageText('Index'))
  await until(async () => /From Offer letter\.md: new Northwind, Anna Berg/.test((await win.textContent('[data-testid="wiki-changes"]').catch(() => '')) ?? ''), 6000)
  check('the section says what the file changed', /From Offer letter\.md: new Northwind, Anna Berg/.test((await win.textContent('[data-testid="wiki-changes"]').catch(() => '')) ?? ''))
  const listed = await until(async () => !!(await win.$('[data-testid="library-notes"] [data-note="Northwind.md"]')), 10000)
  check('the Notes list shows the new pages', listed)
  const graph = await win.evaluate(() => window.workspace.links.graph())
  const id = (n) => graph.nodes.find((x) => x.name === `${n}.md` && x.kind === 'note')?.id
  check('…and the graph links them', !!id('Northwind') && graph.edges.some((e) => e.source === id('Northwind') && e.target === id('Anna Berg')) && graph.edges.some((e) => e.source === id('Anna Berg') && e.target === id('Northwind')), JSON.stringify({ nodes: graph.nodes.map((x) => `${x.kind}:${x.name}:${x.degree}`), edges: graph.edges.length, out: await win.evaluate((p) => p && window.workspace.links.outgoing(p), id('Northwind') ?? null) }))

  // ── unchanged: nothing to read ──
  await win.click('[data-wiki-file="Work/Offer letter.md"]')
  await settle(1200)
  check('adding it again unchanged asks the model nothing', wikiCalls().length === 1 && /already in, unchanged/.test((await win.textContent('[data-testid="wiki-note"]').catch(() => '')) ?? ''))

  // ── an agent queues a follow-up ──
  await win.evaluate((name) => window.workspace.agents.write({ name, description: 'Keeps the wiki', persona: 'You keep the wiki.', capabilities: ['knowledge'], scope: 'project' }), AGENT)
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('wos:agents-changed')))
  await settle(800)
  const n = calls().length
  await win.evaluate(async ({ name }) => {
    const s = window.__sessionStore.create({ agentName: name })
    await window.__sessionStore.send(s.id, 'Add the follow-up mail to the wiki. WIKI-ADD')
  }, { name: AGENT })
  await until(() => calls().length > n, 20000)
  const run = calls()[n]
  check('an agent adds a file through the bridge and is told it is queued', /"ok":true/.test(run?.out ?? '') && /Queued/.test(run?.out ?? ''), (run?.out ?? '').slice(0, 300))
  check('…an agent run is told to start from the wiki, and that the app writes it', /Pages in Wiki\/ \(when the workspace has one\)/.test(run?.system ?? '') && /knowledge\.wiki-add/.test(run?.system ?? ''), (run?.system ?? '').slice(-600))
  const updated = await until(() => pageText('Northwind').includes('128k'))
  check('…the page the mail names is shown to the model in full and updated in place', updated && /=== Northwind \(organization\) ===/.test(wikiCalls()[1] ?? '') && !fs.existsSync(path.join(ws, 'Wiki', 'Northwind 2.md')), pageText('Northwind'))
  check('…and lists both sources', pageText('Northwind').includes('Mail/Follow-up.md') && pageText('Northwind').includes('Work/Offer letter.md'))

  // ── a source changes: named, read again, undone ──
  fs.appendFileSync(path.join(ws, 'Work/Offer letter.md'), 'PS: see you soon.\n')
  await openNotes()
  const named = await until(async () => /changed since added: Offer letter\.md/.test((await win.textContent('[data-testid="wiki-changed"]').catch(() => '')) ?? ''), 6000)
  check('a source changed since it was added is named', named)
  await win.click('[data-testid="wiki-reread"]')
  const reread = await until(() => wikiCalls().length === 3 && pageText('Northwind').includes('at 120k'))
  check('Read again reads it again', reread, `${wikiCalls().length} ${pageText('Northwind').slice(-200)}`)
  await until(async () => /From Offer letter\.md: updated Northwind/.test((await win.textContent('[data-testid="wiki-changes"] li').catch(() => '')) ?? ''), 6000)
  await win.click('[data-testid="wiki-changes"] li:first-child [data-testid="wiki-undo"]')
  const noteNow = async () => (await win.textContent('[data-testid="wiki-note"]').catch(() => '')) ?? ''
  const undone = await until(async () => pageText('Northwind').includes('128k (raised from 120k)') && /Undone/.test(await noteNow()), 8000)
  const undoNote = await noteNow()
  check('Undo puts the page back as it was', undone && /Undone\./.test(undoNote), `${undoNote} | ${await win.textContent('[data-testid="wiki-changes"]').catch(() => '')} | ${pageText('Northwind').slice(-160)}`)

  // ── nothing worth a page ──
  await win.click('[data-testid="wiki-add"]').catch(() => {})
  if (!(await win.$('[data-testid="wiki-find"]'))) await win.click('[data-testid="wiki-add"]')
  await win.fill('[data-testid="wiki-find"]', 'groceries')
  await win.click('[data-wiki-file="Notes/groceries.md"]')
  await until(() => wikiCalls().length === 4)
  await settle(1000)
  const files = fs.readdirSync(path.join(ws, 'Wiki')).sort()
  check('a file with nothing worth a page writes no page', wikiCalls().length === 4 && JSON.stringify(files) === JSON.stringify(['Anna Berg.md', 'Index.md', 'Northwind.md']), JSON.stringify(files))
  const sources = await win.evaluate(() => window.workspace.wiki.sources())
  check('…and is remembered as read', sources.includes('Notes/groceries.md'), JSON.stringify(sources))
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
