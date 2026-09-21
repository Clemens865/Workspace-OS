/**
 * Interactive e2e test cases for Workspace OS.
 *
 * Each case launches the real Electron app (via Playwright's _electron API)
 * against a throwaway temp workspace seeded with known files, drives the UI,
 * and asserts. Run with:  npm run e2e:cases
 * (requires native modules built for Electron — `npm run rebuild:electron`)
 *
 * The app reads WORKSPACE_TEST_ROOT to open a folder without the native dialog.
 */
import { _electron as electron } from 'playwright'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const MAIN = path.join(root, 'out/main/index.js')

let passed = 0
let failed = 0
const failures = []

function assert(name, cond, detail = '') {
  if (cond) { passed++; console.log(`    ✓ ${name}`) }
  else { failed++; failures.push(name); console.error(`    ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** Creates a temp workspace seeded with the given { name: contents } files. */
function makeWorkspace(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-e2e-'))
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content)
  }
  return dir
}

/** Launches the app against a workspace; returns { app, window }. */
async function launch(workspaceRoot) {
  const app = await electron.launch({
    args: [MAIN],
    cwd: root,
    env: { ...process.env, WORKSPACE_TEST_ROOT: workspaceRoot ?? '' },
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForSelector('#root', { timeout: 10000 })
  return { app, window }
}

async function runCase(title, workspaceFiles, body) {
  console.log(`\n▸ ${title}`)
  const ws = workspaceFiles ? makeWorkspace(workspaceFiles) : null
  let ctx
  try {
    ctx = await launch(ws)
    await body(ctx, ws)
  } catch (err) {
    failed++
    failures.push(title)
    console.error(`    ✗ threw: ${err.message}`)
  } finally {
    await ctx?.app.close().catch(() => {})
    if (ws) fs.rmSync(ws, { recursive: true, force: true })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE 1 — Opening a workspace populates the file tree
// ─────────────────────────────────────────────────────────────────────────────
await runCase(
  'Case 1: workspace files appear in the file tree',
  { 'report.md': '# Quarterly Report\nRevenue grew.', 'notes.txt': 'meeting notes', 'data.csv': 'a,b\n1,2' },
  async ({ window }) => {
    await window.waitForTimeout(500)
    assert('report.md is listed', await window.getByText('report.md').first().isVisible())
    assert('notes.txt is listed', await window.getByText('notes.txt').first().isVisible())
    assert('data.csv is listed', await window.getByText('data.csv').first().isVisible())
    assert(
      'header shows the workspace name, not "No folder"',
      !(await window.getByText('No folder').first().isVisible().catch(() => false))
    )
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// CASE 2 — Clicking a markdown file opens it in a canvas tab
// ─────────────────────────────────────────────────────────────────────────────
await runCase(
  'Case 2: clicking a file opens it as a tab',
  { 'readme.md': '# Hello World\nThis is content.' },
  async ({ window }) => {
    await window.waitForTimeout(500)
    await window.getByText('readme.md').first().click()
    await window.waitForTimeout(1500) // Monaco lazy-loads
    assert(
      'a tab for readme.md is open',
      await window.locator('[role="tab"]').filter({ hasText: 'readme.md' }).first().isVisible().catch(() => false)
    )
    assert(
      'empty-state hint is gone once a file is open',
      !(await window.getByText('Open a file to get started').isVisible().catch(() => false))
    )
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// CASE 3 — Deleting a file moves it to trash and it can be restored
// ─────────────────────────────────────────────────────────────────────────────
await runCase(
  'Case 3: delete → trash → restore round-trips',
  { 'deleteme.txt': 'temporary' },
  async ({ window }, ws) => {
    await window.waitForTimeout(500)
    // Delete via the preload API directly (context menu uses a native confirm()).
    await window.evaluate((p) => window.workspace.fs.delete(p), path.join(ws, 'deleteme.txt'))
    await window.waitForTimeout(300)
    assert('file is gone from disk after delete', !fs.existsSync(path.join(ws, 'deleteme.txt')))

    const trash = await window.evaluate(() => window.workspace.trash.list())
    assert('trash contains the deleted file', trash.length === 1 && trash[0].originalName === 'deleteme.txt')

    await window.evaluate((id) => window.workspace.trash.restore(id), trash[0].id)
    await window.waitForTimeout(300)
    assert('file is restored to disk', fs.existsSync(path.join(ws, 'deleteme.txt')))
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// CASE 4 — Full-text search finds document content via the command bar
// ─────────────────────────────────────────────────────────────────────────────
await runCase(
  'Case 4: ⌘P content search finds a keyword inside a file',
  { 'budget.txt': 'The Q3 marketing allocation is significant.', 'other.txt': 'unrelated' },
  async ({ window }) => {
    // Give the background indexer time to extract + index.
    await window.waitForTimeout(2500)
    const results = await window.evaluate(() => window.workspace.search.query('allocation'))
    assert('search returns a hit for "allocation"', Array.isArray(results) && results.length >= 1)
    assert(
      'the hit is budget.txt',
      results.some((r) => r.name === 'budget.txt')
    )
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// CASE 5 — Agent terminal slash commands work locally
// ─────────────────────────────────────────────────────────────────────────────
await runCase(
  'Case 5: /help lists commands in the agent terminal',
  { 'x.txt': 'x' },
  async ({ window }) => {
    await window.waitForTimeout(500)
    const input = window.getByPlaceholder('Ask the agent, or type / for commands…')
    await input.click()
    await input.fill('/help')
    await input.press('Enter')
    await window.waitForTimeout(400)
    assert('/summarize is listed', await window.getByText('/summarize', { exact: false }).first().isVisible())
    assert('/brief is listed', await window.getByText('/brief', { exact: false }).first().isVisible())

    // /clear empties the scrollback.
    await input.fill('/clear')
    await input.press('Enter')
    await window.waitForTimeout(300)
    assert(
      'scrollback cleared after /clear',
      !(await window.getByText('/summarize', { exact: false }).first().isVisible().catch(() => false))
    )
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// CASE 6 — Overwriting a file snapshots the prior version to trash
// ─────────────────────────────────────────────────────────────────────────────
await runCase(
  'Case 6: overwrite snapshots the previous version to trash',
  { 'doc.txt': 'version one' },
  async ({ window }, ws) => {
    await window.waitForTimeout(500)
    await window.evaluate((p) => window.workspace.fs.writeFile(p, 'version two'), path.join(ws, 'doc.txt'))
    await window.waitForTimeout(300)

    assert('file now holds the new content', fs.readFileSync(path.join(ws, 'doc.txt'), 'utf-8') === 'version two')

    const trash = await window.evaluate(() => window.workspace.trash.list())
    const snapshot = trash.find((e) => e.originalName === 'doc.txt' && e.op === 'overwrite')
    assert('an overwrite snapshot exists in trash', !!snapshot)
    if (snapshot) {
      const recovered = fs.readFileSync(snapshot.storedPath, 'utf-8')
      assert('the snapshot preserves the original content', recovered === 'version one')
    }
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// CASE 7 — Internal store (.workspace-os) is hidden from the file tree
// ─────────────────────────────────────────────────────────────────────────────
await runCase(
  'Case 7: .workspace-os is not shown in the file tree',
  { 'visible.txt': 'hi' },
  async ({ window }, ws) => {
    // Force creation of the internal store via a delete (moves to .workspace-os/trash).
    await window.evaluate((p) => window.workspace.fs.delete(p), path.join(ws, 'visible.txt'))
    await window.waitForTimeout(400)
    assert('the .workspace-os store exists on disk', fs.existsSync(path.join(ws, '.workspace-os')))
    assert(
      '.workspace-os is hidden from the tree',
      !(await window.getByText('.workspace-os').first().isVisible().catch(() => false))
    )
  }
)

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`)
console.log(`E2E CASES: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log(`Failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('ALL E2E CASES PASS')
process.exit(0)
