import { describe, it, expect } from 'vitest'
import { suggestedActions, everyAction, filterActions, allActions, isActionId, type PageSignals } from './page-actions'

const blank: PageSignals = { hasPage: false, tables: 0, words: 0, hasForm: false, starred: false }
const page = (over: Partial<PageSignals> = {}): PageSignals => ({
  hasPage: true,
  tables: 0,
  words: 800,
  hasForm: false,
  starred: false,
  ...over,
})

describe('the offer responds to the page', () => {
  it('offers the spreadsheet only when there is a table', () => {
    expect(suggestedActions(page({ tables: 2 })).map((a) => a.id)).toContain('table-to-sheet')
    expect(suggestedActions(page({ tables: 0 })).map((a) => a.id)).not.toContain('table-to-sheet')
  })

  it('puts the table offer first, because it is the least discoverable thing here', () => {
    expect(suggestedActions(page({ tables: 1 }))[0].id).toBe('table-to-sheet')
  })

  it('says "these tables" when there are several', () => {
    expect(suggestedActions(page({ tables: 3 }))[0].label).toContain('these tables')
    expect(suggestedActions(page({ tables: 1 }))[0].label).toContain('this table')
  })

  it('does not offer to summarise a page with nothing on it', () => {
    // Offering it anyway is how a suggestion list teaches people it is noise.
    expect(suggestedActions(page({ words: 30 })).map((a) => a.id)).not.toContain('summarise')
    expect(suggestedActions(page({ words: 900 })).map((a) => a.id)).toContain('summarise')
  })

  it('has no selection-based offer, because the guest has no bridge to report one', () => {
    // Recorded as a test so the absence reads as a decision rather than an
    // oversight: the guest deliberately has no preload, so nothing can tell us
    // what is selected without polling or weakening that isolation.
    expect(everyAction(page()).map((a) => String(a.id))).not.toContain('ask-selection')
  })

  it('offers nothing page-specific when no page is open', () => {
    const ids = suggestedActions(blank).map((a) => a.id)
    expect(ids).not.toContain('summarise')
    expect(ids).not.toContain('find')
  })

  it('flips the bookmark offer once the page is bookmarked', () => {
    // Checked against the full list, not the suggestions: bookmarking does not
    // earn a slot in the short list, because the star is already visible in the
    // omnibox. Suggestions are for what you would NOT otherwise find.
    expect(everyAction(page()).map((a) => a.id)).toContain('bookmark')
    expect(everyAction(page({ starred: true })).map((a) => a.id)).toContain('unbookmark')
    expect(everyAction(page({ starred: true })).map((a) => a.id)).not.toContain('bookmark')
  })
})

describe('the list stays short enough to read', () => {
  it('caps the suggestions', () => {
    // Sixteen offers is a menu, and a menu is what this design exists to avoid.
    expect(suggestedActions(page({ tables: 2 })).length).toBeLessThanOrEqual(5)
  })

  it('never suggests something irrelevant just to fill the space', () => {
    expect(suggestedActions(page()).every((a) => a.relevance > 0)).toBe(true)
  })
})

describe('shortcuts are shown, never required', () => {
  it('carries the shortcut on actions that have one', () => {
    const find = allActions(page()).find((a) => a.id === 'find')
    expect(find?.shortcut).toBe('⌘F')
  })

  it('every action is reachable without knowing any shortcut', () => {
    // The whole point: the full list is browsable, so nothing is gated behind
    // a key combination somebody has to have learned.
    const ids = everyAction(page()).map((a) => a.id)
    for (const needed of ['find', 'bookmark', 'zoom-in', 'history', 'summarise']) {
      expect(ids).toContain(needed)
    }
  })
})

describe('the full list', () => {
  it('keeps irrelevant actions rather than hiding them', () => {
    // Hiding them would recreate the discoverability problem for anyone
    // hunting something they know exists.
    const ids = everyAction(page({ words: 0 })).map((a) => a.id)
    expect(ids).toContain('summarise')
  })

  it('sorts relevant things above irrelevant ones', () => {
    const list = everyAction(page({ tables: 1 }))
    const firstIrrelevant = list.findIndex((a) => a.relevance === 0)
    if (firstIrrelevant > 0) {
      expect(list.slice(0, firstIrrelevant).every((a) => a.relevance > 0)).toBe(true)
    }
  })
})

describe('typing to filter', () => {
  it('matches on plain words, the way people describe what they want', () => {
    const hits = filterActions(everyAction(page({ tables: 1 })), 'spreadsheet')
    expect(hits.map((a) => a.id)).toEqual(['table-to-sheet'])
  })

  it('is case-insensitive and matches mid-label', () => {
    expect(filterActions(everyAction(page()), 'BIGGER').map((a) => a.id)).toEqual(['zoom-in'])
  })

  it('returns everything for an empty query', () => {
    const all = everyAction(page())
    expect(filterActions(all, '   ')).toHaveLength(all.length)
  })
})

/**
 * Shortcut collisions.
 *
 * `bookmarks` was first written as ⌘⇧B, which is the bug reporter — bound on
 * window in App.tsx and commented "global, and deliberately not bound to any
 * surface". Both listeners would have fired: the bug reporter and the bookmarks
 * list, together, on one keypress. Nothing failed; a typecheck cannot see it and
 * neither can a unit test of either handler alone.
 *
 * This asserts what CAN be checked cheaply — that the panel never advertises the
 * same key for two different things. The app-wide keys are listed explicitly
 * because that is the collision that actually happened.
 */
describe('shortcut hygiene', () => {
  const signals: PageSignals = { hasPage: true, tables: 2, words: 900, hasForm: true, starred: false }

  it('never offers one shortcut for two actions', () => {
    const shortcuts = allActions(signals).map((a) => a.shortcut).filter(Boolean)
    expect(new Set(shortcuts).size).toBe(shortcuts.length)
  })

  it('does not claim a key the app has already bound globally', () => {
    // ⌘⇧B — bug reporter (App.tsx). ⌘B / ⌘J / ⌘K — file panel, dock, palette.
    const takenElsewhere = ['⌘⇧B', '⌘B', '⌘J', '⌘K']
    const mine = allActions(signals).map((a) => a.shortcut).filter(Boolean)
    for (const taken of takenElsewhere) expect(mine).not.toContain(taken)
  })
})

/**
 * The routing guard.
 *
 * The native Browser menu sends the same ids this panel does, and BrowserSurface
 * routes them through `isActionId`. If the two ever disagree, a menu item goes
 * quietly dead — which is the failure this module's own note refuses to allow
 * ("nothing is listed here that does not work"), arriving by a different door.
 */
describe('isActionId', () => {
  const signals: PageSignals = { hasPage: true, tables: 1, words: 500, hasForm: false, starred: false }

  it('accepts every id the panel can offer', () => {
    for (const a of allActions(signals)) expect(isActionId(a.id), a.id).toBe(true)
  })

  it('accepts the starred variant, which only appears on a bookmarked page', () => {
    const starred: PageSignals = { ...signals, starred: true }
    for (const a of allActions(starred)) expect(isActionId(a.id), a.id).toBe(true)
  })

  it('rejects ids belonging to other surfaces', () => {
    for (const id of ['office.uno:Bold', 'agent.focus', 'nav.back', 'history.clear', '']) {
      expect(isActionId(id), id).toBe(false)
    }
  })
})
