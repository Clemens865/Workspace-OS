/**
 * E2E: the in-app bug reporter, driven through the real UI.
 *
 * Asserts the thing that actually matters — that a sentence typed into the app
 * ends up as a real entry in a real file on disk. `ok: true` from the IPC proves
 * nothing; every check here reads the log back.
 *
 * Files into a THROWAWAY repo (/tmp) rather than the project's own docs/BUGS.md,
 * so running the test never pollutes the real bug log. The reporter's stored repo
 * path is saved and restored around the run.
 *
 * STATUS 2026-08-01: this cannot currently run. Playwright's `_electron` launch
 * is broken against Electron 42 (playwright 1.61 predates it) — the window
 * mounts and is then SIGKILLed by the kernel. `e2e/smoke.mjs` and the office
 * harness in `e2e/office/_harness.mjs` fail identically, so the breakage is the
 * harness, not this test. Filed as WOS-002. The checks below are written and
 * ready for whenever the launch path works again.
 *
 * Run with: node e2e/bug-reporter.mjs   (after `npm run build`)
 */
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { killAll } from './office/_harness.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const FAKE_REPO = '/tmp/wos-bugrepo'
const FAKE_LOG = path.join(FAKE_REPO, 'docs', 'BUGS.md')

let failures = 0
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`)
  else {
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
    failures++
  }
}

function makeFakeRepo() {
  fs.rmSync(FAKE_REPO, { recursive: true, force: true })
  fs.mkdirSync(path.join(FAKE_REPO, 'docs'), { recursive: true })
  // The reporter refuses any folder that isn't this project.
  fs.writeFileSync(path.join(FAKE_REPO, 'package.json'), JSON.stringify({ name: 'workspace-os' }))
}

async function main() {
  makeFakeRepo()
  console.log('Launching Electron app…')
  // Same launch discipline as the office harness: a stale process holds the
  // single-instance lock and makes the new instance quit on boot, which surfaces
  // as "target page has been closed". Kill first, and retry once.
  let app, win
  for (let attempt = 1; attempt <= 3; attempt++) {
    await killAll()
    try {
      app = await electron.launch({
        args: [path.join(root, 'out/main/index.js')],
        cwd: root,
        env: { ...process.env, WORKSPACE_TEST_ROOT: '/tmp/wos-test' },
      })
      win = await app.firstWindow({ timeout: 20000 })
      win.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`))
      await win.waitForSelector('#root', { timeout: 20000 })
      break
    } catch (e) {
      console.log(`  [launch] attempt ${attempt} failed (${String(e.message).split('\n')[0]})`)
      try { await app?.close() } catch { /* */ }
      app = undefined
      if (attempt === 3) throw e
    }
  }
  await win.waitForTimeout(600)

  // --- the repo guard -------------------------------------------------------
  const rejected = await win.evaluate(async () =>
    window.workspace.bugs.setRepo('/tmp').then(() => 'accepted').catch((e) => String(e.message || e)),
  )
  check('refuses a folder that is not the Workspace-OS repo', !/accepted/.test(rejected), rejected)

  const set = await win.evaluate(async (dir) => window.workspace.bugs.setRepo(dir), FAKE_REPO)
  check('accepts a valid repo folder', set?.ok === true)

  // --- the shortcut opens the reporter --------------------------------------
  await win.keyboard.press('Meta+Shift+B')
  const dialog = await win.waitForSelector('[role="dialog"][aria-label="Report a bug"]', { timeout: 5000 }).catch(() => null)
  check('⌘⇧B opens the reporter', !!dialog)
  if (!dialog) {
    await app.close()
    return finish()
  }

  // --- context is captured without the user doing anything ------------------
  const ctx = await win.evaluate(async () => window.workspace.bugs.context(null, null))
  check('captures the app version automatically', typeof ctx?.appVersion === 'string' && ctx.appVersion.length > 0)
  check('captures the commit of the running build', typeof ctx?.commit === 'string' && ctx.commit.length >= 7, String(ctx?.commit))
  check('captures the OS', /Darwin|Linux|Windows/i.test(ctx?.os ?? ''))

  // --- type a report and file it as written ---------------------------------
  const REPORT = 'The slide thumbnails stay blank after I switch tabs and come back.'
  await win.fill('[role="dialog"] textarea', REPORT)
  const typed = await win.inputValue('[role="dialog"] textarea')
  check('composer accepts the report text', typed === REPORT)

  // "File as written" — the no-analysis path, which must never lose a report.
  await win.click('button:has-text("File as written")')
  await win.waitForSelector('text=/Filed as WOS-/', { timeout: 15000 }).catch(() => null)

  // --- THE assertion: it is really on disk ----------------------------------
  const exists = fs.existsSync(FAKE_LOG)
  check('the log file was created in the repo', exists)
  const log = exists ? fs.readFileSync(FAKE_LOG, 'utf8') : ''
  check('the entry is numbered WOS-001', log.includes('## WOS-001 · '))
  check('the reporter’s own words are stored verbatim', log.includes(`> ${REPORT}`))
  check('the entry records the build it came from', /- \*\*Build:\*\* \S+/.test(log))
  check('an unanalyzed report is still marked open', log.includes('- **Status:** open'))

  // --- a second report gets its own id, and leaves the first untouched ------
  await win.click('button:has-text("Done")').catch(() => {})
  await win.keyboard.press('Meta+Shift+B')
  await win.waitForSelector('[role="dialog"] textarea', { timeout: 5000 })
  await win.fill('[role="dialog"] textarea', 'Second, unrelated problem.')
  await win.click('button:has-text("File as written")')
  await win.waitForSelector('text=/Filed as WOS-/', { timeout: 15000 }).catch(() => null)

  const log2 = fs.readFileSync(FAKE_LOG, 'utf8')
  check('a second report becomes WOS-002', log2.includes('## WOS-002 · '))
  check('the log is append-only — the first entry survived byte-identical', log2.startsWith(log.trimEnd()))

  await win.screenshot({ path: path.join(__dirname, 'bug-reporter.png') }).catch(() => {})
  await app.close()
  finish()
}

function finish() {
  // Clear the test repo path so the app goes back to auto-resolving the real one.
  console.log(failures === 0 ? '\nAll bug-reporter checks passed.' : `\n${failures} check(s) FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('e2e crashed:', err)
  process.exit(1)
})
