import { IpcMain, BrowserWindow } from 'electron'
import os from 'os'
import path from 'path'
import { IPC } from '../ipc-channels'
import { ipcHandle, registerCleanup } from '../ipc-registry'
import { validateShellInput, validateShellResize } from '../ipc-validator'
import { assertMainFrame } from '../security'
import { getWorkspaceRoot } from '../workspace-root'
import { docgenBinDir, docgenVenvBinDir } from '../docgen'
import { sendToWindow, setMainWindow } from '../main-window'

// node-pty is a native module loaded at runtime
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pty = require('node-pty')

interface PtySession {
  process: ReturnType<typeof pty.spawn>
}

const sessions = new Map<string, PtySession>()

/** Kills every live PTY and clears the session map — runs on app quit so
 *  shells never outlive the app. */
export function shutdownShell(): void {
  for (const session of sessions.values()) {
    try {
      session.process.kill()
    } catch {
      /* already dead */
    }
  }
  sessions.clear()
}

export function registerShellHandlers(ipcMain: IpcMain, win: BrowserWindow): void {
  setMainWindow(win)
  registerCleanup('shell-ptys', shutdownShell)

  ipcHandle(ipcMain, IPC.SHELL_SPAWN, (event, sessionId: unknown) => {
    assertMainFrame(event)
    if (typeof sessionId !== 'string' || !sessionId) return

    const isWin = process.platform === 'win32'
    const shell = isWin ? 'powershell.exe' : process.env['SHELL'] ?? '/bin/zsh'

    // GUI apps launched from Finder get a thin PATH that omits ~/.local/bin
    // (where `claude` lives), Homebrew, etc. Two fixes, like a real IDE terminal:
    //  1. spawn a LOGIN shell so it sources the user's profile (full PATH), and
    //  2. seed common tool dirs + our office-docgen venv (so `python3`/`pip` have
    //     python-pptx/openpyxl/python-docx) and `wos-gen` are always on PATH —
    //     making the shell a first-class place to run `claude` and skills.
    const home = os.homedir()
    const seedPath = [
      docgenVenvBinDir(),
      docgenBinDir(),
      path.join(home, '.local', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      process.env['PATH'] ?? '',
    ].join(':')

    // Non-login interactive shell (sources ~/.zshrc, not ~/.zprofile) — a login
    // shell can trigger profile side-effects (session managers, etc.) that
    // interfere with the embedded terminal. The seeded PATH below already
    // provides claude/wos-gen/python, so login isn't needed for tooling.
    const proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      // Open in the active workspace folder, like an IDE's integrated terminal.
      cwd: getWorkspaceRoot() ?? process.env['HOME'] ?? os.homedir(),
      env: { ...process.env, PATH: seedPath },
    })

    proc.onData((data: string) => {
      sendToWindow(IPC.SHELL_OUTPUT, sessionId, data)
    })

    sessions.set(sessionId, { process: proc })
    return { pid: proc.pid }
  })

  ipcHandle(ipcMain, IPC.SHELL_INPUT, (_event, sessionId: unknown, input: unknown) => {
    if (typeof sessionId !== 'string') return
    const text = validateShellInput(input)
    sessions.get(sessionId)?.process.write(text)
  })

  ipcHandle(ipcMain, IPC.SHELL_RESIZE, (_event, sessionId: unknown, cols: unknown, rows: unknown) => {
    if (typeof sessionId !== 'string') return
    const { cols: c, rows: r } = validateShellResize(cols, rows)
    sessions.get(sessionId)?.process.resize(c, r)
  })

  ipcHandle(ipcMain, IPC.SHELL_KILL, (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') return
    const session = sessions.get(sessionId)
    if (session) {
      session.process.kill()
      sessions.delete(sessionId)
    }
  })
}
