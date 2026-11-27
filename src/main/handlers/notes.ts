import type { IpcMain } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { IPC } from '../ipc-channels'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError, validateFilePath } from '../ipc-validator'
import { getWorkspaceRoot } from '../workspace-root'
import { contentRoot } from '../host-profile'
import { indexNow, resolveNote } from './search'

/** Folder, under the content root, that holds the daily notes. */
const DAILY_DIR = 'Daily'

const MAX_NAME = 200

export interface NoteOpened {
  path: string
  /** False when the note was already there and has been left as it was. */
  created: boolean
}

function requireRoot(): string {
  const root = getWorkspaceRoot()
  if (!root) throw new IpcValidationError('No workspace is open')
  return root
}

/** Today in local time, as YYYY-MM-DD. */
function today(now = new Date()): string {
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
}

/**
 * A link target that may become a file name on any platform. A `[[target]]`
 * resolves by file name alone, so a path in it is refused rather than followed.
 */
function validateNoteName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new IpcValidationError('name must be a non-empty string')
  if (/[\x00-\x1f]/.test(value)) throw new IpcValidationError('A note name cannot contain a control character')
  const name = value.trim()
  if (name.length > MAX_NAME) throw new IpcValidationError(`A note name is limited to ${MAX_NAME} characters`)
  if (/[/\\<>:"|?*[\]#]/.test(name)) throw new IpcValidationError('A note name cannot contain / \\ < > : " | ? * [ ] or #')
  if (name.startsWith('.') || name.endsWith('.')) throw new IpcValidationError('A note name cannot start or end with a dot')
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)) throw new IpcValidationError(`"${name}" is a reserved file name`)
  return name
}

/** Writes a new note; one that already exists is returned untouched. */
async function createIfAbsent(root: string, target: string, title: string): Promise<NoteOpened> {
  const file = validateFilePath(target, root) // resolves symlinked folders too
  await fs.mkdir(path.dirname(file), { recursive: true })
  let created = true
  try {
    // 'wx' fails on anything already at the path, a symlink included.
    await fs.writeFile(file, `# ${title}\n\n`, { encoding: 'utf-8', flag: 'wx' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    created = false
  }
  // Searchable, linkable and resolved before the caller hears it is there.
  await indexNow([file])
  return { path: file, created }
}

export function registerNotesHandlers(ipcMain: IpcMain): void {
  // Today's note. The renderer passes nothing: the date and the place are ours.
  ipcHandle(ipcMain, IPC.NOTES_DAILY, () => {
    const root = requireRoot()
    const date = today()
    return createIfAbsent(root, path.join(contentRoot(root), DAILY_DIR, `${date}.md`), date)
  })

  // The note an unresolved [[link]] names: beside the linking note when one is
  // given, else at the top of the content folder.
  ipcHandle(ipcMain, IPC.NOTES_CREATE_FROM_LINK, async (_event, rawName: unknown, fromPath: unknown) => {
    const root = requireRoot()
    const name = validateNoteName(rawName)
    const from = fromPath === undefined || fromPath === null ? null : validateFilePath(fromPath, root)
    const folder = from ? path.dirname(from) : contentRoot(root)
    // The index may have gained the note since the panel listed it as missing.
    const existing = resolveNote(name, from ?? path.join(folder, 'x'))
    if (existing) {
      const there = await fs.access(validateFilePath(existing, root)).then(() => true, () => false)
      if (there) return { path: existing, created: false }
    }
    return createIfAbsent(root, path.join(folder, `${name}.md`), name)
  })
}
