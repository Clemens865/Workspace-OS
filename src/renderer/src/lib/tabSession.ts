/**
 * Persistence for the open canvas tabs — "reopen yesterday's desk exactly".
 *
 * Mirrors the AgentTerminal sessionStore pattern: a localStorage record keyed
 * to the workspace root, saved on every tab change and restored on launch only
 * when the same root opens (a different folder starts clean). Tab ids are
 * ephemeral, so only file paths + the active path persist.
 */

export interface TabSessionState {
  /** Workspace root the tabs belong to — restore only applies on a match. */
  root: string
  /** Absolute paths of the open tabs, in order. */
  files: string[]
  activeFile: string | null
}

type StringStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const STORE_KEY = 'workspace-os:open-tabs:v1'
const FILES_MAX = 50

/** Validates untrusted storage contents into a usable state (or null). */
export function decodeTabSession(raw: string | null): TabSessionState | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<TabSessionState>
    if (typeof parsed?.root !== 'string' || !Array.isArray(parsed.files)) return null
    const files = parsed.files.filter((f): f is string => typeof f === 'string').slice(0, FILES_MAX)
    return {
      root: parsed.root,
      files,
      activeFile:
        typeof parsed.activeFile === 'string' && files.includes(parsed.activeFile)
          ? parsed.activeFile
          : files[files.length - 1] ?? null,
    }
  } catch {
    return null // corrupt record — start clean rather than blocking launch
  }
}

export function loadTabSession(root: string, storage: StringStorage = localStorage): TabSessionState | null {
  const state = decodeTabSession(storage.getItem(STORE_KEY))
  return state && state.root === root ? state : null
}

/**
 * Drops restored tabs whose file no longer exists.
 *
 * Restore used to reopen every remembered path blindly. Anything deleted, moved
 * or renamed outside the app then came back as a tab that immediately failed
 * with a raw `lok:open … File does not exist`, and the failures accumulated:
 * each launch re-persisted the dead paths, so one deleted file haunted the desk
 * indefinitely. (This also made the office e2e suite look randomly broken — the
 * harness wipes its workspace between runs, so restored tabs piled up until the
 * UI was mostly failed opens, which read as "new documents don't render".)
 *
 * `existing` is the workspace file listing and is treated as AUTHORITATIVE,
 * including when it is empty — an empty workspace genuinely has no tabs to
 * restore. "No information" is the caller's job: if the listing call throws, it
 * skips pruning entirely rather than passing [] here. (Treating [] as unknown
 * looked safer but defeated the fix in the exact case that matters — every dead
 * tab came back on an empty workspace.)
 */
export function pruneMissingTabs(state: TabSessionState, existing: readonly string[]): TabSessionState {
  const alive = new Set(existing)
  const files = state.files.filter((f) => alive.has(f))
  if (files.length === state.files.length) return state
  return {
    ...state,
    files,
    activeFile: state.activeFile && files.includes(state.activeFile) ? state.activeFile : files[files.length - 1] ?? null,
  }
}

export function saveTabSession(state: TabSessionState, storage: StringStorage = localStorage): void {
  try {
    storage.setItem(STORE_KEY, JSON.stringify({ ...state, files: state.files.slice(0, FILES_MAX) }))
  } catch {
    // Quota failure — persistence is best-effort.
  }
}
