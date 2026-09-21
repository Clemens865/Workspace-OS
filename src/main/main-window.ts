import { BrowserWindow } from 'electron'

/**
 * The LIVE main window.
 *
 * Every handler used to capture the BrowserWindow handed to its `register…`
 * function at startup and send to it forever. That reference dies the moment the
 * window does: on macOS, closing the window and reopening from the dock runs
 * `app.on('activate') → createWindow()`, which makes a NEW window while the
 * handlers still hold the old one. The next send threw
 * `TypeError: Object has been destroyed` — which surfaced as an agent simply
 * refusing to run, with an error that named nothing useful.
 *
 * So the window is resolved at SEND time instead of captured. `createWindow`
 * registers each new window here, and a send with no live window is a no-op
 * rather than a crash: a background result arriving after the user closed the
 * window is normal, not an error.
 */
let current: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow): void {
  current = win
}

/** The live main window, or null. Never returns a destroyed one. */
export function mainWindow(): BrowserWindow | null {
  if (current && !current.isDestroyed()) return current
  // The tracked window is gone (or was never set — e.g. a handler registered
  // before createWindow). Fall back to any surviving window.
  const alive = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  current = alive ?? null
  return current
}

/** Send an IPC message to the live window; a no-op when there is none. */
export function sendToWindow(channel: string, ...args: unknown[]): void {
  const win = mainWindow()
  if (!win) return
  try {
    win.webContents.send(channel, ...args)
  } catch {
    // Raced with teardown between the liveness check and the send — the window
    // is going away, so there is nothing to deliver and nothing to report.
  }
}
