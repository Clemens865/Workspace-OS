import type { BrowserWindowConstructorOptions } from 'electron'
import type { WindowStyle } from './host-profile'

/**
 * The main window's frame, per platform.
 *
 * macOS opens full screen with the title bar hidden: the traffic lights stay
 * in the corner and the green button leaves full screen. On Windows and Linux
 * those options remove the only close, minimise and maximise buttons and hide
 * the taskbar, so there the app opens as a normal maximised window:
 *  - 'standard': the system title bar;
 *  - 'clean': no title bar; the renderer's CleanTitleBar shows minimise,
 *    maximise and close when the pointer reaches the top edge.
 * View ▸ Toggle Full Screen (F11) still goes full screen, and the menu bar
 * shows on Alt.
 */
export function windowChrome(
  platform: NodeJS.Platform,
  style: WindowStyle = 'standard',
): { options: BrowserWindowConstructorOptions; maximize: boolean; style: WindowStyle | 'mac' } {
  if (platform === 'darwin') return { options: { fullscreen: true, titleBarStyle: 'hiddenInset' }, maximize: false, style: 'mac' }
  if (style === 'clean') return { options: { fullscreen: false, autoHideMenuBar: true, titleBarStyle: 'hidden' }, maximize: true, style: 'clean' }
  return { options: { fullscreen: false, autoHideMenuBar: true }, maximize: true, style: 'standard' }
}
