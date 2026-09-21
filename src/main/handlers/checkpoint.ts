import { IpcMain } from 'electron'
import { ipcHandle } from '../ipc-registry'
import { checkpoints } from '../checkpoint'
import { IpcValidationError } from '../ipc-validator'

function assertSha(id: unknown): string {
  if (typeof id !== 'string' || !/^[a-f0-9]{7,40}$/.test(id)) {
    throw new IpcValidationError('Invalid checkpoint id')
  }
  return id
}

export function registerCheckpointHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, 'checkpoint:list', () => checkpoints.list())
  ipcHandle(ipcMain, 'checkpoint:rollback', (_event, id: unknown) => checkpoints.rollbackTo(assertSha(id)))
  ipcHandle(ipcMain, 'checkpoint:diff', (_event, id: unknown) => checkpoints.diffSince(assertSha(id)))
}
