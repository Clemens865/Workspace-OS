// Isolated live proof: own app profile/workspace; never kills an existing Workspace app.
// Run after npm run rebuild:electron && npm run build; restore with npm run rebuild:node.
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-parallel-e2e-'))
const workspace = path.join(temp, 'workspace'), profile = path.join(temp, 'profile')
fs.mkdirSync(workspace); fs.mkdirSync(profile)
const existingPython = path.join(os.homedir(), 'Library/Application Support/workspace-os/pyenv')
if (fs.existsSync(existingPython)) fs.symlinkSync(existingPython, path.join(profile, 'pyenv'))
const env = { ...process.env, WORKSPACE_TEST_ROOT: workspace, WOS_ACTION_DIR: path.join(root, 'resources/wos-action'), WOS_DOCGEN_DIR: path.join(root, 'resources/office-docgen'), WOS_MCP_TOKEN_DIR: path.join(root, 'resources/wos-mcp-token') }
let app, win
let checks = 0
async function launch() {
  app = await electron.launch({ args: [path.join(root, 'out/main/index.js'), `--user-data-dir=${profile}`], cwd: root, env })
  win = await app.firstWindow(); await win.waitForSelector('#root')
  win.on('console', (m) => { if (m.text().startsWith('[proof]')) console.log(m.text()) })
  await win.waitForFunction(() => !!window.workspace?.agent)
  await win.keyboard.press('Enter')
}
function ok(value, label) { assert.ok(value, label); checks++; console.log(`PASS ${label}`) }
async function run(model, prompt, conversation, mode = 'safe') {
  return win.evaluate(async ({ model, prompt, conversation, mode }) => {
    const id = crypto.randomUUID()
    let text = '', meta = null
    const off = window.workspace.agent.onOutput((r, t) => { if (r === id) text += t })
    const offQ = window.workspace.codex.onQuestion((q) => {
      if (q.runId !== id || q.resolved) return
      console.log('[proof] request ' + q.method)
      if (q.method === 'item/commandExecution/requestApproval') {
        const command = q.params.command ?? ''
        const expected = command.includes('wos-action') && (command.includes('document.generate') || command.includes('document.data'))
        void window.workspace.codex.respond(id, q.requestId, { allow: expected })
      } else void window.workspace.codex.respond(id, q.requestId, { allow: false })
    })
    const offM = window.workspace.agent.onRunMeta((r, m) => { if (r === id) meta = m })
    let offD
    const done = new Promise((resolve) => { offD = window.workspace.agent.onDone((r, code) => { if (r === id) resolve(code) }) })
    let timer
    try {
      await window.workspace.agent.run(id, prompt, [], null, mode, null, conversation, model)
      const code = await Promise.race([done, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Run timed out: ' + text.slice(-1000))), 120000) })])
      return { code, text, meta }
    } finally { clearTimeout(timer); off(); offM(); offQ(); offD?.(); await window.workspace.agent.cancel(id) }
  }, { model, prompt, conversation, mode })
}
try {
  await launch()
  const catalog = await win.evaluate(() => window.workspace.agent.listModels())
  ok(catalog.status.available && catalog.codex.length > 1, 'live catalog and account available')
  const [claude, codex] = await Promise.all([run('haiku', 'Reply with exactly CLAUDE_PARALLEL_OK.'), run('codex:', 'Reply with exactly CODEX_PARALLEL_OK. Do not use tools.')])
  ok(claude.code === 0 && claude.text.includes('CLAUDE_PARALLEL_OK'), 'Claude runs alongside Codex')
  ok(codex.code === 0 && codex.text.includes('CODEX_PARALLEL_OK') && codex.meta?.inputTokens > 0 && codex.meta?.costKnown === false, 'Codex answer and honest token usage')
  const conversation = `proof-conversation-${Date.now()}`
  const first = await run('codex:', 'Remember codeword WOS_OTTER_83 in this conversation only. Reply OK. Do not use tools.', conversation)
  ok(first.code === 0, 'Codex conversation starts')
  await app.close(); app = null
  const claudeMarker = path.join(temp, 'claude-was-started')
  const unavailableClaude = path.join(temp, 'claude-unavailable')
  fs.writeFileSync(unavailableClaude, '#!/bin/sh\ntouch "' + claudeMarker + '"\nexit 127\n', { mode: 0o700 })
  env.CLAUDE_BIN = unavailableClaude
  await launch()
  const resumed = await run('codex:', 'What was the codeword? Reply only the codeword.', conversation)
  ok(resumed.code === 0 && resumed.text.includes('WOS_OTTER_83'), 'Codex resumes after a full app restart')
  const doc = await run('codex:', 'Create a new Markdown file named Codex-Safe-Proof.md containing exactly # Safe bridge proof using the workspace_action tool with actionId document.generate. Do not use a direct shell write. Report its returned path.')
  ok(doc.code === 0 && fs.readFileSync(path.join(workspace, 'Codex-Safe-Proof.md'), 'utf8').includes('# Safe bridge proof'), 'Safe-mode document generation reaches grant-checked bridge')
  const sheet = await run('codex:', 'Use the workspace_action tool with actionId document.generate to create Codex-Safe-Sheet.xlsx with a sheet named Budget and rows [["Item","Amount"],["Example",100]]. Pass the spec inline to that tool. Report its returned path.')
  ok(sheet.code === 0 && fs.readFileSync(path.join(workspace, 'Codex-Safe-Sheet.xlsx')).subarray(0, 2).toString() === 'PK', 'Safe-mode office generation creates a real XLSX')
  await win.evaluate(async () => {
    await window.workspace.agent.setDefaultModel('codex:')
    const key = 'workspace-os:settings'
    const saved = JSON.parse(localStorage.getItem(key) || '{}')
    localStorage.setItem(key, JSON.stringify({ ...saved, agentModel: 'codex:' }))
  })
  const foundry = await win.evaluate(() => window.workspace.agents.build('A document specialist who produces a short Markdown report from user-supplied notes.'))
  ok(foundry.ok && foundry.spec?.name && !fs.existsSync(claudeMarker), 'Foundry works with Claude unavailable and never falls back to it')
  const pty = await win.evaluate(async () => {
    const result = await window.workspace.agentPty.spawn('proof-native-codex', { model: 'codex:', mode: 'safe' })
    await window.workspace.agentPty.kill('proof-native-codex')
    return result
  })
  ok(pty.provider === 'codex' && pty.pid > 0 && !fs.existsSync(claudeMarker), 'native Codex PTY respects its own provider selection')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('codex:question', { runId: 'proof-question', requestId: 'proof-1', method: 'item/tool/requestUserInput', params: { questions: [{ id: 'format', question: 'Which report format would you like?', options: [{ label: 'Markdown', description: 'A short text report' }, { label: 'Spreadsheet', description: 'A table of results' }] }] } }))
  await win.getByRole('dialog', { name: 'Codex request' }).waitFor()
  console.log('[proof] dialog: ' + await win.getByRole('dialog', { name: 'Codex request' }).innerText())
  await win.screenshot({ path: path.join(temp, 'codex-question-before.png') })
  await win.getByRole('button', { name: 'Markdown', exact: true }).click()
  await win.screenshot({ path: path.join(temp, 'codex-question.png') })
  ok(await win.getByRole('button', { name: 'Send answer', exact: true }).isEnabled(), 'structured Codex question displays selectable answers')
  await win.getByRole('button', { name: 'Send answer', exact: true }).click()
  await win.screenshot({ path: path.join(temp, 'workspace.png') })
  console.log(`Codex parallel: ${checks} passed. Evidence: ${temp}`)
} finally { await app?.close().catch(() => {}) }
