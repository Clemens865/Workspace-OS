import { groupOnOpen, pruneGroups, refreshAutoNames, type TabGroup } from './tab-groups'
/**
 * The Browser surface's TAB MODEL — a pure, framework-free reducer.
 *
 * Stage 1 of a multi-tab capability. Each tab is its own page (own <webview>).
 * Tabs carry a STABLE id (never reused, never index-based) so a later stage can
 * scope drive actions to an explicit tab id without touching this shape.
 *
 * Invariants the reducer guarantees (see browserTabs.test.ts):
 *  - there is ALWAYS at least one tab and exactly one active tab
 *  - closing the active tab activates a neighbour (right, else left)
 *  - closing the last tab yields a fresh blank tab (never zero tabs)
 */

/** A single browser tab. `url` is empty for a blank/start tab. */
export interface BrowserTab {
  /** Stable, unique id — the key for the webview + (later) drive scoping. */
  id: string
  /** The URL to load. Empty = a blank start tab (focused address bar). */
  url: string
  /** Last-known page title (or ''), synced from did-navigate / dom-ready. */
  title: string
  /** Last-known favicon URL (or ''), from page-favicon-updated. */
  favicon: string
  /**
   * Referer for this tab's FIRST request only, when it was opened from a page.
   *
   * A denied popup is re-opened as a fresh navigation, which has no opener and
   * therefore sends no Referer. Sites that gate outbound links on it then throw
   * the destination away.
   */
  referrer?: string
  /**
   * The tab this one was opened FROM, when it was opened from a page rather
   * than the + button. This is the whole basis of automatic grouping: opening
   * five links from one article is a task, and the browser can see that without
   * being told.
   */
  openerId?: string
  /** The group this tab belongs to, when it belongs to one. */
  groupId?: string
  /** The agent driving this tab, by name (ADOPTION.md B5), when an agent opened or targeted it. */
  owner?: string
}

export interface BrowserTabsState {
  tabs: BrowserTab[]
  activeId: string
  /** Groups that have formed. Empty is the normal state. */
  groups: TabGroup[]
}

let seq = 0
/** Monotonic, collision-free tab id (stable for the tab's whole life). */
export function newTabId(): string {
  seq += 1
  return `tab-${Date.now().toString(36)}-${seq}`
}

/** A fresh blank tab (empty page → the address bar takes focus). */
export function makeTab(url = '', referrer = ''): BrowserTab {
  // `referrer` is used for the tab's FIRST request only — see the webview's
  // httpreferrer in BrowserSurface. A link opened from a page must arrive with
  // the Referer a real browser would have sent, or sites that gate outbound
  // links (LinkedIn's /safety/go) discard the destination.
  return { id: newTabId(), url, title: '', favicon: '', ...(referrer ? { referrer } : {}) }
}

/** The initial state: a single tab (optionally opened at `url`). */
export function initialTabsState(url = ''): BrowserTabsState {
  const tab = makeTab(url)
  return { tabs: [tab], activeId: tab.id, groups: [] }
}

export type TabsAction =
  // `id` (optional) lets a caller (e.g. browser.newTab) pre-generate the stable
  // id so it can track/await that exact tab; `activate` (default true) opens the
  // tab in the background when false, so an agent can spawn tabs without stealing
  // the user's focus. `url` empty = a blank start tab.
  // `openerId` is the tab this was opened FROM (a link, a popup, an agent's
  // fan-out). It is what makes grouping automatic; omitting it — as the + button
  // does — means the tab is deliberately on its own.
  | { type: 'add'; url?: string; id?: string; activate?: boolean; openerId?: string; referrer?: string }
  | { type: 'close'; id: string }
  | { type: 'activate'; id: string }
  | { type: 'patch'; id: string; patch: Partial<Omit<BrowserTab, 'id'>> }
  | { type: 'renameGroup'; id: string; name: string }
  | { type: 'toggleGroup'; id: string }
  | { type: 'ungroup'; id: string }

/** The active tab (guaranteed to exist while the state is well-formed). */
export function activeTab(state: BrowserTabsState): BrowserTab {
  return state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0]
}

export function tabsReducer(state: BrowserTabsState, action: TabsAction): BrowserTabsState {
  switch (action.type) {
    case 'add': {
      const tab = action.id
        ? { id: action.id, url: action.url ?? '', title: '', favicon: '', ...(action.referrer ? { referrer: action.referrer } : {}) }
        : makeTab(action.url, action.referrer)
      const withOpener = action.openerId ? { ...tab, openerId: action.openerId } : tab
      let tabs = [...state.tabs, withOpener]
      let groups = state.groups

      // A group forms only once a SECOND tab shares an opener — see tab-groups.
      const formed = groupOnOpen(tabs, groups, withOpener.id, action.openerId)
      if (formed) {
        const assign = new Map(formed.assign.map((a) => [a.tabId, a.groupId]))
        tabs = tabs.map((t) => (assign.has(t.id) ? { ...t, groupId: assign.get(t.id) } : t))
        groups = refreshAutoNames(tabs, formed.groups)
      }

      // Background-open when activate === false (an agent spawning tabs); else
      // focus the new tab (default — unchanged UI behavior).
      return { tabs, groups, activeId: action.activate === false ? state.activeId : withOpener.id }
    }

    case 'activate': {
      if (!state.tabs.some((t) => t.id === action.id)) return state
      return { ...state, activeId: action.id }
    }

    case 'patch': {
      let changed = false
      const tabs = state.tabs.map((t) => {
        if (t.id !== action.id) return t
        changed = true
        return { ...t, ...action.patch }
      })
      return changed ? { ...state, tabs } : state
    }

    case 'close': {
      const idx = state.tabs.findIndex((t) => t.id === action.id)
      if (idx === -1) return state

      const remaining = state.tabs.filter((t) => t.id !== action.id)

      // Never zero tabs — closing the last one opens a fresh blank tab.
      if (remaining.length === 0) {
        const tab = makeTab()
        return { tabs: [tab], activeId: tab.id, groups: [] }
      }

      // A group that drops below two members dissolves: a labelled container
      // around one tab is worse than no grouping.
      const pruned = pruneGroups(remaining, state.groups)

      // Closing an inactive tab leaves the active one alone.
      if (action.id !== state.activeId) {
        return { ...state, tabs: pruned.tabs, groups: pruned.groups }
      }

      // Closing the active tab: activate the right neighbour, else the left.
      const nextActive = pruned.tabs[Math.min(idx, pruned.tabs.length - 1)]
      return { tabs: pruned.tabs, groups: pruned.groups, activeId: nextActive.id }
    }

    case 'renameGroup': {
      // A human-typed name is never overwritten by auto-naming afterwards.
      const name = action.name.trim()
      if (!name) return state
      return {
        ...state,
        groups: state.groups.map((g) => (g.id === action.id ? { ...g, name, auto: false } : g)),
      }
    }

    case 'toggleGroup': {
      return {
        ...state,
        groups: state.groups.map((g) => (g.id === action.id ? { ...g, collapsed: !g.collapsed } : g)),
      }
    }

    case 'ungroup': {
      return {
        ...state,
        tabs: state.tabs.map((t) => (t.groupId === action.id ? { ...t, groupId: undefined } : t)),
        groups: state.groups.filter((g) => g.id !== action.id),
      }
    }

    default:
      return state
  }
}
