import { app, Notification, type IpcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { IPC } from '../ipc-channels'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError } from '../ipc-validator'
import { assertMainFrame } from '../security'
import { mainWindow, sendToWindow } from '../main-window'
import { DEFAULT_PREFS, Throttle, decide, parsePrefs, sanitizeEvent, type NotifyDecision, type NotifyEvent, type NotifyPrefs } from './model'

/**
 * Needs-you notifications on Electron's Notification (nothing used it before).
 *
 * Sources call `notify(event)`: background/routine runs and connectors from
 * main, approvals from the renderer over IPC. Prefs live in userData/
 * notify.json because main must decide with no window open. A click brings
 * the window up and asks the renderer to open the rail the thing lives on.
 *
 * `recent` is a small in-memory log — the probe's only way to see what was
 * shown, and a cheap debugging aid; it is never persisted.
 */

const PREFS_FILE = 'notify.json'
const RECENT_MAX = 50

let prefs: NotifyPrefs | null = null
const throttle = new Throttle()
const recent: { at: number; decision: NotifyDecision | 'unsupported'; event: NotifyEvent }[] = []

function prefsPath(): string {
  return path.join(app.getPath('userData'), PREFS_FILE)
}

export function getPrefs(): NotifyPrefs {
  if (!prefs) {
    try {
      prefs = parsePrefs(JSON.parse(fs.readFileSync(prefsPath(), 'utf-8')))
    } catch {
      prefs = { ...DEFAULT_PREFS }
    }
  }
  return prefs
}

export function setPrefs(next: unknown): NotifyPrefs {
  prefs = parsePrefs({ ...getPrefs(), ...(next && typeof next === 'object' ? (next as object) : {}) })
  try {
    fs.mkdirSync(path.dirname(prefsPath()), { recursive: true })
    fs.writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2), { encoding: 'utf-8', mode: 0o600 })
  } catch {
    /* best-effort */
  }
  return prefs
}

/** Show a needs-you notification, subject to prefs and the throttle. */
export function notify(event: NotifyEvent): NotifyDecision | 'unsupported' {
  const decision = decide(getPrefs(), throttle, event)
  let result: NotifyDecision | 'unsupported' = decision
  if (decision === 'show') {
    if (!Notification.isSupported()) result = 'unsupported'
    else {
      try {
        const n = new Notification({ title: event.title, body: event.body, silent: false })
        n.on('click', () => {
          const win = mainWindow()
          if (win) {
            if (win.isMinimized()) win.restore()
            win.show()
            win.focus()
          } else {
            app.emit('activate')
          }
          // The renderer opens the rail once it is up; a fresh window catches
          // up through the same channel after mount.
          setTimeout(() => sendToWindow(IPC.NOTIFY_OPEN, { rail: event.rail, key: event.key, source: event.source }), 300)
        })
        n.show()
      } catch {
        result = 'unsupported'
      }
    }
  }
  recent.unshift({ at: Date.now(), decision: result, event })
  if (recent.length > RECENT_MAX) recent.length = RECENT_MAX
  return result
}

export function registerNotifyHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, IPC.NOTIFY_PREFS, (event) => {
    assertMainFrame(event)
    return { ...getPrefs(), supported: Notification.isSupported() }
  })

  ipcHandle(ipcMain, IPC.NOTIFY_SET_PREFS, (event, next: unknown) => {
    assertMainFrame(event)
    return setPrefs(next)
  })

  /** The renderer's sources (approvals) and the Settings "send a test". */
  ipcHandle(ipcMain, IPC.NOTIFY_REQUEST, (event, input: unknown) => {
    assertMainFrame(event)
    const ev = sanitizeEvent(input)
    if (!ev) throw new IpcValidationError('Invalid notification')
    return { result: notify(ev) }
  })

  ipcHandle(ipcMain, IPC.NOTIFY_RECENT, (event) => {
    assertMainFrame(event)
    return recent.slice(0, 20)
  })
}
