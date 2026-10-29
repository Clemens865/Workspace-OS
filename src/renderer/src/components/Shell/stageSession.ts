import { isInside } from '../../lib/paths'
import { scopeKey, scopedKey, type StringStorage } from '../../lib/workspaceScope'

/**
 * STAGE SESSION — the documents a workspace had open, reopened on launch.
 *
 * The retired layout restored its tabs; the stage did not, so every restart
 * began empty. Per workspace, the shell records the stage's document tabs (in
 * order), the active one, and the file in the Files preview. Restore drops
 * anything outside the workspace and anything that no longer exists.
 */

export interface StageSession {
  /** Stage document tabs, in tab order. */
  files: string[]
  /** The stage tab that was active: one of `files`, or null for a surface. */
  activeFile: string | null
  /** The file open in the Files surface's preview, if any. */
  preview: string | null
}

export const STAGE_SESSION_KEY = 'workspace-os:stage-session:v1'
const MAX_FILES = 30

export function sessionStorageKey(root: string): string {
  return scopedKey(STAGE_SESSION_KEY, scopeKey(root))
}

/** Parses a stored record, keeping only well-formed paths inside `root`. */
export function parseSession(raw: string | null, root: string): StageSession | null {
  if (!raw || !root) return null
  let v: unknown
  try { v = JSON.parse(raw) } catch { return null }
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const inRoot = (p: unknown): p is string => typeof p === 'string' && p.length > 0 && isInside(root, p)
  const files = Array.isArray(o.files) ? [...new Set(o.files.filter(inRoot))].slice(0, MAX_FILES) : []
  const activeFile = inRoot(o.activeFile) && files.includes(o.activeFile) ? o.activeFile : null
  const preview = inRoot(o.preview) ? o.preview : null
  if (!files.length && !preview) return null
  return { files, activeFile, preview }
}

export function readSession(storage: StringStorage, root: string): StageSession | null {
  try { return parseSession(storage.getItem(sessionStorageKey(root)), root) } catch { return null }
}

export function writeSession(storage: StringStorage, root: string, s: StageSession): void {
  if (!root) return
  try { storage.setItem(sessionStorageKey(root), JSON.stringify(s)) } catch { /* storage full or blocked: not worth failing over */ }
}

/** The session without files that are gone; `exists` checks one path. */
export async function existingOnly(s: StageSession, exists: (p: string) => Promise<boolean>): Promise<StageSession> {
  const keep = await Promise.all(s.files.map(exists))
  const files = s.files.filter((_, i) => keep[i])
  const preview = s.preview && (await exists(s.preview)) ? s.preview : null
  return { files, activeFile: s.activeFile && files.includes(s.activeFile) ? s.activeFile : null, preview }
}
