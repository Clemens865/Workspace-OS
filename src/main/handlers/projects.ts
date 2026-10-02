import type { IpcMain } from 'electron'
import { ipcHandle } from '../ipc-registry'
import { getWorkspaceRoot } from '../workspace-root'
import { createProject, isHomeOf, listProjects } from '../projects'

/**
 * Sub-projects over IPC. The renderer names a "home" (the folder the project
 * list is taken from); it must be the open workspace or one of its ancestors,
 * so nothing outside what the person already opened is listed or written.
 */
function checkedHome(home: unknown): string {
  const root = getWorkspaceRoot()
  if (!root) throw new Error('Open a workspace first.')
  const h = typeof home === 'string' && home ? home : root
  if (!isHomeOf(h, root)) throw new Error('That folder is not the workspace or one of its parents.')
  return h
}

export function registerProjectHandlers(ipcMain: IpcMain): void {
  // Env-gated test hook, like WORKSPACE_TEST_ROOT: WOS_START_ON=stage opens the
  // app on the flat stage instead of the landscape (the e2e suite drives the
  // stage's surfaces). Inert unless the variable is set.
  ipcHandle(ipcMain, 'app:start-on', () => (process.env['WOS_START_ON'] === 'stage' ? 'stage' : null))
  ipcHandle(ipcMain, 'projects:list', (_e, home: unknown) => listProjects(checkedHome(home)))
  ipcHandle(ipcMain, 'projects:create', (_e, home: unknown, name: unknown, color: unknown) => {
    if (typeof name !== 'string') throw new Error('Give the project a name.')
    return createProject(checkedHome(home), name, typeof color === 'string' ? color : undefined)
  })
}
