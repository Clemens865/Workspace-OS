/**
 * What you can do here — the answer to discoverability.
 *
 * A command palette rewards people who already know what exists: you must know
 * the feature is there AND guess what it is called. Shortcuts are worse, since
 * they also demand recall of an arbitrary key. Both are excellent for the
 * second hundred uses and useless for the first.
 *
 * So the panel does not wait to be asked. It shows, at all times, a short list
 * of what is possible *on the page in front of you*, in plain language — and
 * that list CHANGES as you browse. A page with a table offers to turn it into a
 * spreadsheet; a long article offers a summary; a page with neither offers
 * neither. Nobody has to learn anything: the app demonstrates its own
 * capabilities by responding to what you are looking at.
 *
 * Two consequences that fall out, and both are deliberate:
 *
 * 1. **Relevance is computed, not curated.** The signals come from the page
 *    itself, measured on the same pass that indexes it for history — so this
 *    costs no extra round trip.
 *
 * 2. **Shortcuts are shown, never required.** Every row that has one displays
 *    it. That is how somebody learns ⌘F: not by reading documentation, but by
 *    seeing it beside "Find something on this page" a dozen times. The palette
 *    (⌘K) and this list are the same data, so speed and discovery never drift
 *    apart.
 *
 * Labels describe the OUTCOME, not the feature. "Turn this table into a
 * spreadsheet", not "Extract table". Someone who does not know what the feature
 * is called can still recognise what they want to happen.
 */

/**
 * Nothing is listed here that does not work.
 *
 * An offer that does nothing when clicked is worse than an absent one: it
 * teaches people the panel is decorative, and they stop reading it. Actions
 * arrive here only once they are wired end to end — which is why this list is
 * shorter than the feature plan's.
 *
 * Selection-based offers ("ask about what you selected") are absent for a
 * structural reason worth recording: knowing what is selected requires a live
 * signal FROM the guest page, and the guest deliberately has no preload bridge
 * (security.ts strips it, so a hostile page cannot reach Electron or app IPC).
 * The alternatives are polling the guest on a timer or weakening that
 * isolation, and neither is worth it for a convenience. Revisit if a safe
 * one-way channel from guest to host ever exists.
 *
 * "Save as PDF" is absent for a duller reason: printToPDF returns binary and
 * the renderer's writeFile only takes a string, so it needs a main-process
 * path. Small, but not written yet — and an offer that fails on click costs
 * more trust than a missing one.
 */

/** What the page looks like — measured, not guessed. */
export interface PageSignals {
  hasPage: boolean
  /** Number of real data tables (a layout table with one row does not count). */
  tables: number
  /** Rough word count of the readable text. */
  words: number
  /** True when the page has a form worth noticing. */
  hasForm: boolean
  /** Already bookmarked — the offer flips to "remove". */
  starred: boolean
}

export type ActionId =
  | 'summarise'
  | 'table-to-sheet'
  | 'ask'
  | 'deep-read'
  | 'find'
  | 'bookmark'
  | 'unbookmark'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'history'
  | 'bookmarks'

export interface Action {
  id: ActionId
  /** Plain language, outcome first. This is what the user reads. */
  label: string
  /** Shown when there is one. Displayed, never required. */
  shortcut?: string
  /** Higher sorts first. 0 means "not relevant to this page". */
  relevance: number
  /** True when it hands work to an agent — the UI marks these. */
  agentic?: boolean
}

/** Every action the browser knows how to do, with when-it-matters logic. */
export function allActions(s: PageSignals): Action[] {
  return [
    // ── things the page itself makes possible ─────────────────────────────
    {
      id: 'table-to-sheet',
      label: s.tables > 1 ? 'Turn these tables into a spreadsheet' : 'Turn this table into a spreadsheet',
      // A page with a table is the clearest offer this browser can make, and
      // the one nobody would think to look for in a menu.
      relevance: s.tables > 0 ? 90 : 0,
      agentic: true,
    },
    {
      id: 'summarise',
      // Below a couple of hundred words there is nothing to summarise, and
      // offering it anyway teaches people the suggestions are noise.
      label: 'Summarise this page',
      relevance: s.words >= 200 ? 80 : 0,
      agentic: true,
    },
    {
      id: 'deep-read',
      label: 'Read the whole site, not just this page',
      relevance: s.hasPage ? 55 : 0,
      agentic: true,
    },
    {
      id: 'ask',
      label: 'Ask a question about this page',
      relevance: s.hasPage ? 45 : 0,
      agentic: true,
    },

    // ── ordinary browser things, always true but still worth showing ──────
    {
      id: 'find',
      label: 'Find something on this page',
      shortcut: '⌘F',
      relevance: s.hasPage ? 40 : 0,
    },
    {
      id: s.starred ? 'unbookmark' : 'bookmark',
      label: s.starred ? 'Remove this bookmark' : 'Bookmark this page',
      shortcut: '⌘D',
      relevance: s.hasPage ? 35 : 0,
    },
    { id: 'zoom-in', label: 'Make the text bigger', shortcut: '⌘+', relevance: s.hasPage ? 20 : 0 },
    { id: 'zoom-out', label: 'Make the text smaller', shortcut: '⌘−', relevance: s.hasPage ? 19 : 0 },
    { id: 'zoom-reset', label: 'Back to normal size', shortcut: '⌘0', relevance: s.hasPage ? 18 : 0 },
    /**
     * "Search everything you have read" describes the OUTCOME, which is this
     * panel's rule and normally the right call. It failed here for a reason the
     * rule does not cover: somebody looking for their history did not recognise
     * it, because "history" is not a feature name they had to learn — it is the
     * word they already have. Outcome-first loses to a word the user already
     * owns. The old phrasing survives as the description, where it still
     * teaches what makes this history unusual.
     */
    {
      id: 'history',
      label: 'History — search everything you have read',
      shortcut: '⌘⇧H',
      relevance: 15,
    },
    /**
     * Starring a page has worked since the beginning; there was no way to see
     * what you had starred. `history.bookmarks()` existed in the API and
     * nothing in the app ever called it, so a bookmark was write-only — which
     * is the one failure this panel's own rule ("nothing is listed that does
     * not work") is meant to prevent, hidden one level down in a feature that
     * only half existed.
     */
    { id: 'bookmarks', label: 'Bookmarks — everything you have kept', shortcut: '⌘⇧O', relevance: 14 },
  ]
}

/**
 * The short list: what is worth offering for THIS page, best first.
 *
 * Capped, because a list of sixteen things is a menu, and a menu is the thing
 * this design exists to avoid. Four or five relevant offers get read; sixteen
 * get ignored, which would leave us exactly where a command palette does.
 */
export function suggestedActions(s: PageSignals, limit = 5): Action[] {
  return allActions(s)
    .filter((a) => a.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit)
}

/**
 * Everything, for the palette and the "show everything" toggle.
 *
 * Irrelevant actions are not hidden here — they are listed last, greyed by the
 * UI. Hiding them entirely would recreate the discoverability problem for
 * anyone hunting something they know exists.
 */
export function everyAction(s: PageSignals): Action[] {
  return allActions(s).sort((a, b) => b.relevance - a.relevance)
}

/**
 * Is this menu id one of ours?
 *
 * Derived from the action list itself rather than written out again, so an
 * action added above is routable immediately and cannot be forgotten here. The
 * signals are irrelevant — `allActions` returns every id regardless of
 * relevance, which is exactly what a routing guard wants.
 */
const ACTION_IDS: ReadonlySet<string> = new Set(
  allActions({ hasPage: true, tables: 1, words: 1, hasForm: true, starred: false })
    .map((a) => a.id)
    .concat('unbookmark'), // the starred variant of the same row
)

export function isActionId(id: string): id is ActionId {
  return ACTION_IDS.has(id)
}

/** Substring match over labels, for typing in the palette. */
export function filterActions(actions: Action[], query: string): Action[] {
  const q = query.trim().toLowerCase()
  if (!q) return actions
  return actions.filter((a) => a.label.toLowerCase().includes(q))
}
