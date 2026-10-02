/**
 * Workspace switching must reach the renderer — including after the window was
 * closed and reopened from the dock.
 *
 * 2026-09-15: picking a workspace from the Home switcher persisted the new root
 * in main but the desk kept showing the old one. `menu.ts` sent
 * `workspace:root-changed` to the BrowserWindow captured at startup; after
 * macOS `activate` recreated the window, that handle was dead and the send went
 * nowhere (the throw only reached the console, never main.log). The folder
 * picker had the same symptom for a different reason: it set the root and sent
 * nothing at all.
 *
 * Steps: open-recent in the first window must fire root-changed; close the
 * window, emit `activate` (a new window), open-recent again must fire in THAT
 * window too. The second half is the negative case that failed before the fix.
 *
 * Run: npm run e2e:workspace-switch   (rebuild:electron + build first)
 */
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { fileURLToPath } from 'url'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

let failures = 0
const check = (name, cond) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}`)
  if (!cond) failures++
}

// Two throwaway workspaces so the switch is between real, distinct folders.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-switch-'))
const wsA = path.join(scratch, 'alpha')
const wsB = path.join(scratch, 'beta')
fs.mkdirSync(wsA)
fs.mkdirSync(wsB)
fs.writeFileSync(path.join(wsA, 'a.md'), '# alpha\n')
fs.writeFileSync(path.join(wsB, 'b.md'), '# beta\n')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-switch-udata-'))

const app = await electron.launch({
  args: [path.join(root, 'out/main/index.js')],
  cwd: root,
  env: { ...process.env, WORKSPACE_TEST_ROOT: wsA, WOS_USERDATA_DIR: userData },
})

/** Ask the renderer to open `dir` and report whether root-changed arrived with it. */
async function switchAndListen(win, dir) {
  return win.evaluate(
    ({ dir, timeoutMs }) =>
      new Promise((resolve) => {
        const off = window.workspace.fs.onRootChanged((r) => {
          off()
          resolve({ event: r })
        })
        const timer = setTimeout(() => {
          off()
          resolve({ event: null, timedOut: true })
        }, timeoutMs)
        void window.workspace.fs.openWorkspace(dir).then((ok) => {
          if (!ok) {
            clearTimeout(timer)
            off()
            resolve({ event: null, rejected: true })
          }
        })
      }),
    { dir, timeoutMs: 4000 },
  )
}

async function readyWindow() {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForSelector('#root', { timeout: 20000 })
  await win.waitForTimeout(800)
  return win
}

try {
  const win1 = await readyWindow()
  const first = await switchAndListen(win1, wsB)
  check('open-recent in the first window fires root-changed with the new root', first.event === wsB)
  check('main persisted the new root', (await win1.evaluate(() => window.workspace.fs.getWorkspaceRoot())) === wsB)

  // Close the window (the app stays alive on macOS) and reopen from the dock.
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.close()
  })
  await new Promise((r) => setTimeout(r, 800))
  check('no window remains after close', (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) === 0)
  await app.evaluate(({ app }) => app.emit('activate'))
  await new Promise((r) => setTimeout(r, 800))

  const win2 = await readyWindow()
  check('activate created a fresh window', win2 !== win1)
  const second = await switchAndListen(win2, wsA)
  check('open-recent in the REOPENED window still fires root-changed (negative case)', second.event === wsA)
  check('main persisted the root either way', (await win2.evaluate(() => window.workspace.fs.getWorkspaceRoot())) === wsA)
} catch (err) {
  console.error('  ✗ harness error:', err?.message ?? err)
  failures++
} finally {
  await app.close().catch(() => {})
  fs.rmSync(scratch, { recursive: true, force: true })
  fs.rmSync(userData, { recursive: true, force: true })
}

console.log(`\nWORKSPACE SWITCH: ${failures === 0 ? 'all passed' : failures + ' failed'}`)
process.exit(failures === 0 ? 0 : 1)
