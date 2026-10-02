/**
 * Pure model for the Screen Landscape shell: what the dock and the Menu offer,
 * and which stage surface each one opens. Free of React/DOM so it runs in the
 * node vitest environment, like Shell/shellModel.ts.
 */
import { RAIL_ITEMS, type RailId } from '../Shell/shellModel'

/** Landscape-level views. `stage` is the flat stage hosting the classic surfaces. */
export type LandscapeView = 'overview' | 'menu' | 'stage'

export type DockId = 'overview' | 'inbox' | 'cases' | 'library' | 'menu'

export interface DockItem {
  id: DockId
  label: string
  /**
   * Where the item leads until its own landscape view exists. `null` means a
   * landscape view (overview, menu); a rail id opens that surface on the stage.
   */
  stage: RailId | null
}

/**
 * The dock, from the design: Overview · Inbox · Cases · Library · Menu. Inbox,
 * Cases and Library open their closest existing surface on the stage until
 * their landscape views land (PLAN.md §4, phases 2 and 5).
 */
export const DOCK: DockItem[] = [
  { id: 'overview', label: 'Overview', stage: null },
  { id: 'inbox', label: 'Inbox', stage: 'agents' },
  { id: 'cases', label: 'Cases', stage: 'cockpit' },
  { id: 'library', label: 'Library', stage: 'knowledge' },
  { id: 'menu', label: 'Menu', stage: null },
]

export interface MenuGroup {
  title: string
  items: { rail: RailId; label: string; hint: string }[]
}

const HINTS: Partial<Record<RailId, string>> = {
  home: 'The widget board: what happened, what needs you',
  files: 'The workspace folder, previews and editors',
  mail: 'Inbox, sift and compose',
  calendar: 'Your calendars and invitations',
  browser: 'The in-app browser your agents can drive',
  agents: 'Feed, fleet and approvals',
  cockpit: 'Runs, cases and the stream',
  knowledge: 'Notes, links and backlinks',
  memory: 'What agents remember, per workspace and personal',
  connectors: 'Accounts, MCP servers and sign-ins',
  settings: 'Models, appearance and shell',
}

const GROUPS: { title: string; rails: RailId[] }[] = [
  { title: 'Work', rails: ['home', 'files', 'mail', 'calendar', 'browser'] },
  { title: 'Agents', rails: ['agents', 'cockpit'] },
  { title: 'Knowledge', rails: ['knowledge', 'memory'] },
  { title: 'Workspace', rails: ['connectors', 'settings'] },
]

/** Every real (non-placeholder) rail surface, grouped for the Menu. */
export function menuGroups(): MenuGroup[] {
  const real = new Map(RAIL_ITEMS.filter((r) => !r.placeholder).map((r) => [r.id, r.label]))
  return GROUPS.map((g) => ({
    title: g.title,
    items: g.rails.filter((r) => real.has(r)).map((r) => ({ rail: r, label: real.get(r)!, hint: HINTS[r] ?? '' })),
  }))
}

/** Rail surfaces the Menu does not reach (should stay empty: the parity check). */
export function unreachableRails(): RailId[] {
  const reached = new Set(menuGroups().flatMap((g) => g.items.map((i) => i.rail)))
  return RAIL_ITEMS.filter((r) => !r.placeholder && !reached.has(r.id)).map((r) => r.id)
}
