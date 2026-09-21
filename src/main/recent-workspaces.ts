import { app } from 'electron'
import fs from 'fs'
import path from 'path'

/**
 * Persisted list of recently opened workspace roots (most recent first).
 * Powers File ▸ Open Recent and the no-folder empty state. Stored in
 * userData so it survives restarts and is independent of any workspace.
 */

export const RECENT_WORKSPACES_MAX = 8

const RECENTS_FILE = (): string =>
  path.join(app.getPath('userData'), 'recent-workspaces.json')

/** Pure list update: dedupe, most-recent-first, capped. Exported for tests. */
export function pushRecent(list: string[], dir: string, max = RECENT_WORKSPACES_MAX): string[] {
  return [dir, ...list.filter((d) => d !== dir)].slice(0, max)
}

export function loadRecentWorkspaces(): string[] {
  try {
    const raw = fs.readFileSync(RECENTS_FILE(), 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((d): d is string => typeof d === 'string').slice(0, RECENT_WORKSPACES_MAX)
  } catch {
    return [] // nothing recorded yet
  }
}

function save(list: string[]): void {
  try {
    fs.writeFileSync(RECENTS_FILE(), JSON.stringify(list), 'utf-8')
  } catch {
    // Best-effort — an unwritable userData dir shouldn't block opening folders.
  }
}

export function recordRecentWorkspace(dir: string): void {
  save(pushRecent(loadRecentWorkspaces(), dir))
}

/** Drops entries whose directory no longer exists; returns the pruned list. */
export function pruneRecentWorkspaces(): string[] {
  const pruned = loadRecentWorkspaces().filter((d) => {
    try { return fs.statSync(d).isDirectory() } catch { return false }
  })
  save(pruned)
  return pruned
}

export function clearRecentWorkspaces(): void {
  save([])
}
