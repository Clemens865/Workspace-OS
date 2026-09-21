import { app, type IpcMain } from 'electron'
import path from 'path'
import { IPC } from '../ipc-channels'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError } from '../ipc-validator'
import { assertMainFrame } from '../security'
import { sendToWindow } from '../main-window'
import { RoutineStore, RoutineValidationError, type Routine, type RoutineInput } from '../routines/store'
import { Scheduler } from '../routines/scheduler'
import { parseSchedule, describeSchedule } from '../routines/schedule'
import { enqueueBackgroundRun, listBackgroundRuns } from './runs'

/**
 * Routines: the store, the app-owned scheduler, and their IPC. Every run a
 * routine starts is a background job (M2) carrying the routine's id, label
 * and exactly its capabilities — safe mode, idle timeout, grant enforced at
 * the bridge.
 */

let store: RoutineStore | null = null
let scheduler: Scheduler | null = null

function getStore(): RoutineStore {
  if (!store) store = new RoutineStore(path.join(app.getPath('userData'), 'routines.json'))
  return store
}

function broadcast(): void {
  sendToWindow(IPC.ROUTINES_UPDATED, getStore().list())
}

function isBusy(routineId: string): boolean {
  return listBackgroundRuns().some((j) => j.routineId === routineId && (j.status === 'queued' || j.status === 'running'))
}

function getScheduler(): Scheduler {
  if (!scheduler) {
    scheduler = new Scheduler({
      store: getStore(),
      isBusy,
      onChange: broadcast,
      enqueue: (r: Routine) =>
        enqueueBackgroundRun({
          prompt: r.prompt,
          label: r.name,
          agentName: r.agentName,
          origin: 'routine',
          routineId: r.id,
          capabilities: r.capabilities,
        }).id,
    })
  }
  return scheduler
}

/** App ready: compute, catch up once, arm. */
export function startRoutines(): void {
  getScheduler().start()
}

export function stopRoutines(): void {
  scheduler?.stop()
}

const ID_RE = /^rt-[a-z0-9-]{3,40}$/

function assertId(id: unknown): string {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new IpcValidationError('Invalid routine id')
  return id
}

export function registerRoutinesHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, IPC.ROUTINES_LIST, (event) => {
    assertMainFrame(event)
    return getStore().list()
  })

  ipcHandle(ipcMain, IPC.ROUTINES_SAVE, (event, input: unknown) => {
    assertMainFrame(event)
    const i = (input ?? {}) as Record<string, unknown>
    const payload: RoutineInput = {
      id: i.id === undefined ? undefined : assertId(i.id),
      name: String(i.name ?? ''),
      prompt: String(i.prompt ?? ''),
      schedule: String(i.schedule ?? ''),
      agentName: typeof i.agentName === 'string' ? i.agentName : null,
      enabled: typeof i.enabled === 'boolean' ? i.enabled : undefined,
      capabilities: Array.isArray(i.capabilities) ? i.capabilities.filter((c): c is string => typeof c === 'string') : [],
    }
    let saved: Routine
    try {
      saved = getStore().upsert(payload)
    } catch (err) {
      if (err instanceof RoutineValidationError) throw new IpcValidationError(err.message)
      throw err
    }
    getScheduler().refresh()
    broadcast()
    return saved
  })

  ipcHandle(ipcMain, IPC.ROUTINES_DELETE, (event, id: unknown) => {
    assertMainFrame(event)
    const ok = getStore().delete(assertId(id))
    getScheduler().refresh()
    broadcast()
    return { ok }
  })

  ipcHandle(ipcMain, IPC.ROUTINES_RUN_NOW, (event, id: unknown) => {
    assertMainFrame(event)
    const jobId = getScheduler().runNow(assertId(id))
    broadcast()
    return jobId ? { ok: true as const, jobId } : { ok: false as const, error: 'That routine is already running.' }
  })

  /** "every weekday at 07:00" for the editor, or why the string is rejected. */
  ipcHandle(ipcMain, IPC.ROUTINES_DESCRIBE, (event, schedule: unknown) => {
    assertMainFrame(event)
    const s = parseSchedule(schedule)
    return s ? { ok: true as const, text: describeSchedule(s) } : { ok: false as const, error: 'Use daily@HH:MM, weekdays@HH:MM, weekly@mon HH:MM or every:6h.' }
  })
}
