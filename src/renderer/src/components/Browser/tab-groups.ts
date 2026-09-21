import type { BrowserTab } from './browserTabs'

/**
 * Tab groups that form themselves.
 *
 * Manual tab categories are a chore that decays: people group tabs once, never
 * maintain it, and end up with stale labels over tabs that moved on. Any design
 * that needs upkeep to stay true will stop being true.
 *
 * So grouping is derived from something already known — WHERE A TAB CAME FROM.
 * Opening five links from one article is a task; the browser can see that
 * without being told. The same rule covers the agent's parallel research, since
 * its fan-out opens every tab from the page it started on.
 *
 * Three rules make it feel like tidying rather than interference:
 *
 * 1. **A group appears on the SECOND sibling, never the first.** One link
 *    opened from a page is not a project, and wrapping it in a labelled box is
 *    noise. The group forms at the moment there is actually something to
 *    organise — the same hide-the-healthy instinct as the cockpit.
 *
 * 2. **A group dissolves when it drops below two.** Otherwise closing tabs
 *    leaves a labelled container around a single tab, which is worse than no
 *    grouping at all.
 *
 * 3. **The name is a guess you can overwrite.** Derived from the shared site or
 *    the opener's title, and marked as auto — so a later auto-name may improve
 *    it, but a name a human typed is never overwritten.
 */

export interface TabGroup {
  id: string
  name: string
  /** Index into the palette; the UI owns the actual colours. */
  color: number
  collapsed: boolean
  /** False once a human renames it — auto-naming then leaves it alone. */
  auto: boolean
}

let seq = 0
export function newGroupId(): string {
  seq += 1
  return `grp-${Date.now().toString(36)}-${seq}`
}

/** How many tabs belong to a group. */
export function membersOf(tabs: BrowserTab[], groupId: string): BrowserTab[] {
  return tabs.filter((t) => t.groupId === groupId)
}

/** The registrable host of a url, or '' — used for naming. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Picks a name for a set of tabs.
 *
 * A shared host is the most honest label — five tabs on one site really are
 * about that site. Falling back to the opener's title covers the commoner case
 * of a search that fans out across different domains.
 */
export function nameForGroup(tabs: BrowserTab[], openerTitle = ''): string {
  const hosts = new Set(tabs.map((t) => hostOf(t.url)).filter(Boolean))
  if (hosts.size === 1) {
    const host = [...hosts][0]
    const core = host.split('.').slice(0, -1).pop() || host
    return core.charAt(0).toUpperCase() + core.slice(1)
  }
  const title = openerTitle.trim()
  if (title) return title.length > 28 ? `${title.slice(0, 27)}…` : title
  return 'Group'
}

/**
 * Decides what happens when `tab` is opened from `openerId`.
 *
 * PURE: returns the changes to apply rather than applying them, so the reducer
 * stays the only thing that mutates state and this stays testable on its own.
 *
 * Returns null when nothing should change — the overwhelmingly common case,
 * and the one that must stay cheap.
 */
export function groupOnOpen(
  tabs: BrowserTab[],
  groups: TabGroup[],
  newTabId: string,
  openerId: string | undefined,
): { groups: TabGroup[]; assign: { tabId: string; groupId: string }[] } | null {
  if (!openerId) return null
  const opener = tabs.find((t) => t.id === openerId)
  if (!opener) return null

  // The opener is already grouped: the new tab simply joins it.
  if (opener.groupId) {
    return { groups, assign: [{ tabId: newTabId, groupId: opener.groupId }] }
  }

  const siblings = tabs.filter((t) => t.openerId === openerId && t.id !== newTabId)

  // A sibling may already be grouped even though the opener is not — which is
  // the normal case, since the opener deliberately stays outside. Without this,
  // the third tab from one page started a SECOND group beside the first.
  const existing = siblings.find((t) => t.groupId)?.groupId
  if (existing) {
    return { groups, assign: [{ tabId: newTabId, groupId: existing }] }
  }

  // Otherwise a group forms only once a SECOND tab shares this opener. One
  // link from a page is not a project.
  if (siblings.length === 0) return null

  const id = newGroupId()
  const members = [...siblings, ...tabs.filter((t) => t.id === newTabId)]
  const group: TabGroup = {
    id,
    name: nameForGroup(members.length ? members : siblings, opener.title),
    color: groups.length % 6,
    collapsed: false,
    auto: true,
  }
  return {
    groups: [...groups, group],
    // The opener stays OUT of the group: it is the page you fanned out FROM,
    // usually a search or an index, and sweeping it in makes the group's name
    // wrong and its contents surprising.
    assign: [...siblings.map((t) => ({ tabId: t.id, groupId: id })), { tabId: newTabId, groupId: id }],
  }
}

/**
 * Drops groups that no longer have two members.
 *
 * Called after any close. A labelled container around one tab is worse than no
 * grouping, and an empty one is a ghost.
 */
export function pruneGroups(
  tabs: BrowserTab[],
  groups: TabGroup[],
): { tabs: BrowserTab[]; groups: TabGroup[] } {
  const keep = groups.filter((g) => membersOf(tabs, g.id).length >= 2)
  if (keep.length === groups.length) return { tabs, groups }
  const kept = new Set(keep.map((g) => g.id))
  return {
    tabs: tabs.map((t) => (t.groupId && !kept.has(t.groupId) ? { ...t, groupId: undefined } : t)),
    groups: keep,
  }
}

/**
 * Re-derives an AUTO name after the group's contents change.
 *
 * A group that began as two tabs on one site and grew to span four is no longer
 * named accurately. A name a human typed is never touched.
 */
export function refreshAutoNames(tabs: BrowserTab[], groups: TabGroup[]): TabGroup[] {
  return groups.map((g) => {
    if (!g.auto) return g
    const members = membersOf(tabs, g.id)
    if (members.length === 0) return g
    const name = nameForGroup(members)
    // Never downgrade a real name to the generic fallback.
    //
    // nameForGroup has no opener title to work with here, so a group whose tabs
    // span several sites returns 'Group' — and this ran straight after
    // creation, replacing a perfectly good name taken from the opener's title
    // with 'Group'. Observed in the app while the unit tests passed, because
    // they never checked the name after a refresh.
    if (name === 'Group' && g.name !== 'Group') return g
    return name === g.name ? g : { ...g, name }
  })
}
