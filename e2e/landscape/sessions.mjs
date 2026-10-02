/**
 * Sessions and cases (docs/landscape/SESSIONS.md), in the real app, against a
 * fake Claude (CLAUDE_BIN) that answers, writes a file and reports a session.
 *
 * - The agent card is where you work with the agent: ask, the answer streams
 *   in, the file it made shows.
 * - Suggested (default): after a file, the app offers to keep the session as a
 *   case; keeping writes the ask, the agent's outcome and the file into it.
 * - The next ask resumes the same provider session and is remembered in the
 *   case by the app.
 * - Work stands in front of the team; a work card continues the case.
 * - Always: a new session is a case from its first ask.
 * - Loose sessions are listed (Cases → Sessions) and can be deleted.
 * - Cases and agents can be deleted.
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

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wos-sessions-')))
const ws = path.join(tmp, 'workspace')
fs.mkdirSync(ws)
const callsFile = path.join(tmp, 'calls.json')
const fake = path.join(tmp, 'claude.cjs')
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
  calls.push({ args, prompt, cwd: process.cwd() });
  fs.writeFileSync(file, JSON.stringify(calls));
  const n = calls.length;
  fs.writeFileSync(path.join(process.cwd(), 'answer-' + n + '.md'), '# Answer ' + n + '\\n');
  const say = (t) => process.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } } }) + '\\n');
  say('Looked into it.\\n\\n');
  setTimeout(() => {
    say('Saved the answer to answer-' + n + '.md.');
    process.stdout.write(JSON.stringify({ type: 'result', session_id: '11111111-2222-3333-4444-55555555555' + (n % 10), is_error: false, result: 'ok' }) + '\\n');
  }, 150);
});
`,
)
fs.chmodSync(fake, 0o755)

await killAll()
const app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root, env: { ...process.env, WORKSPACE_TEST_ROOT: ws, CLAUDE_BIN: fake } })
const win = await app.firstWindow({ timeout: 20000 })
win.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`))
await win.waitForSelector('#root', { timeout: 20000 })
const saved = await win.evaluate(() => JSON.stringify({ ...localStorage }))
await win.evaluate(() => {
  const K = 'workspace-os:settings'
  let c = {}
  try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* fresh */ }
  localStorage.setItem(K, JSON.stringify({ ...c, startOn: 'landscape', terminalOpen: false, sessionCases: 'suggest', agentModel: '' }))
})
await win.reload()
await win.waitForSelector('[data-shell="landscape"]', { timeout: 20000 })
for (let i = 0; i < 40 && (await win.$('[class*="_splash_"]')); i++) {
  await win.keyboard.press('Enter').catch(() => {})
  await win.waitForTimeout(400)
}
await win.waitForTimeout(1000)
const settle = (ms = 800) => win.waitForTimeout(ms)
const calls = () => (fs.existsSync(callsFile) ? JSON.parse(fs.readFileSync(callsFile, 'utf8')) : [])
const AGENT = 'Quill E2E — Test Writer'
const idle = () => win.waitForSelector('[data-testid="session-pane"][data-running="false"] [data-role="agent"]', { timeout: 20000 })
const ask = async (text) => {
  const box = win.locator('[data-testid="session-pane"] textarea').first()
  await box.click()
  await box.fill(text)
  await win.keyboard.press('Enter')
  await settle(400)
  await win.waitForSelector('[data-testid="session-pane"][data-running="false"]', { timeout: 20000 })
  await settle(900)
}
const cases = () => win.evaluate(() => window.workspace.cases.list())

try {
  // A throwaway agent in this workspace (project scope), so nothing real is touched.
  await win.evaluate((name) => window.workspace.agents.write({ name, description: 'Writes test answers', persona: 'You write short answers.', scope: 'project' }), AGENT)
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('wos:agents-changed')))
  await settle(1500)
  const face = `[data-agent="${AGENT}"] [data-testid="agent-face"]`
  await win.waitForSelector(face, { timeout: 8000 })
  await win.evaluate((sel) => document.querySelector(sel)?.click(), face)
  await win.waitForSelector('[data-testid="agent-focus"] [data-testid="session-pane"]', { timeout: 8000 })
  check('the agent card opens on a session to work in', true)

  // ── first ask ──
  await ask('Find three grants for the pilot')
  const log = (await win.textContent('[data-testid="session-log"]')) ?? ''
  check('the answer streams into the card', log.includes('Saved the answer to answer-1.md'), log.slice(-120))
  check('the first ask ran as this agent', calls().length === 1 && /Writes test answers|You write short answers/.test(calls()[0].prompt + JSON.stringify(calls()[0].args)), JSON.stringify(calls()[0]?.args ?? []).slice(0, 200))
  await win.waitForSelector('[data-testid="session-files"] [data-file="answer-1.md"]', { timeout: 6000 }).catch(() => {})
  check('the file it made shows on the card', !!(await win.$('[data-testid="session-files"] [data-file="answer-1.md"]')))

  // ── suggested: keep it as a case ──
  check('Suggested: the app offers to keep it as a case', !!(await win.$('[data-testid="session-suggest"]')))
  check('…and has not made one on its own', !(await cases()).some((c) => c.title.startsWith('Find three grants')))
  await win.click('[data-testid="session-suggest-keep"]')
  await settle(1500)
  let kept = (await cases()).find((c) => c.title.startsWith('Find three grants'))
  check('Keep it makes the case', !!kept, (await cases()).map((c) => c.title).join(','))
  check('…with the ask and the agent outcome as notes', !!kept && kept.notes.some((n) => n.author === 'you' && n.text.includes('Find three grants')) && kept.notes.some((n) => n.author === 'agent' && n.text.includes('Saved the answer to answer-1.md')), JSON.stringify(kept?.notes))
  check('…and the file attached', !!kept && kept.artifacts.some((a) => a.endsWith('answer-1.md')), JSON.stringify(kept?.artifacts))

  // ── next ask: resumes, and the app remembers it in the case ──
  await ask('Add their deadlines')
  const c2 = calls()[1]
  check('the next ask resumes the same provider session', !!c2 && c2.args.includes('--resume'), JSON.stringify(c2?.args ?? []).slice(0, 200))
  check('…and is told it is the case', !!c2 && c2.prompt.includes('This conversation is the case'), (c2?.prompt ?? '').slice(0, 160))
  kept = (await cases()).find((c) => c.id === kept.id)
  check('the app writes the turn into the case', kept.notes.some((n) => n.text.includes('Add their deadlines')) && kept.notes.some((n) => n.text.includes('answer-2.md')), JSON.stringify(kept.notes.map((n) => n.text)))

  // ── work in front of the team ──
  await win.keyboard.press('Escape')
  await settle(1200)
  const row = await win.evaluate(() => ({
    work: [...document.querySelectorAll('[data-agent^="case:"], [data-agent^="session:"]')].map((e) => e.getAttribute('data-agent')),
    allWork: !!document.querySelector('[data-testid="all-work"]'),
  }))
  check('the case stands in the work row', row.work.includes(`case:${kept.id}`) && row.allWork, JSON.stringify(row))
  // The card says what the case is: its status (never "Idle"), what happened last, who worked on it.
  const workFace = (await win.textContent(`[data-agent="case:${kept.id}"] [data-testid="work-face"]`).catch(() => '')) ?? ''
  check('the work card says the case, not "Idle"', !!workFace && !/\bIdle\b/.test(workFace) && workFace.includes('answer-2.md'), workFace.slice(0, 200))
  // A case written elsewhere (here: straight through IPC) shows at once, not on the next poll.
  const quick = await win.evaluate(() => window.workspace.cases.create({ title: 'Written elsewhere', type: 'task' }))
  await win.waitForSelector(`[data-agent="case:${quick.id}"]`, { timeout: 4000 }).catch(() => {})
  check('a case written elsewhere appears in the row right away', !!(await win.$(`[data-agent="case:${quick.id}"]`)))
  await win.evaluate((id) => window.workspace.cases.delete(id), quick.id)
  await win.evaluate((id) => document.querySelector(`[data-agent="case:${id}"] [data-testid="agent-face"]`)?.click(), kept.id)
  await win.waitForSelector('[data-testid="work-focus"]', { timeout: 6000 }).catch(() => {})
  const wf = (await win.textContent('[data-testid="work-focus"]').catch(() => '')) ?? ''
  check('a work card shows the case and continues its session', wf.includes('Add their deadlines') && !!(await win.$('[data-testid="work-focus"] [data-testid="session-pane"]')), wf.slice(0, 160))
  await win.keyboard.press('Escape')
  await settle(800)

  // ── always: a case from the first ask ──
  // Through Settings, as a person would (Agents → Keep sessions as cases → Always).
  await win.click('[data-dock="menu"]')
  await settle()
  await win.click('[data-menu="settings"]')
  await win.waitForSelector('[data-testid="session-cases-always"]', { timeout: 6000 })
  await win.click('[data-testid="session-cases-always"]')
  await win.keyboard.press('Escape')
  await settle(400)
  await win.click('[data-testid="stage-landscape"]')
  await settle(1000)
  await win.evaluate((sel) => document.querySelector(sel)?.click(), face)
  await win.waitForSelector('[data-testid="agent-start"]', { timeout: 6000 })
  await win.click('[data-testid="agent-start"]')
  await settle(500)
  await ask('Draft a two line summary')
  check('Always: the first ask is a case right away', (await cases()).some((c) => c.title.startsWith('Draft a two line summary')))
  await win.keyboard.press('Escape')
  await settle(600)

  // ── a loose session, listed and deleted ──
  await win.click('[data-dock="menu"]')
  await settle()
  await win.click('[data-menu="settings"]')
  await win.waitForSelector('[data-testid="session-cases-manual"]', { timeout: 6000 })
  await win.click('[data-testid="session-cases-manual"]')
  await win.keyboard.press('Escape')
  await settle(400)
  await win.click('[data-testid="stage-landscape"]')
  await settle(800)
  await win.evaluate(async () => {
    const s = window.__sessionStore.create({ agentName: null })
    await window.__sessionStore.send(s.id, 'Quick question about tabs')
  })
  await settle(2500)
  await win.click('[data-dock="cases"]')
  await settle()
  await win.click('[data-mode="sessions"]')
  await settle(800)
  const loose = await win.$$eval('[data-session-item]', (els) => els.map((e) => e.textContent))
  check('Cases → Sessions lists the loose session', loose.some((t) => t.includes('Quick question about tabs')), loose.join(' | '))
  await win.click('[data-testid="session-delete"]')
  await win.click('[data-testid="session-delete-confirm"]')
  await settle(800)
  check('…and deletes it', !(await win.evaluate(() => window.__sessionStore.list().some((s) => s.title.startsWith('Quick question')))))

  // ── delete a case ──
  await win.click('[data-mode="shelf"]')
  await settle(600)
  await win.click(`[data-case="${kept.id}"]`)
  await settle(600)
  await win.click('[data-testid="case-delete"]')
  await win.click('[data-testid="case-delete-confirm"]')
  await settle(1200)
  check('Delete removes the case', !(await cases()).some((c) => c.id === kept.id))
  check('…to the trash (its file is gone from Cases/)', !fs.existsSync(path.join(ws, 'Cases', `${kept.id}.md`)))
  check('…and its sessions with it', !(await win.evaluate((id) => window.__sessionStore.list().some((s) => s.caseId === id), kept.id)))

  // ── the agent's settings, on its card ──
  // Something another editor wrote into the file (Claude Code's own fields) must survive a save.
  const agentFile = path.join(ws, '.claude', 'agents', 'quill-e2e-test-writer.md')
  fs.writeFileSync(agentFile, fs.readFileSync(agentFile, 'utf8').replace(/\n---\n/, '\ncolor: green\n---\n'))
  await win.click('[data-dock="overview"]')
  await settle(1000)
  await win.evaluate((sel) => document.querySelector(sel)?.click(), face)
  await win.waitForSelector('[data-testid="agent-tab-settings"]', { timeout: 6000 })
  await win.click('[data-testid="agent-tab-settings"]')
  await win.waitForSelector('[data-testid="agent-set-about"]', { timeout: 6000 })
  check('Settings opens on the card with what the agent says about itself', (await win.inputValue('[data-testid="agent-set-about"]')) === 'Writes test answers')
  await win.selectOption('[data-testid="agent-set-model"]', 'sonnet')
  await win.click('[data-testid="agent-settings"] [data-mode="safe"]')
  await win.fill('[data-testid="agent-set-about"]', 'Writes careful test answers')
  await win.click('[data-testid="agent-set-save"]')
  await settle(1200)
  const md = fs.readFileSync(agentFile, 'utf8')
  check('Save writes model, mode and about to the agent', /wos_model: sonnet/.test(md) && /wos_mode: safe/.test(md) && /description: Writes careful test answers/.test(md), md.slice(0, 300))
  check('…and keeps what another editor put in the file', /color: green/.test(md), md.slice(0, 300))
  check('…and the persona is untouched', md.includes('You write short answers.'))
  await win.click('[data-testid="agent-tab-work"]')
  await settle(600)
  const about = (await win.textContent('[data-testid="agent-focus"]').catch(() => '')) ?? ''
  check('the card shows the new About at once', about.includes('Writes careful test answers'), about.slice(-200))

  // ── delete the agent (in its settings) ──
  await win.click('[data-testid="agent-tab-settings"]')
  await win.waitForSelector('[data-testid="agent-delete"]', { timeout: 6000 })
  await win.click('[data-testid="agent-delete"]')
  await win.click('[data-testid="agent-delete-confirm"]')
  await settle(1500)
  check('Delete removes the agent', !(await win.evaluate((n) => window.workspace.agents.list().then((l) => l.some((a) => a.name === n)), AGENT)))
} catch (e) {
  check('run completed', false, e.message)
} finally {
  await win
    .evaluate(
      async ({ saved, AGENT }) => {
        await window.workspace.agents.delete(AGENT, 'project').catch(() => {})
        localStorage.clear()
        for (const [k, v] of Object.entries(JSON.parse(saved))) localStorage.setItem(k, v)
      },
      { saved, AGENT },
    )
    .catch(() => {})
  await app.close()
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log(`\n${total - fails}/${total} passed`)
process.exit(fails ? 1 : 0)
