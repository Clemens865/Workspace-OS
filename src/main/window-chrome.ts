import type { BrowserWindowConstructorOptions } from 'electron'

/**
 * The main window's frame, per platform.
 *
 * macOS opens full screen with the title bar hidden: the traffic lights stay
 * in the corner and the green button leaves full screen. On Windows and Linux
 * those options remove the only close, minimise and maximise buttons and hide
 * the taskbar, so there the app opens as a normal maximised window with the
 * system title bar; View ▸ Toggle Full Screen (F11) still goes full screen,
 * and the menu bar shows on Alt.
 */
export function windowChrome(platform: NodeJS.Platform): { options: BrowserWindowConstructorOptions; maximize: boolean } {
  if (platform === 'darwin') return { options: { fullscreen: true, titleBarStyle: 'hiddenInset' }, maximize: false }
  return { options: { fullscreen: false, autoHideMenuBar: true }, maximize: true }
}
