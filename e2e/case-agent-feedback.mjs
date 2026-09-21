// Exercises the real case composer, preload and IPC event path. The provider
// launch alone is replaced, so this never starts a paid agent or edits a real case.
import { _electron as electron } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-case-feedback-'))
const workspace = path.join(dir, 'workspace')
await fs.mkdir(workspace)
await fs.mkdir(path.join(dir, 'profile'))
await fs.mkdir(path.join(dir, 'temp'))
const bootstrap = path.join(dir, 'boot.cjs')
await fs.writeFile(bootstrap, `const { app } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(dir, 'profile'))});
app.setPath('temp', ${JSON.stringify(path.join(dir, 'temp'))});
import(${JSON.stringify(pathToFileURL(path.join(root, 'out/main/index.js')).href)});
`)

let app
try {
  app = await electron.launch({ args: [bootstrap], cwd: root, env: { ...process.env, WORKSPACE_TEST_ROOT: workspace } })
  const win = await app.firstWindow({ timeout: 30000 })
  await win.waitForSelector('#root', { timeout: 30000 })
  await win.getByRole('button', { name: 'Enter', exact: true }).click()
  await app.evaluate(({ ipcMain }) => {
    globalThis.caseTest = { calls: [], provider: 'claude', reject: false }
    ipcMain.removeHandler('agent:run')
    ipcMain.handle('agent:run', (_event, payload) => {
      globalThis.caseTest.calls.push(payload)
      if (globalThis.caseTest.reject) throw new Error('Test provider could not start')
      return new Promise((resolve) => { globalThis.caseTest.launch = () => resolve({ pid: 123, checkpointId: null, provider: globalThis.caseTest.provider }) })
    })
  })
  const c = await win.evaluate(() => window.workspace.cases.create({ title: 'Case agent feedback test', description: 'Check live progress in a case.' }))
  await win.getByRole('button', { name: 'Cockpit', exact: true }).click()
  const row = win.locator('[class*="headWrap"]').filter({ hasText: c.title }).locator('..')
  await row.getByRole('button', { name: 'Open full screen' }).click()
  const full = win.locator('[class*="win"]').filter({ has: win.locator('[class*="tbTitle"]', { hasText: c.title }) })
  const activity = full.getByTestId('case-agent-activity')
  const input = full.getByPlaceholder('Hand to an agent — @ file · # case')

  async function waitForText(locator, text) {
    await locator.getByText(text, { exact: false }).first().waitFor()
  }
  async function emit(channel, ...args) {
    await app.evaluate(({ BrowserWindow }, { channel, args }) => {
      const id = globalThis.caseTest.calls.at(-1).runId
      BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:')).webContents.send(channel, id, ...args)
    }, { channel, args })
  }
  async function launch() { await app.evaluate(() => globalThis.caseTest.launch()) }

  await input.fill('Prepare me for the interview')
  await full.getByRole('button', { name: 'Send', exact: true }).click()
  await waitForText(activity, 'Starting')
  assert.equal(await input.isDisabled(), true)
  await emit('agent:activity', { tool: 'Read', label: 'Reading a file', kind: 'read', chip: 'cv.md' })
  await emit('agent:output', 'I am reviewing your experience before drafting the preparation notes.')
  await launch()
  await waitForText(activity, 'Claude · Running')
  await waitForText(activity, 'Reading a file')
  await waitForText(activity, 'reviewing your experience')
  await win.screenshot({ path: path.join(dir, 'claude-running.png') })
  await full.getByRole('button', { name: 'Close', exact: true }).click()
  await row.getByRole('button', { name: new RegExp(c.title) }).click()
  await waitForText(row.getByTestId('case-agent-activity'), 'Claude · Running')
  await win.evaluate((id) => window.workspace.cases.addNote(id, 'Prepared three interview talking points.', 'agent'), c.id)
  await emit('agent:done', 0, null)
  await waitForText(row, 'Prepared three interview talking points.')
  await waitForText(row.getByTestId('case-agent-activity'), 'Claude · Completed')

  // Reopening the full-screen view restores the same finished run.
  await row.getByRole('button', { name: 'Open full screen' }).click()
  await waitForText(activity, 'Claude · Completed')
  await app.evaluate(() => { globalThis.caseTest.provider = 'codex' })
  await input.fill('Compare the requirements')
  await input.press('Enter')
  await waitForText(activity, 'Starting')
  await launch()
  await emit('agent:activity', { tool: 'Grep', label: 'Searching the workspace', kind: 'search', chip: 'requirements' })
  await emit('agent:output', 'Comparing the requirements with the case documents.')
  await waitForText(activity, 'Codex · Running')
  await app.evaluate(({ BrowserWindow }) => {
    const runId = globalThis.caseTest.calls.at(-1).runId
    BrowserWindow.getAllWindows()[0].webContents.send('codex:question', { runId, requestId: 'test-question', method: 'item/tool/requestUserInput', params: { questions: [{ id: 'priority', question: 'Which requirement matters most?' }] } })
  })
  await waitForText(activity, 'Codex · Waiting for you')
  await app.evaluate(({ BrowserWindow }) => {
    const runId = globalThis.caseTest.calls.at(-1).runId
    BrowserWindow.getAllWindows()[0].webContents.send('codex:question', { runId, requestId: 'test-question', resolved: true })
  })
  await waitForText(activity, 'Codex · Running')
  await win.screenshot({ path: path.join(dir, 'codex-running.png') })
  await emit('agent:output', '\nThe provider connection was interrupted.')
  await emit('agent:done', 1, null)
  await waitForText(activity, 'Codex · Failed')
  assert.equal(await input.isDisabled(), false)
  await waitForText(activity, 'provider connection was interrupted')

  await app.evaluate(() => { globalThis.caseTest.reject = true })
  await input.fill('Retry the comparison')
  await input.press('Enter')
  await waitForText(activity, 'Test provider could not start')
  assert.equal(await input.isDisabled(), false)
  assert.equal(await app.evaluate(() => globalThis.caseTest.calls.length), 3)
  await win.screenshot({ path: path.join(dir, 'startup-failure.png') })
  console.log(`PASS: Claude and Codex feedback, early events, reopen, case refresh, waiting, failure and retry. Screenshots: ${dir}`)
} finally {
  await app?.close()
}
