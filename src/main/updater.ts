import electronUpdater from 'electron-updater'
import { app, BrowserWindow, dialog, IpcMain } from 'electron'
import { ipcHandle, registerCleanup } from './ipc-registry'
import { log } from './crash-reporter'

/**
 * Auto-update wiring (electron-updater).
 *
 * Downloads updates in the background and installs them on quit. It is a
 * deliberate no-op in dev and in any unpackaged/unsigned build:
 *  - macOS Squirrel refuses to apply updates to an unsigned app, so we never
 *    even start the poller there — a failed check must degrade gracefully, not
 *    crash. See docs/HARDENING.md for the signing prerequisites.
 *  - The feed URL comes from the electron-builder `publish` config (GitHub
 *    releases), baked into app-update.yml at build time.
 *
 * Renderer contract:
 *  - main → renderer  'updater:update-ready'  { version }   (banner/toast)
 *  - renderer → main  'updater:install'                     (restart & install)
 *  - renderer → main  'updater:check'                       (manual check)
 */

const { autoUpdater } = electronUpdater

const CHECK_INTERVAL_HOURS = 6
const FIRST_CHECK_DELAY_MS = 10_000

let mainWin: BrowserWindow | null = null
// True while a user-initiated check is in flight, so we can surface an
// "up to date" / "unavailable" dialog only when they explicitly asked.
let manualCheck = false
let pollTimer: ReturnType<typeof setInterval> | null = null

function macRequiresSignature(): boolean {
  // On macOS, updates require a signed app. Unsigned builds would emit an
  // error on every check — skip the poller entirely there.
  return process.platform === 'darwin' && !app.isPackaged
}

async function safeCheck(): Promise<void> {
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    // Network down, no release yet, unsigned — all non-fatal.
    log('error', '[updater] check failed', err)
    if (manualCheck && mainWin) {
      manualCheck = false
      void dialog.showMessageBox(mainWin, {
        type: 'info',
        message: 'Update check unavailable',
        detail: 'Could not check for updates right now. Please try again later.',
      })
    }
  }
}

/** Wires the auto-updater. No-op in dev / unpackaged / unsigned. */
export function initUpdater(win: BrowserWindow, isDev: boolean): void {
  mainWin = win

  if (isDev || !app.isPackaged || macRequiresSignature()) {
    log('info', '[updater] disabled (dev / unpackaged / unsigned)')
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // Route electron-updater's chatter into our rotating file log.
  autoUpdater.logger = {
    info: (m: unknown) => log('info', `[updater] ${String(m)}`),
    warn: (m: unknown) => log('warn', `[updater] ${String(m)}`),
    error: (m: unknown) => log('error', `[updater] ${String(m)}`),
    debug: () => {},
  }

  autoUpdater.on('update-available', (info) => {
    log('info', `[updater] update available: ${info.version}`)
  })

  autoUpdater.on('update-not-available', () => {
    if (manualCheck && mainWin) {
      manualCheck = false
      void dialog.showMessageBox(mainWin, {
        type: 'info',
        message: "You're up to date",
        detail: `Workspace OS ${app.getVersion()} is the latest version.`,
      })
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    manualCheck = false
    log('info', `[updater] downloaded ${info.version} — will install on quit`)
    // Subtle renderer affordance: "update ready — restart" banner.
    win.webContents.send('updater:update-ready', { version: info.version })
  })

  autoUpdater.on('error', (err) => {
    log('error', '[updater] error', err)
    if (manualCheck && mainWin) {
      manualCheck = false
      void dialog.showMessageBox(mainWin, {
        type: 'info',
        message: 'Update check unavailable',
        detail: 'Could not check for updates right now. Please try again later.',
      })
    }
  })

  // Check shortly after launch, then on a slow interval.
  setTimeout(() => void safeCheck(), FIRST_CHECK_DELAY_MS)
  pollTimer = setInterval(() => void safeCheck(), CHECK_INTERVAL_HOURS * 3_600_000)
  pollTimer.unref?.()
  registerCleanup('updater-poll', () => {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
  })
}

/** Manual "Check for Updates…" (menu + renderer). Always gives feedback. */
export function checkForUpdatesManual(): void {
  if (!app.isPackaged || macRequiresSignature()) {
    if (mainWin) {
      void dialog.showMessageBox(mainWin, {
        type: 'info',
        message: 'Updates are disabled in this build',
        detail: app.isPackaged
          ? 'Automatic updates require a signed release build.'
          : 'Automatic updates are disabled while running from source.',
      })
    }
    return
  }
  manualCheck = true
  void safeCheck()
}

/** Registers the renderer-facing updater IPC (install / manual check). */
export function registerUpdaterHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, 'updater:install', () => {
    try {
      autoUpdater.quitAndInstall()
    } catch (err) {
      log('error', '[updater] quitAndInstall failed', err)
    }
  })
  ipcHandle(ipcMain, 'updater:check', () => {
    checkForUpdatesManual()
  })
}
