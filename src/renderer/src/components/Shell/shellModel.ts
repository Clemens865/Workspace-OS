/**
 * Pure model for the stage: its surfaces and tabs.
 *
 * Kept free of React/DOM so it's unit-testable in the node vitest environment
 * (the renderer test suite has no jsdom). The shell components import these
 * definitions; the switch logic (which existing component a rail item composes)
 * lives here as data.
 */

/**
 * The stage's surfaces. Still called "rail" ids: the left rail that listed them
 * was retired (tag backup/stage-rail-before-retire); the landscape's Menu and
 * dock reach them now.
 */
export type RailId =
  | 'files'
  | 'mail'
  | 'calendar'
  | 'browser'
  | 'agents'
  | 'knowledge'
  | 'memory'
  | 'connectors'
  | 'settings'

export interface RailItem {
  id: RailId
  label: string
}

/** Every stage surface, in Menu order. */
export const RAIL_ITEMS: RailItem[] = [
  { id: 'files', label: 'Files' },
  { id: 'mail', label: 'Mail' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'browser', label: 'Browser' },
  { id: 'agents', label: 'Agents' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'memory', label: 'Memory' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'settings', label: 'Settings' },
]

/** A tab open on the Stage: either a rail surface or an opened document. */
export interface StageTab {
  /** Stable key — 'home', a rail id, or a document path. */
  key: string
  label: string
  /** Documents can be closed; the Home tab and rail surfaces are pinned. */
  closable: boolean
}

/** Never shown: the first entry of the tab list, meaning "no document is active". */
export const HOME_TAB: StageTab = { key: 'home', label: 'Home', closable: false }

/** Basename label for a document path (no path module needed at call sites). */
export function docLabel(filePath: string): string {
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] || filePath
}

/**
 * Reducer helper: open a document tab. Returns the next tab list (deduped) and
 * the key to activate. Home always stays first.
 */
export function openDocTab(tabs: StageTab[], filePath: string): { tabs: StageTab[]; active: string } {
  const existing = tabs.find((t) => t.key === filePath)
  if (existing) return { tabs, active: filePath }
  const tab: StageTab = { key: filePath, label: docLabel(filePath), closable: true }
  return { tabs: [...tabs, tab], active: filePath }
}

/** Reducer helper: close a document tab, returning next tabs + the tab to focus. */
export function closeDocTab(tabs: StageTab[], key: string): { tabs: StageTab[]; active: string } {
  const next = tabs.filter((t) => t.key !== key)
  return { tabs: next, active: HOME_TAB.key }
}

/**
 * Whether the active tab is an opened DOCUMENT (not Home, not a rail id).
 * `selectRail` parks activeTab on the rail id itself ('files', 'mail', …), and
 * 'files' passes an `activeTab !== HOME_TAB.key` check — which once showed the
 * Stage editor underneath the Files browser, whose sticky spreadsheet headers
 * then painted over the file tree.
 */
export function isDocTab(tabs: StageTab[], key: string): boolean {
  return tabs.some((t) => t.key === key && t.closable)
}

/**
 * The absolute path an "open this file" click means.
 *
 * Case attachments are stored VERBATIM as the agent attached them, and agents
 * are told to attach workspace-relative paths — so a case's file button used to
 * hand `Jobs/scan.xlsx` to an open pipeline that expects absolute paths, and
 * every renderer down the line said "File does not exist". Anything not
 * absolute is resolved against the workspace root at the one funnel every
 * open goes through.
 */
export function resolveOpenPath(path: string, root: string | null): string {
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) return path
  const rel = path.replace(/^\.\//, '')
  return root ? `${root.replace(/\/$/, '')}/${rel}` : path
}
