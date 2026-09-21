import { IpcMain, Menu, dialog } from 'electron'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { ipcHandle } from './ipc-registry'
import { mainWindow, sendToWindow } from './main-window'
import { officeMenus, type OfficeMenuState, type MI } from './menu-office'
import { paletteCommands } from './office-menu-table'
import { browserMenus, type BrowserContext } from './menu-browser'
import { setWorkspaceRoot, clearWorkspaceRoot, getWorkspaceRoot } from './workspace-root'
import {
  loadRecentWorkspaces,
  pruneRecentWorkspaces,
  clearRecentWorkspaces,
} from './recent-workspaces'
import { snapshots } from './snapshots'
import { checkForUpdatesManual } from './updater'

/**
 * Owns the native application menu: static chrome (File/View/Go/Agent/Window)
 * plus the renderer-pushed dynamic parts (file actions, agent menu, office
 * context). Menu clicks travel one way — `menu:run-action` ids the renderer
 * routes to its handlers — so the menu bar stays a thin view over renderer and
 * engine state.
 */

/** Contextual file actions pushed from the renderer's action registry. */
interface MenuActionItem {
  id: string
  label: string
}
let fileActionItems: MenuActionItem[] = []

/** Dynamic contents of the top-level Agent menu, pushed from the renderer. */
interface AgentMenuData {
  agents: MenuActionItem[]
  skills: MenuActionItem[]
  mode: 'full' | 'safe'
  activeAgent: string | null
}
let agentMenu: AgentMenuData = { agents: [], skills: [], mode: 'full', activeAgent: null }

/**
 * The browser surface's pushed state: the actions it is offering right now, and
 * whether back/forward are available. null = the browser is not the active
 * surface, so its menus are absent rather than dead.
 */
let browserCtx: BrowserContext | null = null

/** Active office doc type for the contextual Edit/Format/Insert/View menus.
 *  null = no office doc active; 0 = Writer, 1 = Calc, 2 = Impress. */
let officeDocType: number | null = null
/** Part (slide/sheet) names of the active office doc, for Go ▸ Go to Slide/Sheet. */
let officeParts: string[] = []
/** Check marks and greyed items for the office menus, pushed by the renderer from the engine's STATE_CHANGED stream. */
let officeState: OfficeMenuState = { checked: {}, disabled: [] }
let officeStateTimer: ReturnType<typeof setTimeout> | null = null

let menuIsDev = false

/** Shows the folder picker, sets the root, and tells the renderer to reload. */
async function openWorkspaceFolder(): Promise<void> {
  const opts = { properties: ['openDirectory' as const] }
  const parent = mainWindow()
  const result = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts)
  const dir = result.filePaths[0]
  if (!dir) return
  setWorkspaceRoot(dir)
  sendToWindow('workspace:root-changed', dir)
  rebuildMenu()
}

function closeWorkspaceFolder(): void {
  clearWorkspaceRoot()
  sendToWindow('workspace:root-changed', null)
}

/** Opens a known directory (Open Recent / empty-state list) without a dialog. */
function openWorkspacePath(dir: string): boolean {
  try {
    if (!fs.statSync(dir).isDirectory()) return false
  } catch {
    return false
  }
  setWorkspaceRoot(dir)
  sendToWindow('workspace:root-changed', dir)
  rebuildMenu()
  return true
}

/** "~/Documents/Projects" instead of the full home path — menu-friendly labels. */
function shortenHome(dir: string): string {
  const home = os.homedir()
  return dir.startsWith(home + path.sep) ? '~' + dir.slice(home.length) : dir
}

function openRecentMenu(): MI {
  const recents = loadRecentWorkspaces()
  return {
    label: 'Open Recent',
    id: 'file-open-recent',
    submenu: [
      ...recents.map((dir): MI => ({
        label: shortenHome(dir),
        click: () => { openWorkspacePath(dir) },
      })),
      ...(recents.length > 0 ? [{ type: 'separator' as const }] : []),
      {
        label: 'Clear Recent',
        enabled: recents.length > 0,
        click: () => { clearRecentWorkspaces(); rebuildMenu() },
      },
    ],
  }
}

/** File ▸ Snapshots — save/restore named "whole desk" states (PRD MVP #10).
 *  Save + restore run in the renderer (it owns the UI state); delete is
 *  main-side. The submenu lists only the current workspace's snapshots. */
function snapshotsMenu(): MI {
  const send = (id: string): void => sendToWindow('menu:run-action', id)
  const root = getWorkspaceRoot()
  const snaps = root ? snapshots.list(root) : []
  return {
    label: 'Snapshots',
    id: 'file-snapshots',
    submenu: [
      { label: 'Save Snapshot…', enabled: root !== null, click: () => send('snapshot.save') },
      ...(snaps.length > 0 ? [{ type: 'separator' as const }] : []),
      ...snaps.map((s): MI => ({
        label: s.name,
        click: () => send(`snapshot.restore:${s.id}`),
      })),
      ...(snaps.length > 0
        ? [
            { type: 'separator' as const },
            {
              label: 'Delete Snapshot',
              submenu: snaps.map((s): MI => ({
                label: s.name,
                click: () => { snapshots.remove(s.id); rebuildMenu() },
              })),
            },
          ]
        : []),
    ],
  }
}

/** Panel toggles shared by the office and non-office View menus. ⌘B is only
 *  claimed when no office doc is active — office docs keep ⌘B for Bold. */
function viewPanelItems(officeActive: boolean): MI[] {
  const send = (id: string): void => sendToWindow('menu:run-action', id)
  return [
    {
      label: 'Toggle File Panel',
      id: 'view-toggle-files',
      ...(officeActive ? {} : { accelerator: 'CmdOrCtrl+B' }),
      click: () => send('view.toggle:files'),
    },
    {
      label: 'Toggle Terminal',
      id: 'view-toggle-terminal',
      accelerator: 'CmdOrCtrl+J',
      click: () => send('view.toggle:terminal'),
    },
    {
      label: 'Appearance',
      submenu: [
        { label: 'Light', click: () => send('view.appearance:light') },
        { label: 'Dark', click: () => send('view.appearance:dark') },
      ],
    },
    { type: 'separator' },
  ]
}

/** Go menu — navigation verbs. Go to Slide/Sheet appears with an office doc. */
function goMenu(): MI {
  const send = (id: string): void => sendToWindow('menu:run-action', id)
  const partNoun = officeDocType === 1 ? 'Sheet' : 'Slide'
  const partItems: MI[] = officeParts.map((name, i): MI => ({
    label: name || `${partNoun} ${i + 1}`,
    click: () => send(`office.gopart:${i}`),
  }))
  return {
    label: 'Go',
    submenu: [
      { label: 'Go to File…', id: 'go-quick-open', accelerator: 'CmdOrCtrl+P', click: () => send('go.quickopen') },
      { label: 'Search in Files…', id: 'go-search-panel', accelerator: 'Shift+CmdOrCtrl+F', click: () => send('go.searchpanel') },
      ...((officeDocType === 1 || officeDocType === 2) && partItems.length > 0
        ? [{ type: 'separator' as const }, { label: `Go to ${partNoun}`, submenu: partItems }]
        : []),
      { type: 'separator' },
      { label: 'Next Tab', accelerator: 'Shift+CmdOrCtrl+]', click: () => send('go.tab:next') },
      { label: 'Previous Tab', accelerator: 'Shift+CmdOrCtrl+[', click: () => send('go.tab:prev') },
      { type: 'separator' },
      { label: 'Back', accelerator: 'Ctrl+-', click: () => send('go.tab:back') },
      { label: 'Forward', accelerator: 'Ctrl+Shift+-', click: () => send('go.tab:forward') },
    ],
  }
}

function buildMenu(): void {
  const isDev = menuIsDev
  // File actions from the renderer registry become real menu items; clicking one
  // sends its id back to the renderer to run against the active file.
  const actionItems: MI[] = fileActionItems.map((a) => ({
    label: a.label,
    enabled: true,
    click: () => sendToWindow('menu:run-action', a.id),
  }))

  // When an office doc is active, Edit/Format/Insert/View drive the LOK engine.
  const office = officeDocType !== null
    ? officeMenus(officeDocType, isDev, viewPanelItems(true), officeState)
    : null

  // The browser gets History + View, built from the very actions its own panel
  // is showing. An office doc wins if somehow both are live: a document open in
  // the canvas is the more specific context.
  const browser = office === null && browserCtx ? browserMenus(browserCtx) : null

  const template: MI[] = [
    {
      label: 'Workspace OS',
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: () => checkForUpdatesManual() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: () => openWorkspaceFolder() },
        openRecentMenu(),
        { label: 'Close Folder', accelerator: 'CmdOrCtrl+Shift+W', click: () => closeWorkspaceFolder() },
        { type: 'separator' },
        snapshotsMenu(),
        { type: 'separator' },
        // Office document: Save / Export / Properties live here as in every office suite.
        ...(office
          ? [
              { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendToWindow('menu:run-action', 'office.save') },
              { label: 'Export', submenu: exportFormats(officeDocType).map((f): MI => ({ label: f.label, click: () => sendToWindow('menu:run-action', `office.export:${f.ext}`) })) },
              { label: 'Properties…', click: () => sendToWindow('menu:run-action', 'office.properties') },
              { type: 'separator' as const },
            ]
          : []),
        // Reuses the 'print' file-action (printable docs); no-ops otherwise.
        // ⌥⌘P — plain ⌘P belongs to Go to File (quick-open).
        { label: 'Print…', accelerator: 'Alt+CmdOrCtrl+P', click: () => sendToWindow('menu:run-action', 'print') },
        ...(actionItems.length > 0
          ? [{ type: 'separator' as const }, ...actionItems]
          : []),
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    // Edit: drives the LOK engine for office docs (canvas ignores OS roles);
    // standard roles otherwise (Monaco/text inputs).
    office
      ? office.edit
      : {
          label: 'Edit',
          submenu: [
            { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
            { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
            { type: 'separator' },
            { label: 'Find in Files…', accelerator: 'Shift+CmdOrCtrl+F', click: () => sendToWindow('menu:run-action', 'go.searchpanel') },
          ],
        },
    // Format + Insert, then Styles · Table/Sheet/Slide · Data/Slide Show · Tools — office docs only.
    ...(office ? [office.format, office.insert, ...office.extra] : []),
    office
      ? office.view
      : {
          label: 'View',
          submenu: [
            ...viewPanelItems(false),
            /**
             * While browsing, the unmodified keys belong to the PAGE.
             *
             * These roles bind Cmd+R / Cmd+= / Cmd+- / Cmd+0 by default, and the
             * Browser menu claims the same four for page reload and page zoom.
             * Two menu items sharing an accelerator is undefined behaviour in
             * Electron, and the way it resolved here was the dangerous way
             * round: Cmd+R could reload the whole window and take every open tab
             * with it, when the user plainly meant the page.
             *
             * So on the browser surface the window's own zoom and reload move
             * behind Option. Everywhere else they keep the standard keys.
             */
            ...(browser
              ? ([
                  { role: 'resetZoom', accelerator: 'Alt+CmdOrCtrl+0' },
                  { role: 'zoomIn', accelerator: 'Alt+CmdOrCtrl+Plus' },
                  { role: 'zoomOut', accelerator: 'Alt+CmdOrCtrl+-' },
                ] as MI[])
              : ([{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] as MI[])),
            { type: 'separator' },
            { role: 'togglefullscreen' },
            browser
              ? ({ role: 'reload', label: 'Reload Workspace OS', accelerator: 'Alt+CmdOrCtrl+R' } as MI)
              : ({ role: 'reload' } as MI),
            ...(isDev ? [{ role: 'toggleDevTools' as const }] : []),
          ],
        },
    // The surface's own menu, named after the surface. Mail and Files follow.
    ...(browser ? [browser.browser] : []),
    goMenu(),
    {
      label: 'Agent',
      submenu: [
        { label: 'Focus Agent', accelerator: 'CmdOrCtrl+Shift+A', click: () => sendToWindow('menu:run-action', 'agent.focus') },
        { label: 'New Agent…', click: () => sendToWindow('menu:run-action', 'agent.new') },
        { label: 'New Shell', click: () => sendToWindow('menu:run-action', 'shell.new') },
        { type: 'separator' },
        // Checkpoint timeline — every agent-run snapshot, with diff + restore.
        { label: 'Checkpoints…', click: () => sendToWindow('menu:run-action', 'agent.checkpoints') },
        { type: 'separator' },
        {
          label: 'Mode',
          submenu: [
            { label: 'Full (run any command)', type: 'radio', checked: agentMenu.mode === 'full', click: () => sendToWindow('menu:run-action', 'agent.mode:full') },
            { label: 'Safe (read + generate only)', type: 'radio', checked: agentMenu.mode === 'safe', click: () => sendToWindow('menu:run-action', 'agent.mode:safe') },
          ],
        },
        {
          label: 'Agents',
          submenu: [
            { label: 'Default', type: 'radio', checked: !agentMenu.activeAgent, click: () => sendToWindow('menu:run-action', 'agent.select:') },
            ...agentMenu.agents.map((a): MI => ({
              label: a.label, type: 'radio', checked: agentMenu.activeAgent === a.label,
              click: () => sendToWindow('menu:run-action', a.id),
            })),
          ],
        },
        ...(agentMenu.skills.length > 0
          ? [{
              label: 'Run Skill',
              submenu: agentMenu.skills.map((s): MI => ({
                label: s.label, click: () => sendToWindow('menu:run-action', s.id),
              })),
            } as MI]
          : []),
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

export function rebuildMenu(): void {
  buildMenu()
}

/** Builds the menu and registers the menu/workspace IPC surface. */
export function registerMenu(ipcMain: IpcMain, isDev: boolean): void {
  menuIsDev = isDev
  buildMenu()

  // Panel close-folder button uses this; menu items call the helpers directly.
  ipcHandle(ipcMain, 'workspace:close', () => closeWorkspaceFolder())

  // Recent workspace roots — File ▸ Open Recent and the empty-state list.
  ipcHandle(ipcMain, 'workspace:recents', () => pruneRecentWorkspaces())
  ipcHandle(ipcMain, 'workspace:open-recent', (_event, dir: unknown) => {
    if (typeof dir !== 'string') return false
    return openWorkspacePath(dir)
  })

  // The renderer pushes the active file's applicable actions; rebuild the menu
  // so the File menu reflects exactly what the action registry allows.
  ipcHandle(ipcMain, 'menu:set-actions', (_event, items: unknown) => {
    fileActionItems = Array.isArray(items)
      ? items.filter((i): i is MenuActionItem =>
          typeof i?.id === 'string' && typeof i?.label === 'string')
      : []
    buildMenu()
  })

  // The active agent session pushes its current agents/skills/mode so the
  // top-level Agent menu mirrors it.
  ipcHandle(ipcMain, 'menu:set-agent-menu', (_event, data: unknown) => {
    const d = data as Partial<AgentMenuData>
    const items = (v: unknown): MenuActionItem[] =>
      Array.isArray(v) ? v.filter((i): i is MenuActionItem => typeof i?.id === 'string' && typeof i?.label === 'string') : []
    agentMenu = {
      agents: items(d?.agents),
      skills: items(d?.skills),
      mode: d?.mode === 'safe' ? 'safe' : 'full',
      activeAgent: typeof d?.activeAgent === 'string' ? d.activeAgent : null,
    }
    buildMenu()
  })

  // The active office renderer pushes its doc type (0/1/2) or null — plus its
  // part (slide/sheet) names — so Edit/Format/Insert/View and Go become
  // document-aware. Skips the rebuild when nothing changed.
  /**
   * The browser surface pushes what it is offering, so the menu is the same data
   * the in-window panel is showing rather than a second list to keep in step.
   * Sending null (leaving the surface) removes the menus entirely — a History
   * menu that is present but does nothing is worse than no History menu.
   */
  ipcHandle(ipcMain, 'menu:set-browser-context', (_event, data: unknown) => {
    if (data === null || data === undefined) {
      if (browserCtx === null) return
      browserCtx = null
      buildMenu()
      return
    }
    const d = data as { actions?: unknown; canGoBack?: unknown; canGoForward?: unknown }
    const actions = Array.isArray(d.actions)
      ? d.actions
          .filter((a): a is { id: string; label: string; shortcut?: string; relevance: number } =>
            Boolean(a) && typeof a === 'object' &&
            typeof (a as { id?: unknown }).id === 'string' &&
            typeof (a as { label?: unknown }).label === 'string')
          .slice(0, 40)
          .map((a) => ({
            id: a.id.slice(0, 60),
            label: a.label.slice(0, 120),
            shortcut: typeof a.shortcut === 'string' ? a.shortcut.slice(0, 12) : undefined,
            relevance: typeof a.relevance === 'number' ? a.relevance : 0,
          }))
      : []
    const next: BrowserContext = {
      actions,
      canGoBack: d.canGoBack === true,
      canGoForward: d.canGoForward === true,
    }
    // Rebuilding the native menu on every page signal would flicker it, and the
    // signals fire on each navigation. Skip when nothing a user could see moved.
    if (browserCtx && JSON.stringify(browserCtx) === JSON.stringify(next)) return
    browserCtx = next
    buildMenu()
  })

  // The ⌘K palette lists the same commands the office menu bar shows.
  ipcHandle(ipcMain, 'menu:office-commands', () => (officeDocType === null ? [] : paletteCommands(officeDocType)))
  // A palette pick runs exactly like a menu click: every subscriber of
  // menu:run-action sees it (edit router, shell, the LOK canvas).
  ipcHandle(ipcMain, 'menu:run-action', (_event, id: unknown) => {
    if (typeof id !== 'string' || id.length > 400 || /[\r\n]/.test(id)) return
    sendToWindow('menu:run-action', id)
  })

  ipcHandle(ipcMain, 'menu:set-office-context', (_event, data: unknown) => {
    const d = data as { type?: unknown; parts?: unknown }
    const next = d?.type === 0 || d?.type === 1 || d?.type === 2 ? d.type : null
    const parts = Array.isArray(d?.parts)
      ? d.parts.filter((p): p is string => typeof p === 'string').slice(0, 100).map((p) => p.slice(0, 60))
      : []
    if (next === officeDocType && parts.join('\u0000') === officeParts.join('\u0000')) return
    officeDocType = next
    officeParts = next === null ? [] : parts
    if (next === null) officeState = { checked: {}, disabled: [] }
    buildMenu()
  })

  // Engine state for the office menus (checked toggles, greyed commands). The
  // renderer already sends only when the compact snapshot changed; coalesce here
  // too, because a cursor move can flip several states within a few ms and the
  // macOS menu bar should be rebuilt once for the lot.
  ipcHandle(ipcMain, 'menu:set-office-state', (_event, data: unknown) => {
    const d = data as { checked?: unknown; disabled?: unknown }
    const checked: Record<string, boolean> = {}
    if (d?.checked && typeof d.checked === 'object') {
      for (const [k, v] of Object.entries(d.checked as Record<string, unknown>).slice(0, 64)) {
        if (typeof v === 'boolean' && k.startsWith('.uno:') && k.length < 64) checked[k] = v
      }
    }
    const disabled = Array.isArray(d?.disabled)
      ? d.disabled.filter((c): c is string => typeof c === 'string' && c.startsWith('.uno:') && c.length < 64).slice(0, 64)
      : []
    const next = { checked, disabled }
    if (JSON.stringify(next) === JSON.stringify(officeState)) return
    officeState = next
    if (officeDocType === null) return
    if (officeStateTimer) clearTimeout(officeStateTimer)
    officeStateTimer = setTimeout(() => { officeStateTimer = null; buildMenu() }, 80)
  })
}

/** Export formats per office document type (mirrors the ribbon's Export menu). */
function exportFormats(type: number | null): { label: string; ext: string }[] {
  const W = [['PDF', 'pdf'], ['Word (.docx)', 'docx'], ['OpenDocument Text (.odt)', 'odt'], ['Rich Text (.rtf)', 'rtf'], ['Plain Text (.txt)', 'txt'], ['HTML', 'html'], ['EPUB', 'epub']]
  const C = [['PDF', 'pdf'], ['Excel (.xlsx)', 'xlsx'], ['OpenDocument Spreadsheet (.ods)', 'ods'], ['CSV', 'csv'], ['HTML', 'html']]
  const P = [['PDF', 'pdf'], ['PowerPoint (.pptx)', 'pptx'], ['OpenDocument Presentation (.odp)', 'odp'], ['PNG (current slide)', 'png'], ['HTML', 'html']]
  const list = type === 1 ? C : type === 2 ? P : W
  return list.map(([label, ext]) => ({ label, ext }))
}
