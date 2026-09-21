import fs from 'fs/promises'
import { createReadStream, createWriteStream } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { pipeline } from 'stream/promises'
import { getWorkspaceRoot } from './workspace-root'

/**
 * Recovery layer for every destructive file operation.
 *
 * Before anything is deleted or overwritten — by the user OR the agent — the
 * prior version is moved/copied into `.workspace-os/trash` and recorded in a
 * manifest. Nothing the agent does is unrecoverable, which is a hard
 * requirement for the non-technical persona who has no `git reflog` to fall
 * back on.
 *
 * The workspace root is injected via a provider so the store can be tested
 * against a temp directory without pulling in Electron.
 */

export type TrashOp = 'delete' | 'overwrite'

export interface TrashEntry {
  id: string
  originalPath: string
  originalName: string
  op: TrashOp
  isDirectory: boolean
  trashedAt: number
  /** Path of the snapshot inside the trash store. */
  storedPath: string
}

const TRASH_DIRNAME = path.join('.workspace-os', 'trash')
const MANIFEST_NAME = 'manifest.json'

export type RootProvider = () => string | null

export class TrashStore {
  constructor(private getRoot: RootProvider) {}

  private trashRoot(): string {
    const root = this.getRoot()
    if (!root) throw new Error('No workspace folder is open')
    return path.join(root, TRASH_DIRNAME)
  }

  private manifestPath(): string {
    return path.join(this.trashRoot(), MANIFEST_NAME)
  }

  private async ensureTrashDir(): Promise<void> {
    await fs.mkdir(this.trashRoot(), { recursive: true })
  }

  private async readManifest(): Promise<TrashEntry[]> {
    try {
      const raw = await fs.readFile(this.manifestPath(), 'utf-8')
      return JSON.parse(raw) as TrashEntry[]
    } catch {
      return []
    }
  }

  private async writeManifest(entries: TrashEntry[]): Promise<void> {
    await this.ensureTrashDir()
    await fs.writeFile(this.manifestPath(), JSON.stringify(entries, null, 2), 'utf-8')
  }

  /**
   * Snapshots a path into trash before it is removed. For deletes
   * (`removeOriginal` true) the original is moved straight into trash; for
   * overwrites it is left in place and a copy is taken.
   */
  async moveToTrash(
    targetPath: string,
    op: TrashOp,
    isDirectory: boolean,
    removeOriginal: boolean
  ): Promise<TrashEntry> {
    await this.ensureTrashDir()
    const id = crypto.randomBytes(12).toString('hex')
    const storedPath = path.join(this.trashRoot(), `${id}__${path.basename(targetPath)}`)

    if (removeOriginal) {
      await moveInto(targetPath, storedPath, isDirectory)
    } else if (isDirectory) {
      await fs.cp(targetPath, storedPath, { recursive: true })
    } else {
      await pipeline(createReadStream(targetPath), createWriteStream(storedPath))
    }

    const entry: TrashEntry = {
      id,
      originalPath: targetPath,
      originalName: path.basename(targetPath),
      op,
      isDirectory,
      trashedAt: Date.now(),
      storedPath,
    }

    const manifest = await this.readManifest()
    manifest.unshift(entry)
    await this.writeManifest(manifest)
    return entry
  }

  async list(): Promise<TrashEntry[]> {
    return this.readManifest()
  }

  /** Restores a trashed entry, snapshotting any current occupant first. */
  async restore(id: string): Promise<void> {
    const entry = (await this.readManifest()).find((e) => e.id === id)
    if (!entry) throw new Error('Trash entry not found')

    // If something now occupies the original path, trash it before restoring
    // so the restore is itself non-destructive. This appends to the manifest.
    if (await pathExists(entry.originalPath)) {
      const stat = await fs.stat(entry.originalPath)
      await this.moveToTrash(entry.originalPath, 'overwrite', stat.isDirectory(), true)
    }

    await fs.mkdir(path.dirname(entry.originalPath), { recursive: true })
    await moveInto(entry.storedPath, entry.originalPath, entry.isDirectory)

    // Re-read: the occupant snapshot above may have mutated the manifest, so we
    // must drop this entry from the *current* manifest, not a stale copy.
    const current = await this.readManifest()
    await this.writeManifest(current.filter((e) => e.id !== id))
  }

  async deleteEntry(id: string): Promise<void> {
    const manifest = await this.readManifest()
    const entry = manifest.find((e) => e.id === id)
    if (!entry) return
    await fs.rm(entry.storedPath, { recursive: true, force: true })
    await this.writeManifest(manifest.filter((e) => e.id !== id))
  }

  async empty(): Promise<void> {
    const manifest = await this.readManifest()
    await Promise.all(
      manifest.map((e) => fs.rm(e.storedPath, { recursive: true, force: true }).catch(() => {}))
    )
    await this.writeManifest([])
  }
}

/** Moves a path into trash if it can; falls back to copy+remove across devices. */
async function moveInto(source: string, dest: string, isDirectory: boolean): Promise<void> {
  try {
    await fs.rename(source, dest)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    if (isDirectory) {
      await fs.cp(source, dest, { recursive: true })
      await fs.rm(source, { recursive: true, force: true })
    } else {
      await pipeline(createReadStream(source), createWriteStream(dest))
      await fs.rm(source)
    }
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** Default store used by the app, scoped to the live workspace root. */
export const trash = new TrashStore(getWorkspaceRoot)
