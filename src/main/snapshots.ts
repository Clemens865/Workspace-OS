import { app } from 'electron'
import fs from 'fs'
import path from 'path'

/**
 * Named workspace snapshots (PRD MVP #10): "save my whole desk".
 *
 * A snapshot captures the renderer's UI state — open tabs, active tab, panel
 * layout, sidebar view — for one workspace root. Snapshots persist as a single
 * JSON file in userData (independent of any workspace, like recent-workspaces)
 * and surface through File ▸ Snapshots in the native menu.
 */

export interface SnapshotState {
  /** Absolute paths of the open canvas tabs, in order. */
  files: string[]
  activeFile: string | null
  sidebarView: 'files' | 'search' | 'memory' | 'knowledge' | 'review' | 'mail'
  sidebarOpen: boolean
  terminalOpen: boolean
  panel: { filePanel: number; terminal: number } | null
}

export interface WorkspaceSnapshot {
  id: string
  name: string
  root: string
  createdAt: number
  state: SnapshotState
}

export const SNAPSHOTS_MAX = 30
const FILES_MAX = 50
const NAME_MAX = 60

const newId = (): string => `snap-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

/** Coerces untrusted renderer/disk data into a well-formed SnapshotState. */
export function sanitizeState(raw: unknown): SnapshotState {
  const s = (raw ?? {}) as Partial<SnapshotState>
  const panel = s.panel as { filePanel?: unknown; terminal?: unknown } | null | undefined
  return {
    files: Array.isArray(s.files)
      ? s.files.filter((f): f is string => typeof f === 'string').slice(0, FILES_MAX)
      : [],
    activeFile: typeof s.activeFile === 'string' ? s.activeFile : null,
    sidebarView:
      s.sidebarView === 'search'
        ? 'search'
        : s.sidebarView === 'memory'
          ? 'memory'
          : s.sidebarView === 'knowledge'
            ? 'knowledge'
            : s.sidebarView === 'review'
              ? 'review'
              : s.sidebarView === 'mail'
                ? 'mail'
                : 'files',
    sidebarOpen: s.sidebarOpen !== false,
    terminalOpen: s.terminalOpen !== false,
    panel:
      panel && typeof panel.filePanel === 'number' && typeof panel.terminal === 'number'
        ? { filePanel: panel.filePanel, terminal: panel.terminal }
        : null,
  }
}

export class SnapshotStore {
  constructor(private file: () => string) {}

  private load(): WorkspaceSnapshot[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file(), 'utf-8')) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter(
          (s): s is WorkspaceSnapshot =>
            typeof (s as WorkspaceSnapshot)?.id === 'string' &&
            typeof (s as WorkspaceSnapshot)?.name === 'string' &&
            typeof (s as WorkspaceSnapshot)?.root === 'string'
        )
        .map((s) => ({
          id: s.id,
          name: s.name.slice(0, NAME_MAX),
          root: s.root,
          createdAt: typeof s.createdAt === 'number' ? s.createdAt : 0,
          state: sanitizeState(s.state),
        }))
    } catch {
      return [] // nothing saved yet, or corrupt file — start fresh
    }
  }

  private save(list: WorkspaceSnapshot[]): void {
    try {
      fs.writeFileSync(this.file(), JSON.stringify(list), 'utf-8')
    } catch {
      // Best-effort — an unwritable userData dir shouldn't block the app.
    }
  }

  /** Snapshots for one root (or all), newest first. */
  list(root: string | null): WorkspaceSnapshot[] {
    const all = this.load().sort((a, b) => b.createdAt - a.createdAt)
    return root === null ? all : all.filter((s) => s.root === root)
  }

  get(id: string): WorkspaceSnapshot | undefined {
    return this.load().find((s) => s.id === id)
  }

  /**
   * Saves a snapshot. Same name + root replaces the existing one (re-saving
   * "Monday desk" updates it); the list is capped, dropping the oldest.
   */
  create(root: string, name: string, state: unknown): WorkspaceSnapshot {
    const snap: WorkspaceSnapshot = {
      id: newId(),
      name: name.trim().slice(0, NAME_MAX) || 'Untitled',
      root,
      createdAt: Date.now(),
      state: sanitizeState(state),
    }
    const rest = this.load().filter((s) => !(s.root === root && s.name === snap.name))
    const next = [snap, ...rest]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, SNAPSHOTS_MAX)
    this.save(next)
    return snap
  }

  remove(id: string): void {
    this.save(this.load().filter((s) => s.id !== id))
  }
}

export const snapshots = new SnapshotStore(() =>
  path.join(app.getPath('userData'), 'workspace-snapshots.json')
)
