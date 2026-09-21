import { IpcMain } from 'electron'
import { ipcHandle } from '../ipc-registry'
import { snapshots } from '../snapshots'
import { getWorkspaceRoot } from '../workspace-root'
import { IpcValidationError } from '../ipc-validator'
import { rebuildMenu } from '../menu'

/**
 * Workspace snapshots IPC. Save/restore travel renderer ↔ main: the renderer
 * owns the UI state being captured/applied; main owns persistence and the
 * File ▸ Snapshots menu (rebuilt whenever the list changes).
 */
export function registerSnapshotHandlers(ipcMain: IpcMain): void {
  // Scoped to the current workspace — a snapshot only makes sense in its root.
  ipcHandle(ipcMain, 'snapshot:list', () => snapshots.list(getWorkspaceRoot()))

  ipcHandle(ipcMain, 'snapshot:save', (_event, name: unknown, state: unknown) => {
    if (typeof name !== 'string' || !name.trim()) {
      throw new IpcValidationError('Snapshot name must be a non-empty string')
    }
    const root = getWorkspaceRoot()
    if (!root) throw new IpcValidationError('No workspace folder is open')
    const snap = snapshots.create(root, name, state)
    rebuildMenu()
    return snap
  })

  ipcHandle(ipcMain, 'snapshot:delete', (_event, id: unknown) => {
    if (typeof id !== 'string' || !/^snap-[\w-]+$/.test(id)) {
      throw new IpcValidationError('Invalid snapshot id')
    }
    snapshots.remove(id)
    rebuildMenu()
  })
}
