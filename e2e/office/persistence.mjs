// Sprint 3 smoke — persistence & trust:
//   1. open 2 docs on the stage → relaunch → tabs restored (stageSession.ts)
//   2. save snapshot → close tabs → restore snapshot → tabs back (PRD MVP #10)
//   3. DiffSheet renders a checkpoint diff (checkpoint made via the shadow repo)
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { launch, killAll, poll, shot, makeReporter } from './_harness.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const TESTROOT = '/tmp/wos-test'
const ALPHA = path.join(TESTROOT, 'alpha-note.md')
const BETA = path.join(TESTROOT, 'beta-note.md')
const SESSION_PREFIX = 'workspace-os:stage-session:v1'

const r = makeReporter('persistence')

/** The stage's document tabs as [{ path, active }], in tab order. */
const readTabs = (win) =>
  win.evaluate(() =>
    [...document.querySelectorAll('[data-stage-tab]')].map((t) => ({
      path: t.getAttribute('data-stage-tab'),
      active: t.getAttribute('aria-selected') === 'true',
    }))
  )

/** Opens a file on the stage through quick-open (⌘P). */
async function openOnStage(win, fileName) {
  await win.keyboard.press('Meta+p')
  const input = win.getByTestId('quick-open-input')
  await input.fill(fileName.replace(/\.md$/, ''))
  await poll(async () => (await win.locator('[class*="_resultName_"]').first().textContent().catch(() => null)) === fileName)
  await win.keyboard.press('Enter')
  await poll(async () => (await readTabs(win)).some((t) => t.path?.endsWith(fileName) && t.active))
}

const sendMenuAction = (app, id) =>
  app.evaluate(({ BrowserWindow }, actionId) => {
    BrowserWindow.getAllWindows()[0].webContents.send('menu:run-action', actionId)
  }, id)

/** Mirrors CheckpointStore's shadow-git setup to create a checkpoint without an agent run. */
function createCheckpointViaShadowRepo(label) {
  const gitDir = path.join(TESTROOT, '.workspace-os', 'checkpoints', 'git')
  fs.mkdirSync(gitDir, { recursive: true })
  const git = (args) =>
    execSync(
      `git --git-dir="${gitDir}" --work-tree="${TESTROOT}" -c user.email=agent@workspace-os.local -c user.name="Workspace OS" -c commit.gpgsign=false ${args}`,
      { stdio: 'pipe' }
    )
  if (!fs.existsSync(path.join(gitDir, 'HEAD'))) git('init -q')
  fs.mkdirSync(path.join(gitDir, 'info'), { recursive: true })
  fs.writeFileSync(path.join(gitDir, 'info', 'exclude'), '/.workspace-os/\n')
  git('add -A')
  git(`commit --allow-empty -q -m "${label}"`)
}

async function main() {
  fs.mkdirSync(TESTROOT, { recursive: true })
  fs.writeFileSync(ALPHA, '# Alpha\n\nfirst note\n')
  fs.writeFileSync(BETA, '# Beta\n\nsecond note\n')

  // ── Part 1: open 2 docs, relaunch, tabs restored ─────────────────────────
  let { app, win } = await launch()
  // Clean slate: drop any stage session a previous run persisted, then reload so
  // the restore-on-mount pass runs against the empty record.
  await win.evaluate((pre) => { for (const k of Object.keys(localStorage)) if (k.startsWith(pre)) localStorage.removeItem(k) }, SESSION_PREFIX)
  await win.reload()
  await win.waitForSelector('#root', { timeout: 20000 })
  await win.waitForTimeout(600)

  await openOnStage(win, 'alpha-note.md')
  await openOnStage(win, 'beta-note.md')
  let tabs = await readTabs(win)
  r.ok(tabs.length === 2, `two tabs open before relaunch (got ${tabs.length})`)
  r.ok(tabs.find((t) => t.active)?.path === BETA, 'beta is the active tab before relaunch')

  // The layout persists on every tab change; wait until the record has both.
  r.ok(
    await poll(async () => {
      const raw = await win.evaluate((pre) => Object.entries(localStorage).find(([k]) => k.startsWith(pre))?.[1] ?? null, SESSION_PREFIX)
      const s = raw ? JSON.parse(raw) : null
      return s?.files?.length === 2 && s.activeFile === BETA
    }),
    'stage session persisted to localStorage'
  )
  await app.close()

  ;({ app, win } = await launch({ keepSession: true }))
  r.ok(
    await poll(async () => (await readTabs(win)).length === 2),
    'both tabs restored after relaunch'
  )
  tabs = await readTabs(win)
  r.ok(tabs.map((t) => t.path).join() === [ALPHA, BETA].join(), 'restored tab order matches')
  r.ok(tabs.find((t) => t.active)?.path === BETA, 'active tab restored (beta)')
  await shot(win, 'persistence-1-tabs-restored')

  // ── Part 2: save snapshot → close tabs → restore snapshot ────────────────
  await sendMenuAction(app, 'snapshot.save')
  await win.waitForSelector('[data-testid="save-snapshot"]', { timeout: 5000 })
  await win.locator('[data-testid="save-snapshot"] input').fill('e2e-desk')
  await win.getByRole('button', { name: 'Save', exact: true }).click()
  const snap = await poll(async () => {
    const list = await win.evaluate(() => window.workspace.snapshots.list())
    return list.find((s) => s.name === 'e2e-desk')
  })
  r.ok(!!snap, 'snapshot saved and listed')
  r.ok(snap && snap.state.files.length === 2, 'snapshot captured both open tabs')

  // Close every stage document tab (the × inside each tab).
  for (let i = 0; i < 2; i++) {
    await win.locator('[data-stage-tab] [class*="_tabClose_"]').first().click()
    await win.waitForTimeout(200)
  }
  r.ok((await readTabs(win)).length === 0, 'all tabs closed')

  await sendMenuAction(app, `snapshot.restore:${snap.id}`)
  r.ok(
    await poll(async () => (await readTabs(win)).length === 2),
    'snapshot restore brought both tabs back'
  )
  tabs = await readTabs(win)
  r.ok(tabs.find((t) => t.active)?.path === BETA, 'snapshot restore reactivated beta')
  await shot(win, 'persistence-2-snapshot-restored')

  // ── Part 3: DiffSheet renders a checkpoint diff ──────────────────────────
  createCheckpointViaShadowRepo('e2e checkpoint')
  fs.appendFileSync(ALPHA, 'appended-by-e2e\n')

  await sendMenuAction(app, 'agent.checkpoints')
  await win.waitForSelector('[data-testid="checkpoints-view"]', { timeout: 5000 })
  // isVisible() doesn't auto-wait; the list loads async — poll it.
  r.ok(
    await poll(() => win.getByText('e2e checkpoint').first().isVisible().catch(() => false)),
    'checkpoint listed in Checkpoints view'
  )

  await win.getByRole('button', { name: 'Changes', exact: true }).first().click()
  await win.waitForSelector('[data-testid="diff-sheet"]', { timeout: 8000 })
  const sheet = win.locator('[data-testid="diff-sheet"]')
  r.ok(
    await poll(() => sheet.getByText('alpha-note.md').first().isVisible().catch(() => false)),
    'diff sheet shows the changed file'
  )
  r.ok(
    await sheet.getByText('appended-by-e2e').first().isVisible().catch(() => false),
    'diff sheet shows the added line'
  )
  await shot(win, 'persistence-3-diff-sheet')

  // Cleanup: don't leave the e2e snapshot in the user's File ▸ Snapshots menu.
  await win.evaluate((id) => window.workspace.snapshots.delete(id), snap.id)
  await app.close()
  await killAll()
}

main()
  .then(() => process.exit(r.done() ? 0 : 1))
  .catch(async (e) => {
    console.error('persistence e2e crashed:', e)
    await killAll()
    r.done()
    process.exit(1)
  })
