import type { BrowserTab, BrowserTabsState } from './browserTabs'
import { newGroupId, pruneGroups, type TabGroup } from './tab-groups'

/**
 * Session restore — the tabs you had open come back.
 *
 * Losing eleven open tabs to a restart is the kind of small betrayal that makes
 * people stop trusting a browser with anything they care about. Chrome, Safari
 * and Firefox all restore; a workspace browser that forgets is worse than the
 * one you already have.
 *
 * What is deliberately NOT persisted:
 *
 *   - blank tabs, which restore as nothing anyway
 *   - about:blank, the placeholder every tab mounts at (WOS-005)
 *   - anything that is not http(s) — a restored file:// or data: url is at
 *     best useless and at worst a resurrected surprise
 *
 * Kept pure and separate from the reducer so restore logic is testable without
 * a DOM, and so a corrupt stored payload can never take the browser down with
 * it: every failure path returns null and the caller opens a fresh tab.
 */

const KEY = 'workspace-os:browser-session'

/** The subset worth storing. Nav state and guests are rebuilt on load. */
interface StoredTab {
  url: string
  title: string
  favicon: string
  /**
   * Index into the stored GROUPS array, not a group id.
   *
   * Ids are regenerated on restore (as tab ids are), so storing one would
   * dangle. An index survives the round trip.
   */
  group?: number
}

interface StoredSession {
  /** v2 added groups. A v1 payload still restores — just without them. */
  v: 1 | 2
  tabs: StoredTab[]
  activeIndex: number
  groups?: TabGroup[]
}

/** True when a url is worth restoring. */
export function isRestorable(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/** Serialises the live tab state. Returns null when there is nothing worth saving. */
export function toStored(state: BrowserTabsState): StoredSession | null {
  // Only groups that still have a restorable tab are worth keeping; a group
  // whose members were all unrestorable would come back empty.
  const groupIds: string[] = []
  const keep: StoredTab[] = []
  let activeIndex = 0
  for (const t of state.tabs) {
    if (!isRestorable(t.url)) continue
    if (t.id === state.activeId) activeIndex = keep.length
    let group: number | undefined
    if (t.groupId && state.groups.some((g) => g.id === t.groupId)) {
      let i = groupIds.indexOf(t.groupId)
      if (i === -1) {
        i = groupIds.length
        groupIds.push(t.groupId)
      }
      group = i
    }
    keep.push({ url: t.url, title: t.title, favicon: t.favicon, ...(group === undefined ? {} : { group }) })
  }
  if (keep.length === 0) return null
  const groups = groupIds
    .map((id) => state.groups.find((g) => g.id === id))
    .filter((g): g is TabGroup => !!g)
  return { v: 2, tabs: keep, activeIndex, groups }
}

/**
 * Rebuilds tab state from a stored session.
 *
 * `makeTab` is injected rather than imported so ids come from the same
 * generator the reducer uses — two id sources would eventually collide, and a
 * duplicate tab id is the kind of bug that shows up as a tab controlling
 * another tab's page.
 */
export function fromStored(
  stored: unknown,
  makeTab: (url?: string) => BrowserTab,
): BrowserTabsState | null {
  const s = stored as StoredSession | null
  if (!s || (s.v !== 1 && s.v !== 2) || !Array.isArray(s.tabs) || s.tabs.length === 0) return null

  // Fresh group ids, for the same reason tabs get fresh ones.
  const storedGroups = Array.isArray(s.groups) ? s.groups : []
  const groups: TabGroup[] = storedGroups.map((g, i) => ({
    id: newGroupId(),
    name: typeof g?.name === 'string' && g.name ? g.name : 'Group',
    color: typeof g?.color === 'number' ? g.color : i % 6,
    collapsed: !!g?.collapsed,
    auto: g?.auto !== false,
  }))

  const tabs: BrowserTab[] = []
  for (const t of s.tabs) {
    if (!t || typeof t.url !== 'string' || !isRestorable(t.url)) continue
    const tab = makeTab(t.url)
    const g = typeof t.group === 'number' ? groups[t.group] : undefined
    tabs.push({
      ...tab,
      title: typeof t.title === 'string' ? t.title : '',
      favicon: typeof t.favicon === 'string' ? t.favicon : '',
      ...(g ? { groupId: g.id } : {}),
    })
  }
  if (tabs.length === 0) return null

  // A stored index can be out of range if some tabs were dropped as
  // unrestorable; clamping beats restoring a session with no active tab.
  const i = Math.max(0, Math.min(s.activeIndex ?? 0, tabs.length - 1))
  // Prune here too: a group can fall below two members when unrestorable tabs
  // are dropped, and a container around one tab is worse than none.
  const pruned = pruneGroups(tabs, groups)
  return { tabs: pruned.tabs, activeId: tabs[i].id, groups: pruned.groups }
}

export function saveSession(state: BrowserTabsState): void {
  try {
    const stored = toStored(state)
    if (stored) localStorage.setItem(KEY, JSON.stringify(stored))
    else localStorage.removeItem(KEY)
  } catch {
    /* a full or unavailable store must never break browsing */
  }
}

export function loadSession(makeTab: (url?: string) => BrowserTab): BrowserTabsState | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    return fromStored(JSON.parse(raw), makeTab)
  } catch {
    // Corrupt payload: start clean rather than refusing to open the browser.
    return null
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to do */
  }
}

/**
 * A read-only peek at the persisted session — what tabs are open right now —
 * for surfaces OUTSIDE the browser (the Home desk's pages widget). No tab
 * objects are constructed and nothing is mutated; a corrupt payload is [].
 */
export function peekSession(): { url: string; title: string; favicon: string }[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const s = JSON.parse(raw) as { tabs?: { url?: string; title?: string; favicon?: string }[] }
    if (!Array.isArray(s?.tabs)) return []
    return s.tabs
      .filter((t) => typeof t?.url === 'string' && t.url)
      .map((t) => ({ url: t.url as string, title: t.title ?? '', favicon: t.favicon ?? '' }))
  } catch {
    return []
  }
}
