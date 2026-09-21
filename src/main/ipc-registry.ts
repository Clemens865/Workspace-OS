import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { IpcValidationError } from './ipc-validator'

/**
 * Typed IPC handler registry + unified shutdown lifecycle.
 *
 * Every ipcMain.handle call site goes through `ipcHandle` so duplicate channel
 * registrations fail loudly at startup and unexpected handler errors are logged
 * with their channel name. Long-lived resources (PTYs, child processes, DBs)
 * register a shutdown callback via `registerCleanup`; the app's single quit
 * path drains them with `runAllCleanups`.
 */

type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown> | unknown

const channels = new Set<string>()
// Explicitly reviewed event-independent data handlers, also callable by the
// grant-checked document.data bridge. No delete, mail, shell, or arbitrary IPC.
export const WORKSPACE_DATA_OPERATIONS = [
  'metric:list', 'metric:create', 'metric:update', 'metric:createFromSource', 'metric:refreshFromSource',
  'transclusion:forMetric', 'transclusion:add', 'transclusion:syncAll',
  'range:list', 'range:createFromSource', 'range:update', 'range:refreshFromSource',
  'rangeLink:forRange', 'rangeLink:add', 'rangeLink:syncAll',
  'collection:list', 'collection:createFromSource', 'collection:update', 'collection:refresh',
  'collectionLink:forCollection', 'collectionLink:add', 'collectionLink:syncAll',
] as const
const dataHandlers = new Map<string, IpcHandler>()
export async function invokeWorkspaceData(channel: string, args: unknown[]): Promise<unknown> {
  const handler = dataHandlers.get(channel)
  if (!handler) throw new IpcValidationError('Unsupported workspace data operation')
  // These handlers do not read event or sender. Their domain validation remains intact.
  return handler(undefined as unknown as IpcMainInvokeEvent, ...args)
}

/** Thin wrapper over ipcMain.handle: duplicate detection + error logging. */
export function ipcHandle(ipcMain: IpcMain, channel: string, handler: IpcHandler): void {
  if (channels.has(channel)) {
    throw new Error(`IPC channel registered twice: "${channel}"`)
  }
  channels.add(channel)
  if ((WORKSPACE_DATA_OPERATIONS as readonly string[]).includes(channel)) dataHandlers.set(channel, handler)
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...args)
    } catch (err) {
      // Validation errors are expected control flow — propagate untouched.
      if (err instanceof IpcValidationError) throw err
      console.error(`[ipc] handler for "${channel}" failed:`, err)
      throw err
    }
  })
}

/** Sorted list of every channel registered so far (useful for tests). */
export function registeredChannels(): string[] {
  return [...channels].sort()
}

interface Cleanup {
  name: string
  fn: () => void | Promise<void>
}

const cleanups: Cleanup[] = []

/** Records a shutdown callback to run (once) via runAllCleanups. */
export function registerCleanup(name: string, fn: () => void | Promise<void>): void {
  cleanups.push({ name, fn })
}

const CLEANUP_TIMEOUT_MS = 5000

/**
 * Runs every registered cleanup — each in its own try/catch with a 5s timeout,
 * logging failures. Never throws, and drains the list so cleanups run once.
 */
export async function runAllCleanups(): Promise<void> {
  const pending = cleanups.splice(0)
  for (const { name, fn } of pending) {
    try {
      await Promise.race([
        Promise.resolve().then(fn),
        new Promise<never>((_, reject) => {
          const t = setTimeout(
            () => reject(new Error(`timed out after ${CLEANUP_TIMEOUT_MS}ms`)),
            CLEANUP_TIMEOUT_MS
          )
          // Don't hold the process open for a timer that lost the race.
          t.unref?.()
        }),
      ])
    } catch (err) {
      console.error(`[shutdown] cleanup "${name}" failed:`, err)
    }
  }
}
