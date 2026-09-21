import { useState, useCallback, useEffect } from 'react'

export interface RecentEntry {
  path: string
  ts: number
}

interface Library {
  starred: string[]
  recent: RecentEntry[]
}

const RECENT_MAX = 8

function keyFor(root: string): string {
  return `workspace-os:lib:${root}`
}

function load(root: string): Library {
  if (!root) return { starred: [], recent: [] }
  try {
    const raw = localStorage.getItem(keyFor(root))
    if (raw) return { starred: [], recent: [], ...JSON.parse(raw) }
  } catch {
    // corrupt — start fresh
  }
  return { starred: [], recent: [] }
}

export interface WorkspaceLibrary {
  starred: string[]
  recent: RecentEntry[]
  isStarred: (path: string) => boolean
  toggleStar: (path: string) => void
  recordRecent: (path: string) => void
}

/**
 * Per-workspace starred + recent files, persisted in localStorage keyed by the
 * workspace root. Powers the sidebar's Starred and Recent sections.
 */
export function useWorkspaceLibrary(root: string): WorkspaceLibrary {
  const [lib, setLib] = useState<Library>(() => load(root))

  // Reload when the workspace root changes.
  useEffect(() => { setLib(load(root)) }, [root])

  const isStarred = useCallback((path: string) => lib.starred.includes(path), [lib.starred])

  const toggleStar = useCallback((path: string) => {
    setLib((prev) => {
      const starred = prev.starred.includes(path)
        ? prev.starred.filter((p) => p !== path)
        : [...prev.starred, path]
      const next = { ...prev, starred }
      if (root) localStorage.setItem(keyFor(root), JSON.stringify(next))
      return next
    })
  }, [root])

  const recordRecent = useCallback((path: string) => {
    setLib((prev) => {
      const recent = [{ path, ts: Date.now() }, ...prev.recent.filter((r) => r.path !== path)].slice(0, RECENT_MAX)
      const next = { ...prev, recent }
      if (root) localStorage.setItem(keyFor(root), JSON.stringify(next))
      return next
    })
  }, [root])

  return { starred: lib.starred, recent: lib.recent, isStarred, toggleStar, recordRecent }
}

/** Compact relative time like "2h", "Tue", "3d". */
export function relativeShort(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
