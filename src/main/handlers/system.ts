import { IpcMain, clipboard } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { IPC } from '../ipc-channels'
import { ipcHandle } from '../ipc-registry'
import { lokAvailable } from '../office/lokEngine'
import { docgenVenvPython } from '../docgen'
import { findTool } from '../platform-tools'

/** Read-only health of the engines/tools the IWE depends on (for Settings). */
export interface SystemStatus {
  engine: boolean // bundled LibreOffice/LOKit
  python: boolean // office-docgen managed venv ready
  claude: { ok: boolean; path: string | null } // claude CLI for the agent
}

function resolveClaude(): string | null {
  return findTool('claude', 'CLAUDE_BIN', {
    posixCandidates: [path.join(os.homedir(), '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'],
  })
}

export function registerSystemHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, IPC.SYSTEM_STATUS, (): SystemStatus => {
    const claudePath = resolveClaude()
    return {
      engine: lokAvailable(),
      python: fs.existsSync(docgenVenvPython()),
      claude: { ok: !!claudePath, path: claudePath },
    }
  })

  // WOS-008: the system pasteboard, reachable from the renderer.
  //
  // navigator.clipboard is not an option — applySessionSecurity denies every
  // permission request (security.ts), so `clipboard-read` is refused and
  // readText() rejects. That deny-all is deliberate and worth keeping, so the
  // renderer asks main instead. Electron's clipboard module needs no
  // permission and no user activation.
  ipcHandle(ipcMain, IPC.CLIPBOARD_READ, (): string => clipboard.readText())

  ipcHandle(ipcMain, IPC.CLIPBOARD_WRITE, (_e, text: unknown): boolean => {
    // Writing a non-string would stringify to "[object Object]" on the user's
    // pasteboard, silently replacing whatever they had. Refuse instead.
    if (typeof text !== 'string') return false
    clipboard.writeText(text)
    return true
  })
}
