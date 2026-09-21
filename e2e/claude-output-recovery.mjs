// Real case UI → preload → agent IPC → launchRun → child stream → case UI.
// Only the Claude executable is replaced. No provider requests or real case edits.
import { _electron as electron } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-claude-recovery-'))
const workspace = path.join(dir, 'workspace')
for (const name of ['workspace', 'profile', 'temp']) await fs.mkdir(path.join(dir, name))
const callsFile = path.join(dir, 'calls.json')
const fake = path.join(dir, 'claude.cjs')
const sessionId = '12345678-1234-4321-9876-123456789012'
await fs.writeFile(fake, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (!args.includes('-p')) { process.stdout.write('2.1.266 (Claude Code)\\n'); process.exit(0); }
if (fs.realpathSync(process.cwd()) !== fs.realpathSync(${JSON.stringify(workspace)})) throw new Error('Unexpected test workspace');
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { prompt += chunk; });
process.stdin.on('end', () => {
  const callsFile = ${JSON.stringify(callsFile)};
  const calls = fs.existsSync(callsFile) ? JSON.parse(fs.readFileSync(callsFile, 'utf8')) : [];
  calls.push({ args, prompt, cwd: process.cwd() });
  fs.writeFileSync(callsFile, JSON.stringify(calls));
  const resumed = args.includes('--resume');
  fs.writeFileSync('draft.md', resumed ? '# First section\\nSaved before the limit.\\n\\n# Second section\\nFinished.' : '# First section\\nSaved before the limit.');
  const event = { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: resumed ? '\\nFinished the remaining section.' : 'First section saved — résumé ready.' } } };
  const bytes = Buffer.from(JSON.stringify(event) + '\\n');
  // Split a UTF-8 character between chunks as a real pipe can do.
  const split = bytes.indexOf(Buffer.from('é')) + 1;
  process.stdout.write(bytes.subarray(0, split));
  setTimeout(() => {
    process.stdout.write(bytes.subarray(split));
    // Deliberately no final newline, no init event, and exit 0 even on failure.
    process.stdout.write(JSON.stringify({ type: 'result', session_id: ${JSON.stringify(sessionId)}, is_error: !resumed,
      ...(resumed ? { result: 'Done' } : { errors: ["API Error: Claude's response exceeded the 8192 output token maximum. To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable."] }) }));
  }, 120);
});
`)
await fs.chmod(fake, 0o755)
const bootstrap = path.join(dir, 'boot.cjs')
await fs.writeFile(bootstrap, `const { app } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(dir, 'profile'))});
app.setPath('temp', ${JSON.stringify(path.join(dir, 'temp'))});
import(${JSON.stringify(pathToFileURL(path.join(root, 'out/main/index.js')).href)});
`)
const calls = async () => JSON.parse(await fs.readFile(callsFile, 'utf8'))
let app
let win
let diagnostics = ''
try {
  app = await electron.launch({ args: [bootstrap], cwd: root, env: { ...process.env, WORKSPACE_TEST_ROOT: workspace, CLAUDE_BIN: fake, CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8192' } })
  app.process().stderr.on('data', (chunk) => { diagnostics = (diagnostics + chunk).slice(-12000) })
  win = await app.firstWindow({ timeout: 30000 })
  await win.getByRole('button', { name: 'Enter', exact: true }).click()
  await win.evaluate(() => window.workspace.agent.onDone((id) => { window.__lastRecoveryRun = id }))
  await win.evaluate(() => window.workspace.agent.setDefaultModel('claude:sonnet'))
  const c = await win.evaluate(() => window.workspace.cases.create({ title: 'Response limit recovery', description: 'Create a document in sections.' }))
  await win.getByRole('button', { name: 'Cockpit', exact: true }).click()
  const row = win.locator('[class*="headWrap"]').filter({ hasText: c.title }).locator('..')
  await row.getByRole('button', { name: 'Open full screen' }).click()
  const full = win.locator('[class*="win"]').filter({ has: win.locator('[class*="tbTitle"]', { hasText: c.title }) })
  const activity = full.getByTestId('case-agent-activity')
  const input = full.getByPlaceholder('Hand to an agent — @ file · # case')
  await input.fill('Write the preparation document')
  await input.press('Enter')
  await activity.getByText('Claude · Response limit reached', { exact: true }).waitFor()
  await activity.getByRole('button', { name: 'Continue unfinished work' }).waitFor()
  assert.match(await activity.innerText(), /First section saved — résumé ready/)
  assert.match(await activity.innerText(), /draft.md/)
  const first = (await calls())[0]
  const settings = JSON.parse(first.args[first.args.indexOf('--settings') + 1])
  assert.equal(settings.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, '32000')
  assert.equal(settings.disableAllHooks, true)
  assert.equal(first.args.includes('--resume'), false)
  assert.match(first.prompt, /save each section/)
  assert.equal((await calls()).length, 1, 'Never automatically retries the task')
  await win.screenshot({ path: path.join(dir, 'response-limit.png') })

  // A changed app default must not switch the continuation to another provider.
  await win.evaluate(() => window.workspace.agent.setDefaultModel('codex:gpt-5-codex'))
  const wrongProvider = await win.evaluate(async () => {
    try {
      await window.workspace.agent.run('provider-mismatch-test', 'Continue', [], null, 'full', null, window.__lastRecoveryRun, 'codex:gpt-5-codex', true)
      return ''
    } catch (error) { return String(error) }
  })
  assert.match(wrongProvider, /original conversation is no longer available/)
  await full.getByRole('button', { name: 'Close', exact: true }).click()
  await row.getByRole('button', { name: new RegExp(c.title) }).click()
  await row.getByTestId('case-agent-activity').getByRole('button', { name: 'Continue unfinished work' }).click()
  await row.getByTestId('case-agent-activity').getByText('Claude · Completed', { exact: true }).waitFor()
  await row.getByRole('button', { name: 'Open full screen' }).click()
  await activity.getByText('Claude · Completed', { exact: true }).waitFor()
  assert.match(await activity.innerText(), /First section saved — résumé ready/)
  assert.match(await activity.innerText(), /Finished the remaining section/)
  assert.equal(await activity.getByRole('button', { name: 'draft.md', exact: true }).count(), 1)
  const second = (await calls())[1]
  assert.equal(second.args[second.args.indexOf('--resume') + 1], sessionId)
  assert.equal(second.args[second.args.indexOf('--model') + 1], 'sonnet')
  assert.equal(second.args.includes('--append-system-prompt'), false)
  assert.match(second.prompt, /First inspect the existing files/)
  assert.equal(second.cwd, first.cwd)
  assert.match(await fs.readFile(path.join(workspace, 'draft.md'), 'utf8'), /First section[\s\S]*Second section/)
  await win.screenshot({ path: path.join(dir, 'continued.png') })

  // A missing session must fail before any new process starts.
  const rejection = await win.evaluate(async () => {
    try {
      await window.workspace.agent.run('missing-session-test', 'Continue', [], null, 'full', null, 'missing-conversation', 'claude:sonnet', true)
      return ''
    } catch (error) { return String(error) }
  })
  assert.match(rejection, /original conversation is no longer available/)
  assert.equal((await calls()).length, 2)
  console.log(`PASS: real IPC recovery, app limit override, failed exit-0 result, final-line session capture, UTF-8 streaming, explicit same-session/model continuation, preserved output/files, and missing-session guard. Screenshots: ${dir}`)
} catch (error) {
  console.error(await win?.getByTestId('case-agent-activity').allTextContents())
  await win?.screenshot({ path: path.join(dir, 'failure.png') })
  await fs.writeFile(path.join(dir, 'stderr.log'), diagnostics)
  console.error(`Diagnostics: ${dir}`)
  throw error
} finally { await app?.close() }
