import { IpcMain, BrowserWindow, dialog, app, shell } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError, validateFilePath } from '../ipc-validator'
import { getWorkspaceRoot } from '../workspace-root'
import { resolveSoffice, isLibreOfficeAvailable, convertTo } from '../office/libreoffice'

function cacheDir(): string {
  return path.join(app.getPath('userData'), 'office-cache')
}

// Global bound on the on-disk PDF render cache. Per-file pruning (below) drops
// stale mtimes of the SAME source, but a long session touching many files could
// still balloon the cache to GBs. These caps evict the oldest renders (by mtime)
// once EITHER is exceeded, so the cache stays a cache, not a leak.
export const CACHE_MAX_FILES = 200
export const CACHE_MAX_BYTES = 500 * 1024 * 1024

/**
 * Enforces the global cache cap: if the cache holds more than `maxFiles`
 * renders or more than `maxBytes` total, evict the oldest (least-recently
 * written) files until both bounds hold. Best-effort — a read/unlink race just
 * skips that entry. Never throws (viewing must not fail because pruning did).
 */
export async function pruneCache(
  dir: string,
  maxFiles = CACHE_MAX_FILES,
  maxBytes = CACHE_MAX_BYTES
): Promise<void> {
  try {
    const names = await fs.readdir(dir)
    const entries: { name: string; size: number; mtimeMs: number }[] = []
    for (const name of names) {
      if (!name.endsWith('.pdf')) continue
      try {
        const st = await fs.stat(path.join(dir, name))
        entries.push({ name, size: st.size, mtimeMs: st.mtimeMs })
      } catch {
        // vanished mid-scan — ignore
      }
    }
    let totalBytes = entries.reduce((sum, e) => sum + e.size, 0)
    if (entries.length <= maxFiles && totalBytes <= maxBytes) return
    // Oldest first — evict from the front until both caps are satisfied.
    entries.sort((a, b) => a.mtimeMs - b.mtimeMs)
    let count = entries.length
    for (const e of entries) {
      if (count <= maxFiles && totalBytes <= maxBytes) break
      await fs.rm(path.join(dir, e.name), { force: true }).catch(() => {})
      count--
      totalBytes -= e.size
    }
  } catch {
    // Unreadable cache dir — nothing to prune.
  }
}

// The cached global bound (module-level constants above) applies these defaults.

/**
 * Converts an office doc to PDF for viewing, cached by source mtime so reopening
 * is instant. Returns the cached PDF's bytes. Stale renders (older mtime) are
 * pruned per-file, and the whole cache is bounded globally (see pruneCache).
 */
async function toPdfCached(srcPath: string): Promise<Uint8Array> {
  const dir = cacheDir()
  await fs.mkdir(dir, { recursive: true })
  const stat = await fs.stat(srcPath)
  const key = crypto.createHash('sha1').update(srcPath).digest('hex')
  const cached = path.join(dir, `${key}-${Math.round(stat.mtimeMs)}.pdf`)

  try {
    return new Uint8Array(await fs.readFile(cached))
  } catch {
    // Not cached for this mtime — convert and store.
  }
  const produced = await convertTo(srcPath, 'pdf')
  const bytes = await fs.readFile(produced)
  await fs.copyFile(produced, cached).catch(() => {})
  await fs.rm(produced, { force: true }).catch(() => {})

  // Drop older renders of the same source.
  for (const f of await fs.readdir(dir).catch(() => [])) {
    if (f.startsWith(`${key}-`) && f !== path.basename(cached)) {
      await fs.rm(path.join(dir, f), { force: true }).catch(() => {})
    }
  }
  // Then enforce the global bound across ALL sources.
  await pruneCache(dir)
  return new Uint8Array(bytes)
}

/**
 * Docker-free office operations via LibreOffice (Phase 1–2). Export and view
 * supersede the OnlyOffice/Docker path when LibreOffice is installed.
 */
export function registerOfficeHandlers(ipcMain: IpcMain, win: BrowserWindow): void {
  ipcHandle(ipcMain, 'office:available', () => isLibreOfficeAvailable())

  ipcHandle(ipcMain, 'office:print', async (_event, filePath) => {
    const root = getWorkspaceRoot()
    if (!root) throw new IpcValidationError('No workspace folder is open')
    const resolved = validateFilePath(filePath, root)
    if (!resolveSoffice()) throw new Error('LIBREOFFICE_NOT_INSTALLED')
    const bytes = await toPdfCached(resolved)
    const dir = await fs.mkdtemp(path.join(app.getPath('temp'), 'wos-print-'))
    const target = path.join(dir, `${path.basename(resolved, path.extname(resolved))}.pdf`)
    await fs.writeFile(target, bytes)
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
  })

  ipcHandle(ipcMain, 'office:to-pdf', async (_event, filePath: unknown) => {
    const root = getWorkspaceRoot()
    if (!root) throw new IpcValidationError('No workspace folder is open')
    const resolved = validateFilePath(filePath, root)
    if (!resolveSoffice()) throw new Error('LIBREOFFICE_NOT_INSTALLED')
    return toPdfCached(resolved)
  })

  ipcHandle(ipcMain, 'office:export-pdf', async (_event, filePath: unknown) => {
    const root = getWorkspaceRoot()
    if (!root) throw new IpcValidationError('No workspace folder is open')
    const resolved = validateFilePath(filePath, root)

    if (!resolveSoffice()) {
      // The bundled engine should always be present; surface a clear error if not.
      throw new Error('LIBREOFFICE_NOT_INSTALLED')
    }

    const producedPdf = await convertTo(resolved, 'pdf')
    const base = path.basename(resolved, path.extname(resolved))
    const save = await dialog.showSaveDialog(win, {
      defaultPath: path.join(path.dirname(resolved), `${base}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (save.canceled || !save.filePath) {
      await fs.rm(producedPdf, { force: true })
      return null
    }
    await fs.copyFile(producedPdf, save.filePath)
    await fs.rm(producedPdf, { force: true })
    return save.filePath
  })
}
