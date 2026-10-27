import { IpcMain, BrowserWindow, dialog, shell } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { IPC } from '../ipc-channels'
import { ipcHandle } from '../ipc-registry'
import { getWorkspaceRoot, setWorkspaceRoot } from '../workspace-root'
import { appStateDir, contentRoot, contentRootRel } from '../host-profile'
import { IpcValidationError, validateFilePath } from '../ipc-validator'
import { sendToWindow, setMainWindow } from '../main-window'
import { rebuildMenu } from '../menu'
import { watchTree, type TreeWatcher } from '../fs/treeWatcher'

let watcher: TreeWatcher | null = null

export function registerWatcherHandlers(ipcMain: IpcMain, win: BrowserWindow): void {
  setMainWindow(win)
  ipcHandle(ipcMain, IPC.FS_WATCH_START, async () => {
    const root = getWorkspaceRoot()
    if (!root) throw new IpcValidationError('No workspace folder is open')

    watcher?.close()
    // One recursive handle for the tree (fs/treeWatcher.ts) — dot-dirs and
    // dependency/build trees are filtered there. The previous per-entry watcher
    // cost a descriptor per file and, on a large folder, left none for readdir.
    try {
      watcher = watchTree(root, {
        depth: 3,
        onEvent: (event, filePath) => sendToWindow(IPC.FS_WATCH_EVENT, { event, path: filePath }),
      })
    } catch (err) {
      // No live updates on this platform; the tree still refreshes on demand.
      console.warn(`[fs:watch] live updates unavailable: ${(err as Error).message}`)
      watcher = null
    }
  })

  ipcHandle(ipcMain, IPC.FS_WATCH_STOP, () => {
    watcher?.close()
    watcher = null
  })

  // Native folder picker — selecting a folder makes it the authoritative
  // workspace root that every file-system validator scopes to.
  ipcHandle(ipcMain, 'fs:open-folder-dialog', async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    const dir = result.filePaths[0]
    if (!dir) return null
    const root = setWorkspaceRoot(dir)
    // The picker only returned the root to its caller, so every OTHER listener
    // (Home desk, cockpit, file tree, terminal context) kept the old workspace
    // — the switcher's "Open folder…" looked like it did nothing. Broadcast the
    // change exactly like File ▸ Open Folder does.
    sendToWindow('workspace:root-changed', root)
    rebuildMenu()
    return root
  })

  // Returns the persisted root (if any) so the renderer can restore its tree on launch.
  ipcHandle(ipcMain, 'workspace:get-root', () => getWorkspaceRoot())

  // Where the app's content folders (Cases/, Work/, Wiki/, Apps/) live for the
  // open workspace: absolute path and workspace-relative prefix ("" = the root).
  ipcHandle(ipcMain, 'workspace:content-root', () => {
    const root = getWorkspaceRoot()
    return root ? { path: contentRoot(root), rel: contentRootRel(root) } : null
  })

  // Writes a note for agents (e.g. the captured browser page) into this
  // workspace's store, wherever host-profile.ts puts it. Returns the absolute
  // path and how to refer to it from the workspace (relative when inside it).
  ipcHandle(ipcMain, 'workspace:write-agent-note', async (_e, name: unknown, body: unknown) => {
    const root = getWorkspaceRoot()
    if (!root) throw new Error('No workspace folder is open')
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,60}\.md$/.test(name)) throw new Error('Invalid note name')
    if (typeof body !== 'string' || body.length > 2 * 1024 * 1024) throw new Error('Invalid note body')
    const dir = appStateDir(root)
    await fs.mkdir(dir, { recursive: true })
    const file = path.join(dir, name)
    await fs.writeFile(file, body, 'utf-8')
    const rel = path.relative(root, file)
    return { path: file, ref: rel.startsWith('..') ? file : rel }
  })

  // Reveal in Finder/Explorer
  ipcHandle(ipcMain, 'fs:reveal', (_event, filePath: unknown) => {
    if (typeof filePath === 'string') shell.showItemInFolder(filePath)
  })

  // Save-a-copy: pick a destination, copy the source file there.
  ipcHandle(ipcMain, 'fs:save-copy-dialog', async (_event, srcPath: unknown) => {
    const root = getWorkspaceRoot()
    if (!root) throw new IpcValidationError('No workspace folder is open')
    const src = validateFilePath(srcPath, root)
    const base = path.basename(src)
    const dot = base.lastIndexOf('.')
    const suggested = dot > 0 ? `${base.slice(0, dot)} copy${base.slice(dot)}` : `${base} copy`

    const result = await dialog.showSaveDialog(win, {
      defaultPath: path.join(path.dirname(src), suggested),
    })
    if (result.canceled || !result.filePath) return null
    await fs.copyFile(src, result.filePath)
    return result.filePath
  })
}
