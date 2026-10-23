import { appStateDir } from '../host-profile'
import { IpcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError } from '../ipc-validator'
import { getWorkspaceRoot } from '../workspace-root'

/**
 * Chat's two needs from the main process:
 *
 * UPLOADS. A file dropped from Finder or pasted arrives as its BYTES, read by
 * the window from the drop itself, never as a path: a path from the renderer
 * would let it copy any file on the disk into the workspace. The bytes land in
 * `.workspace-os/uploads/<day>/`, inside the workspace, where a run can read
 * them (images included) and nothing clutters the person's folders.
 *
 * SESSIONS. Conversations are saved as one file per workspace,
 * `.workspace-os/sessions.json`, instead of the window's localStorage, which is
 * small and shared by every workspace: a chat keeps hundreds of messages.
 */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const MAX_SESSIONS_BYTES = 40 * 1024 * 1024

const appDir = (root: string): string => appStateDir(root)

/** A file name that stays a file name: no folders, no hidden files, nothing a file system refuses. */
export function safeUploadName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? ''
  const clean = base
    .replace(/[\u0000-\u001f\u007f:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .slice(0, 120)
    .trim()
  return clean || 'upload'
}

/** `name`, or `name (2).ext`… if taken. */
function freePath(dir: string, name: string): string {
  const ext = path.extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let p = path.join(dir, name)
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${stem} (${i})${ext}`)
  return p
}

export function writeUpload(root: string, name: string, bytes: Uint8Array, now = new Date()): string {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new IpcValidationError(`That file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`)
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const dir = path.join(appDir(root), 'uploads', day)
  fs.mkdirSync(dir, { recursive: true })
  const file = freePath(dir, safeUploadName(name))
  fs.writeFileSync(file, bytes)
  return file
}

export function registerChatHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, 'chat:upload', (_e, name: unknown, data: unknown) => {
    const root = getWorkspaceRoot()
    if (!root) throw new IpcValidationError('Open a workspace folder first')
    if (typeof name !== 'string' || !name.trim()) throw new IpcValidationError('Which file?')
    if (!(data instanceof Uint8Array)) throw new IpcValidationError('No file data')
    const file = writeUpload(root, name, data)
    return { path: file, name: path.basename(file), size: data.byteLength }
  })

  // Saved only into a workspace the app opened in this run (the one just left
  // still gets its last words), and always into the one named, never the open one by default.
  const opened = new Set<string>()
  ipcHandle(ipcMain, 'sessions:load', () => {
    const root = getWorkspaceRoot()
    if (!root) return null
    opened.add(root)
    try {
      return { root, json: fs.readFileSync(path.join(appDir(root), 'sessions.json'), 'utf8') }
    } catch {
      return { root, json: null }
    }
  })
  ipcHandle(ipcMain, 'sessions:save', (_e, forRoot: unknown, json: unknown) => {
    if (typeof forRoot !== 'string' || !opened.has(forRoot)) return { ok: false }
    const root = forRoot
    if (typeof json !== 'string' || json.length > MAX_SESSIONS_BYTES) throw new IpcValidationError('Sessions too large to save')
    const file = path.join(appDir(root), 'sessions.json')
    fs.mkdirSync(appDir(root), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, json)
    fs.renameSync(tmp, file)
    return { ok: true }
  })
}
