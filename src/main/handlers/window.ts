import { app, shell, type IpcMain } from 'electron'
import { IPC } from '../ipc-channels'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError } from '../ipc-validator'
import { assertMainFrame } from '../security'
import { mainWindow } from '../main-window'
import { setHostSettings, windowStyle, type WindowStyle } from '../host-profile'

/**
 * The window style setting (Settings → Appearance → Window) and what the clean
 * style's title bar needs. The style applies when a window is created, so the
 * renderer is told both the setting and the style this window was made with.
 */

let frameStyle: WindowStyle | 'mac' = 'standard'

/** Recorded by createWindow: the style the live window was made with. */
export function setWindowFrameStyle(style: WindowStyle | 'mac'): void {
  frameStyle = style
}

export function registerWindowHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, IPC.WINDOW_STYLE, (event) => {
    assertMainFrame(event)
    return { platform: process.platform, setting: windowStyle(), current: frameStyle, supported: process.platform !== 'darwin' }
  })

  ipcHandle(ipcMain, IPC.WINDOW_SET_STYLE, (event, style: unknown) => {
    assertMainFrame(event)
    if (style !== 'standard' && style !== 'clean') throw new IpcValidationError('Window style must be standard or clean')
    setHostSettings({ windowStyle: style })
    return { ok: true as const, setting: windowStyle() }
  })

  /** Restart to apply a new window style. */
  ipcHandle(ipcMain, IPC.WINDOW_RELAUNCH, (event) => {
    assertMainFrame(event)
    app.relaunch()
    app.quit()
    return { ok: true as const }
  })

  /** Windows only: the system page with "Automatically hide the taskbar". */
  ipcHandle(ipcMain, IPC.WINDOW_TASKBAR_SETTINGS, async (event) => {
    assertMainFrame(event)
    if (process.platform !== 'win32') return { ok: false as const }
    await shell.openExternal('ms-settings:taskbar')
    return { ok: true as const }
  })

  ipcHandle(ipcMain, IPC.WINDOW_IS_MAXIMIZED, (event) => {
    assertMainFrame(event)
    return mainWindow()?.isMaximized() ?? false
  })
}
