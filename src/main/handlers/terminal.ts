import { IpcMain, BrowserWindow } from 'electron'
import { IPC } from '../ipc-channels'
import { ipcHandle, registerCleanup } from '../ipc-registry'
import { validateShellInput, validateShellResize } from '../ipc-validator'
import { assertMainFrame } from '../security'
import { createSession, write, resize, kill, shutdownTerminals } from '../terminal/ptyHost'
import { setContext, type WorkspaceContext } from '../context/workspaceContext'
import { sendToWindow, setMainWindow } from '../main-window'

/**
 * IPC surface for the integrated Terminal Dock + live workspace harness.
 * The PTY host (main/terminal/ptyHost.ts) lazy-requires node-pty; this handler
 * only wires create/write/resize/kill and streams data/exit to the renderer.
 */
export function registerTerminalHandlers(ipcMain: IpcMain, win: BrowserWindow): void {
  setMainWindow(win)
  registerCleanup('terminal-ptys', shutdownTerminals)

  ipcHandle(ipcMain, IPC.TERMINAL_CREATE, (event, sessionId: unknown) => {
    assertMainFrame(event)
    if (typeof sessionId !== 'string' || !sessionId) return { pid: -1 }
    return createSession(sessionId, {
      onData: (data) => {
        sendToWindow(IPC.TERMINAL_DATA, sessionId, data)
      },
      onExit: (code) => {
        sendToWindow(IPC.TERMINAL_EXIT, sessionId, code)
      },
    })
  })

  ipcHandle(ipcMain, IPC.TERMINAL_WRITE, (_event, sessionId: unknown, data: unknown) => {
    if (typeof sessionId !== 'string') return
    write(sessionId, validateShellInput(data))
  })

  ipcHandle(ipcMain, IPC.TERMINAL_RESIZE, (_event, sessionId: unknown, cols: unknown, rows: unknown) => {
    if (typeof sessionId !== 'string') return
    const { cols: c, rows: r } = validateShellResize(cols, rows)
    resize(sessionId, c, r)
  })

  ipcHandle(ipcMain, IPC.TERMINAL_KILL, (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') return
    kill(sessionId)
  })

  // Live harness — the renderer pushes surface/file/folder/root as the user
  // navigates. Merged into the shared context; future spawns inherit the env.
  ipcHandle(ipcMain, IPC.CONTEXT_SET, (event, patch: unknown) => {
    assertMainFrame(event)
    if (!patch || typeof patch !== 'object') return
    const p = patch as Record<string, unknown>
    const clean: Partial<WorkspaceContext> = {}
    if (typeof p.root === 'string' || p.root === null) clean.root = p.root as string | null
    if (typeof p.surface === 'string' || p.surface === null) clean.surface = p.surface as string | null
    if (typeof p.folder === 'string' || p.folder === null) clean.folder = p.folder as string | null
    if (typeof p.openFile === 'string' || p.openFile === null)
      clean.openFile = p.openFile as string | null
    // The page open in the in-app browser. This handler WHITELISTS fields, so a
    // new one that is not listed here is silently dropped — the push succeeds,
    // nothing throws, and the value simply never arrives. That is exactly how
    // browserUrl stayed null while the address bar plainly showed the page.
    if (typeof p.browserUrl === 'string' || p.browserUrl === null)
      clean.browserUrl = p.browserUrl as string | null
    if (typeof p.browserTitle === 'string' || p.browserTitle === null)
      clean.browserTitle = p.browserTitle as string | null
    // The per-surface action manifest {id, agentHint} + the full id allow-set,
    // computed by the renderer from the SAME surfaceActions registry the dock
    // uses. Sanitized to strings so the socket bridge's allow-set is trustworthy.
    if (Array.isArray(p.actions)) {
      clean.actions = p.actions
        .filter((a): a is { id: string; agentHint: string } =>
          !!a && typeof a === 'object' &&
          typeof (a as { id?: unknown }).id === 'string' &&
          typeof (a as { agentHint?: unknown }).agentHint === 'string')
        .map((a) => ({ id: a.id, agentHint: a.agentHint }))
    }
    if (Array.isArray(p.allActionIds)) {
      clean.allActionIds = p.allActionIds.filter((id): id is string => typeof id === 'string')
    }
    setContext(clean)
  })
}
