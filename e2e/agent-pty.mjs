/**
 * E2E smoke for agent broker v2 — the interactive PTY `claude` session.
 *
 * Verifies the additive PTY mode without needing a full authenticated claude
 * run: the session toggles to interactive, the xterm viewport mounts, the PTY
 * spawns and streams SOMETHING back (claude's own output or an auth/exit line),
 * and the terminal accepts keystrokes. A real permission prompt needs auth + a
 * tool call, which can't be driven headlessly — see the note printed at the end.
 *
 * Run with: node e2e/agent-pty.mjs  (after `npm run build` + `npm run rebuild:electron`)
 */
import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

let failures = 0
function check(name, cond) {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.error(`  ✗ ${name}`); failures++ }
}

async function main() {
  console.log('Launching Electron app…')
  const app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root })
  const window = await app.firstWindow()
  window.on('console', (msg) => console.log(`  [renderer:${msg.type()}] ${msg.text()}`))
  window.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`))
  await window.waitForLoadState('domcontentloaded')
  await window.waitForSelector('#root', { timeout: 10000 })

  // The broker-v2 preload namespace is exposed.
  const hasPtyApi = await window.evaluate(() => {
    const a = window.workspace?.agentPty
    return !!a && !!a.spawn && !!a.input && !!a.onOutput && !!a.onExit
  })
  check('preload exposes workspace.agentPty', hasPtyApi)

  // Also the -p ledger hook is present (additive, no regression).
  const hasRunMeta = await window.evaluate(() => typeof window.workspace?.agent?.onRunMeta === 'function')
  check('preload exposes agent.onRunMeta (budget ledger)', hasRunMeta)

  // Switch the agent session to interactive (PTY) mode.
  const interactiveBtn = window.getByText('⌨ Interactive', { exact: false }).first()
  await interactiveBtn.click({ timeout: 8000 }).catch((e) => console.log(`  · click failed: ${e.message}`))

  // The PTY session view mounts.
  const ptyMounted = await window
    .getByTestId('agent-pty')
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false)
  check('interactive PTY session mounts (data-testid=agent-pty)', ptyMounted)

  const xtermMounted = await window
    .locator('[data-testid="agent-pty"] .xterm')
    .first()
    .isVisible()
    .catch(() => false)
  check('xterm viewport is present in the PTY session', xtermMounted)

  // Give the PTY a moment to spawn claude and stream output (or an exit/auth line).
  await window.waitForTimeout(3500)
  const gotOutput = await window.evaluate(() => {
    const el = document.querySelector('[data-testid="agent-pty"] .xterm-rows')
    return !!el && (el.textContent || '').trim().length > 0
  })
  check('PTY streamed output into the viewport', gotOutput)

  // Accepts keystrokes: focus the xterm helper textarea and type.
  const typed = await window.evaluate(async () => {
    const ta = document.querySelector('[data-testid="agent-pty"] .xterm-helper-textarea')
    if (!ta) return false
    ta.focus()
    return document.activeElement === ta
  })
  check('xterm input surface is focusable', typed)
  await window.keyboard.type('echo hi', { delay: 20 }).catch(() => {})

  // Still alive after input (no crash).
  const stillAlive = await window.evaluate(() => !!document.querySelector('[data-testid="agent-pty"]'))
  check('session survives keyboard input (no crash)', stillAlive)

  await window.screenshot({ path: path.join(root, 'e2e/agent-pty.png') })
  console.log('  · screenshot saved to e2e/agent-pty.png')
  console.log('  · note: a real permission prompt (HITL gate) needs an authenticated claude run + a tool call — not driveable headlessly.')

  await app.close()
  console.log(failures === 0 ? '\nE2E PASS' : `\nE2E FAIL (${failures} check(s) failed)`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => { console.error('E2E ERROR:', err); process.exit(1) })
