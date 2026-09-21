import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { registerFsHandlers } from './handlers/fs'
import { registerPrintHandlers } from './printing'
import { registerShellHandlers } from './handlers/shell'
import { registerTerminalHandlers } from './handlers/terminal'
import { registerWatcherHandlers } from './handlers/watcher'
import { registerTrashHandlers } from './handlers/trash'
import { registerAgentHandlers, shutdownAgents } from './handlers/agent'
import { registerCalendarHandlers } from './handlers/calendar'
import { registerDriveHandlers } from './handlers/drive'
import { registerPdfHandlers } from './handlers/pdf'
import { registerAgentPtyHandlers } from './handlers/agent-pty'
import { registerCheckpointHandlers } from './handlers/checkpoint'
import { registerSnapshotHandlers } from './handlers/snapshots'
import { registerSearchHandlers, shutdownSearch } from './handlers/search'
import { registerMemoryHandlers } from './handlers/memory'
import { registerOfficeHandlers } from './handlers/office'
import { registerLokHandlers } from './handlers/lok'
import { registerSkillsHandlers } from './handlers/skills'
import { registerAgentsHandlers } from './handlers/agents'
import { registerSystemHandlers } from './handlers/system'
import { registerSecretsHandlers } from './handlers/secrets'
import { registerComponentsHandlers } from './handlers/components'
import { registerHistoryHandlers, shutdownHistory } from './handlers/history'
import { registerDownloads } from './browser/downloads'
import { registerMetricHandlers } from './handlers/metrics'
import { registerRangeHandlers } from './handlers/ranges'
import { registerCaseHandlers } from './handlers/cases'
import { registerCollectionHandlers } from './handlers/collections'
import { registerCanvasHandlers } from './handlers/canvas'
import { registerMailHandlers } from './handlers/mail'
import { registerBrandHandlers } from './handlers/brand'
import { registerAccountsHandlers } from './handlers/accounts'
import { registerConnectionsHandlers } from './handlers/connections'
import { registerRunsHandlers, shutdownRunQueue } from './handlers/runs'
import { registerRoutinesHandlers, startRoutines, stopRoutines } from './handlers/routines'
import { registerNotifyHandlers } from './notify'
import { registerBugHandlers } from './handlers/bugs'
import { registerBrowserHandlers } from './browser/browserControl'
import { installDocgen } from './docgen'
import { installComponentCli } from './component-cli'
import { installMetricCli } from './install-metric-cli'
import { installCollectionCli } from './install-collection-cli'
import { installCaseCli } from './install-case-cli'
import { installMcpTokenCli } from './install-mcp-token-cli'
import { installActionCli } from './install-action-cli'
import { startActionBridge, stopActionBridge, resolveActionResult } from './agent/actionBridge'
import { lokDispose } from './office/lokEngine'
import { applySessionSecurity, hardenWindow } from './security'
import { loadPersistedRoot, setWorkspaceRoot } from './workspace-root'
import { registerMenu } from './menu'
import { initCrashReporter } from './crash-reporter'
import { initUpdater, registerUpdaterHandlers } from './updater'
import { ipcHandle, runAllCleanups } from './ipc-registry'
import { IPC } from './ipc-channels'
import { mainWindow, setMainWindow } from './main-window'

// electron-vite sets ELECTRON_RENDERER_URL only when the dev server is running.
// Keying off it (not app.isPackaged) lets the built app load its bundled
// renderer even when launched unpackaged (e.g. e2e tests).
const rendererUrl = process.env['ELECTRON_RENDERER_URL']
const isDev = !!rendererUrl

// Only one instance may run — a second would fight over the named Docker
// container and clobber shared workspace state.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    // The app opens IN fullscreen — the splash + workspace are an immersive
    // surface, not a floating window. Esc / the green button still exits.
    fullscreen: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      // Security: renderer has no Node access; all Node calls go through validated IPC
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Enables the <webview> tag used ONLY by the in-app Browser surface. The
      // tag alone grants no privilege — each guest is hardened in security.ts
      // (own partition, no node integration, no preload) via will-attach-webview.
      webviewTag: true,
      experimentalFeatures: false,
    },
  })

  // Navigation, new-window, and webview hardening (see security.ts).
  hardenWindow(win)

  if (rendererUrl) {
    win.loadURL(rendererUrl)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Track every window we create — including the one app.on('activate') makes
  // after the user closed the last one — so handlers always send to a LIVE
  // window instead of the dead one they were registered with.
  setMainWindow(win)
  return win
}

/**
 * Let the in-app browser accept third-party cookies.
 *
 * This is the login loop. Chromium inside Electron blocks third-party cookies
 * by default — a longstanding, documented Electron limitation with no
 * per-session API — and every "sign in with" flow depends on them: the provider
 * checks your session from a hidden CROSS-SITE iframe. Blocked, that check
 * fails, and the log shows it in plain words:
 *
 *   outlook.live.com/mail/oauthRedirect.html#error=login_required
 *   &error_description=Silent+authentication+was+denied
 *
 * LinkedIn reports the same failure as ?errorKey=auth_context_expired. It looks
 * like a cookie or cache problem and is not: first-party cookies persist
 * perfectly, which is exactly why it survived so much investigation.
 *
 * Must be set BEFORE app.whenReady — Chromium reads these at startup.
 *
 * The trade-off is real and deliberate: third-party cookies are the tracking
 * mechanism the web is moving away from. This applies to the in-app BROWSER,
 * which exists to be a browser; the app's own surfaces do not use them. A
 * browser that cannot sign in to anything is not a browser.
 */
app.commandLine.appendSwitch('disable-features', [
  // Partitions third-party storage per top-level site, which breaks the
  // provider's own iframe from seeing its own session.
  'ThirdPartyStoragePartitioning',
  // Chromium's third-party-cookie deprecation trial.
  'TrackingProtection3pcd',
  'ThirdPartyCookieDeprecation',
].join(','))
// The pref Chromium exposes for the block itself.
app.commandLine.appendSwitch('disable-third-party-cookie-blocking')

app.whenReady().then(() => {
  // Local-first crash/log capture — before anything that might throw.
  initCrashReporter()
  applySessionSecurity(isDev)
  // Env-gated test hook: lets e2e open a workspace without the native dialog.
  // Inert in normal use — only fires when the variable is explicitly set.
  const testRoot = process.env['WORKSPACE_TEST_ROOT']
  if (testRoot) {
    try { setWorkspaceRoot(testRoot) } catch { /* invalid path — ignore */ }
  } else {
    loadPersistedRoot()
  }
  const win = createWindow()

  // Focus the existing window if a second launch is attempted.
  app.on('second-instance', () => {
    const live = mainWindow()
    if (!live) return
    if (live.isMinimized()) live.restore()
    live.focus()
  })

  // Native application menu + the menu/workspace IPC surface (see menu.ts).
  registerMenu(ipcMain, isDev)

  registerFsHandlers(ipcMain)
  registerPrintHandlers(ipcMain)
  registerShellHandlers(ipcMain, win)
  registerTerminalHandlers(ipcMain, win)
  registerWatcherHandlers(ipcMain, win)
  registerTrashHandlers(ipcMain)
  registerAgentHandlers(ipcMain, win)
  registerAgentPtyHandlers(ipcMain, win)
  registerCheckpointHandlers(ipcMain)
  registerSnapshotHandlers(ipcMain)
  registerCalendarHandlers(ipcMain)
  registerDriveHandlers(ipcMain)
  registerPdfHandlers(ipcMain)
  registerSearchHandlers(ipcMain)
  registerMemoryHandlers(ipcMain)
  registerOfficeHandlers(ipcMain, win)
  registerLokHandlers(ipcMain, win)
  registerSkillsHandlers(ipcMain)
  registerAgentsHandlers(ipcMain)
  registerSystemHandlers(ipcMain)
  registerSecretsHandlers(ipcMain)
  registerComponentsHandlers(ipcMain)
  registerHistoryHandlers()
  registerCaseHandlers(ipcMain)
  // Downloads from the in-app browser land in the workspace's Downloads folder,
  // so a file you just fetched shows up in Files beside everything else rather
  // than in a hidden application directory.
  registerDownloads(() => BrowserWindow.getAllWindows()[0] ?? null)
  registerMetricHandlers(ipcMain)
  registerRangeHandlers(ipcMain)
  registerCollectionHandlers(ipcMain)
  registerCanvasHandlers(ipcMain)
  registerMailHandlers(ipcMain)
  registerBrandHandlers(ipcMain)
  registerAccountsHandlers(ipcMain)
  registerConnectionsHandlers(ipcMain)
  registerNotifyHandlers(ipcMain)
  registerRunsHandlers(ipcMain)
  registerRoutinesHandlers(ipcMain)
  // Routines catch up once and arm — after every handler exists, since a fire
  // enqueues a background run that streams through them.
  startRoutines()
  registerBugHandlers(ipcMain)
  // Browser drive: the agent navigates/screenshots/extracts the visible in-app
  // Browser <webview>. The guest webContents is captured in security.ts.
  registerBrowserHandlers(ipcMain)
  registerUpdaterHandlers(ipcMain)

  // Auto-update: background check + install-on-quit. No-op in dev/unsigned.
  initUpdater(win, isDev)

  // Install the office-docgen skill + `wos-gen` shim for the agent (best-effort).
  installDocgen()
  installComponentCli()
  installMetricCli()
  installCollectionCli()
  installCaseCli()
  installMcpTokenCli()
  // AGENT→ACTION bridge: install the `wos-action` shim + open the local unix
  // socket now that a window exists. The renderer replies to run-requests over
  // AGENT_ACTION_RESULT (reqId-correlated) — route those back to the bridge.
  installActionCli()
  startActionBridge()
  // The renderer executor replies with a fire-and-forget `send` (not invoke),
  // so this is ipcMain.on, not ipcHandle. Payload is reqId-correlated in main.
  ipcMain.on(IPC.AGENT_ACTION_RESULT, (_event, payload: unknown) => {
    const p = (payload ?? {}) as { reqId?: unknown; ok?: unknown; error?: unknown; result?: unknown }
    resolveActionResult(p.reqId, p.ok, p.error, p.result)
  })

  // Window control handlers
  ipcHandle(ipcMain, IPC.WINDOW_MINIMIZE, () => win.minimize())
  ipcHandle(ipcMain, IPC.WINDOW_MAXIMIZE, () => (win.isMaximized() ? win.unmaximize() : win.maximize()))
  ipcHandle(ipcMain, IPC.WINDOW_CLOSE, () => mainWindow()?.close())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Tear down background services before exit — the single shutdown path.
// Registered cleanups (e.g. shell PTYs) run alongside the direct shutdowns.
app.on('before-quit', async (event) => {
  event.preventDefault()
  try {
    shutdownAgents()
    stopRoutines()
    shutdownRunQueue()
    stopActionBridge()
    await shutdownSearch()
    shutdownHistory()
    await runAllCleanups()
    lokDispose()
  } finally {
    app.exit(0)
  }
})
