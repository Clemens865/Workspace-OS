import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { recordRecentWorkspace } from './recent-workspaces'

/**
 * Single source of truth for the active workspace root.
 *
 * The renderer never decides what the main process is allowed to touch — it can
 * only *request* a root via the folder dialog, which the main process records
 * here. Every file-system validator scopes to this value, so the security
 * boundary is the user-selected workspace, not the whole home directory.
 */

let currentRoot: string | null = null

const ROOT_STATE_FILE = (): string =>
  path.join(app.getPath('userData'), 'workspace-root.json')

/** Restores the last-used root on launch so reopening lands in the same place. */
export function loadPersistedRoot(): void {
  try {
    const raw = fs.readFileSync(ROOT_STATE_FILE(), 'utf-8')
    const { root } = JSON.parse(raw) as { root?: string }
    if (root && fs.existsSync(root)) currentRoot = path.resolve(root)
  } catch {
    // No persisted root yet — stays null until the user opens a folder.
  }
}

export function getWorkspaceRoot(): string | null {
  return currentRoot
}

export function setWorkspaceRoot(dir: string): string {
  const resolved = path.resolve(dir)
  const stat = fs.statSync(resolved)
  if (!stat.isDirectory()) throw new Error('Workspace root must be a directory')
  currentRoot = resolved
  recordRecentWorkspace(resolved)
  try {
    fs.writeFileSync(ROOT_STATE_FILE(), JSON.stringify({ root: resolved }), 'utf-8')
  } catch {
    // Persistence is best-effort; an unwritable userData dir shouldn't block usage.
  }
  return resolved
}

export function clearWorkspaceRoot(): void {
  currentRoot = null
  try {
    fs.rmSync(ROOT_STATE_FILE(), { force: true })
  } catch {
    // Nothing persisted — fine.
  }
}
