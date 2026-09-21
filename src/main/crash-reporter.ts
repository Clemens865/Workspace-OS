import { app, crashReporter } from 'electron'
import fs from 'fs'
import path from 'path'
import { registerCleanup } from './ipc-registry'

/**
 * Local-first crash reporting + main-process logging (privacy-first, no upload).
 *
 * Two independent pieces, both writing only to userData:
 *  - Electron's native `crashReporter` captures renderer/GPU/utility minidumps
 *    to `app.getPath('crashDumps')` (under userData). `uploadToServer: false`
 *    guarantees nothing ever leaves the machine — the user can attach a dump to
 *    a bug report manually.
 *  - A tiny rotating file logger for the main process, plus catch-all handlers
 *    for `uncaughtException` / `unhandledRejection` so a JS-level crash leaves a
 *    breadcrumb on disk instead of vanishing with the process.
 */

const MAX_LOG_BYTES = 1_000_000 // rotate at ~1 MB — keep one previous file

function logDir(): string {
  return path.join(app.getPath('userData'), 'logs')
}

function logFilePath(): string {
  return path.join(logDir(), 'main.log')
}

let stream: fs.WriteStream | null = null

/** Lazily (re)opens the append stream, rotating the file once it gets large. */
function ensureStream(): fs.WriteStream | null {
  try {
    fs.mkdirSync(logDir(), { recursive: true })
    const file = logFilePath()
    try {
      if (fs.statSync(file).size > MAX_LOG_BYTES) {
        fs.renameSync(file, path.join(logDir(), 'main.1.log'))
        stream?.end()
        stream = null
      }
    } catch {
      /* no existing file — nothing to rotate */
    }
    if (!stream) stream = fs.createWriteStream(file, { flags: 'a' })
    return stream
  } catch {
    // Disk full / permission denied — logging must never take the app down.
    return null
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.stack || `${err.name}: ${err.message}`
  try {
    return typeof err === 'string' ? err : JSON.stringify(err)
  } catch {
    return String(err)
  }
}

/** Appends a timestamped line to the rotating log (and mirrors to the console). */
export function log(level: 'info' | 'warn' | 'error', msg: string, err?: unknown): void {
  const line = `${new Date().toISOString()} [${level}] ${msg}${err !== undefined ? ' — ' + formatError(err) : ''}\n`
  if (level === 'error') console.error(line.trimEnd())
  else if (level === 'warn') console.warn(line.trimEnd())
  else console.log(line.trimEnd())
  ensureStream()?.write(line)
}

/** Absolute path to the current log file — surfaced in Help/Settings later. */
export function logPath(): string {
  return logFilePath()
}

/**
 * Starts native minidump capture (local only) and installs JS crash handlers.
 * Safe to call once, early in app startup.
 */
export function initCrashReporter(): void {
  try {
    crashReporter.start({
      productName: 'Workspace OS',
      companyName: 'Workspace OS',
      // Privacy-first: never transmit. Minidumps stay under userData for the
      // user to attach to a report by choice.
      uploadToServer: false,
      compress: true,
    })
  } catch (err) {
    // Non-fatal: continue with JS-level logging even if native capture fails.
    log('warn', '[crash] crashReporter.start failed', err)
  }

  process.on('uncaughtException', (err) => {
    log('error', '[crash] uncaughtException', err)
  })
  process.on('unhandledRejection', (reason) => {
    log('error', '[crash] unhandledRejection', reason)
  })

  registerCleanup('crash-logger', () => {
    stream?.end()
    stream = null
  })

  log('info', `[crash] reporting active — dumps: ${app.getPath('crashDumps')}, log: ${logFilePath()}`)
}
