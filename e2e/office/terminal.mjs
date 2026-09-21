// e2e: the Shell terminal (typing + Enter reach the PTY) and the Agent (a run
// streams output). Run: node e2e/office/terminal.mjs
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const APP = path.join(ROOT, 'release/mac-arm64/Workspace OS.app/Contents')
const WS = '/tmp/wos-test'

function claudePresent() {
  for (const c of [process.env.CLAUDE_BIN, `${process.env.HOME}/.local/bin/claude`, '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) {
    if (c && fs.existsSync(c)) return true
  }
  try { execFileSync(process.env.SHELL ?? '/bin/zsh', ['-lc', 'command -v claude'], { stdio: 'ignore' }); return true } catch { return false }
}

async function main() {
  fs.mkdirSync(WS, { recursive: true })
  try { execFileSync('pkill', ['-9', '-f', 'Workspace OS.app|wos-lok-host|out/main/index.js'], { stdio: 'ignore' }) } catch { /* */ }
  await new Promise((r) => setTimeout(r, 3000))

  const env = {
    ...process.env,
    WORKSPACE_TEST_ROOT: WS,
    WOS_LOK_INSTALL: APP + '/Resources/libreoffice/LibreOffice.app/Contents/Frameworks/',
    WOS_LOK_FUND: APP + '/Resources/libreoffice/LibreOffice.app/Contents/Resources/fundamentalrc',
    WOS_LOK_HOST: path.join(ROOT, 'scripts/lok/wos-lok-host'),
    WOS_DOCGEN_DIR: path.join(ROOT, 'resources/office-docgen'),
  }
  const app = await electron.launch({ args: [path.join(ROOT, 'out/main/index.js')], cwd: ROOT, env })
  const win = await app.firstWindow({ timeout: 20000 })
  await win.waitForSelector('#root', { timeout: 20000 })
  await win.waitForTimeout(800)

  let pass = 0, fail = 0
  const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m) } }

  // --- Shell: typing + Enter reach the PTY ---
  const shellOut = await win.evaluate(async () => {
    let buf = ''
    window.workspace.shell.onOutput((_sid, d) => { buf += d })
    await window.workspace.shell.spawn('e2e-sh')
    await new Promise((r) => setTimeout(r, 800)) // prompt
    // type a command and press Enter (\r) — the historic bug: \r was rejected
    for (const ch of 'echo SHELL_OK_42') await window.workspace.shell.input('e2e-sh', ch)
    await window.workspace.shell.input('e2e-sh', '\r')
    await new Promise((r) => setTimeout(r, 1200))
    return buf
  })
  ok(/SHELL_OK_42/.test(shellOut) && /SHELL_OK_42[\s\S]*SHELL_OK_42|SHELL_OK_42\r?\n/.test(shellOut), 'shell: command echoed AND executed (Enter works)')
  // The command runs only if Enter reached the PTY: output contains the value twice
  // (the echoed input line + the command result) OR a fresh prompt after it.
  const ran = (shellOut.match(/SHELL_OK_42/g) || []).length >= 2
  ok(ran, 'shell: "echo" actually executed (value appears twice)')

  // --- Agent: a run streams output ---
  if (claudePresent()) {
    const agentOut = await win.evaluate(async () => {
      let buf = ''
      window.workspace.agent.onOutput((_r, c) => { buf += c })
      const done = new Promise((res) => window.workspace.agent.onDone(() => res()))
      try {
        await window.workspace.agent.run('e2e-agent', 'Reply with exactly the single word: PONG', [], null, 'safe')
      } catch (e) { return 'RUN_ERROR: ' + (e.message || e) }
      await Promise.race([done, new Promise((r) => setTimeout(r, 60000))])
      return buf
    })
    ok(!/RUN_ERROR|EBADF/.test(agentOut), 'agent: run started without spawn error')
    ok(/PONG/i.test(agentOut), 'agent: streamed a response')
    if (/RUN_ERROR|EBADF/.test(agentOut)) console.log('    agent output:', agentOut.slice(0, 200))
  } else {
    console.log('  - agent: skipped (claude not found)')
  }

  await app.close().catch(() => {})
  console.log(`\nterminal e2e: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

const guard = setTimeout(() => { console.log('HUNG'); process.exit(2) }, 120000)
main().finally(() => clearTimeout(guard))
