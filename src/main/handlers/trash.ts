import { IpcMain } from 'electron'
import { ipcHandle } from '../ipc-registry'
import { trash } from '../trash'
import { IpcValidationError } from '../ipc-validator'

function assertId(id: unknown): string {
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) {
    throw new IpcValidationError('Invalid trash entry id')
  }
  return id
}

export function registerTrashHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, 'trash:list', () => trash.list())
  ipcHandle(ipcMain, 'trash:restore', (_event, id: unknown) => trash.restore(assertId(id)))
  ipcHandle(ipcMain, 'trash:delete', (_event, id: unknown) => trash.deleteEntry(assertId(id)))
  ipcHandle(ipcMain, 'trash:empty', () => trash.empty())
}
