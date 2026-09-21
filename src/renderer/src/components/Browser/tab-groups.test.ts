import { describe, it, expect } from 'vitest'
import { tabsReducer, initialTabsState, type BrowserTabsState } from './browserTabs'
import { nameForGroup, hostOf, pruneGroups, membersOf } from './tab-groups'

/** Opens `n` tabs from the same opener — the shape of a fan-out. */
function fanOut(state: BrowserTabsState, openerId: string, urls: string[]): BrowserTabsState {
  let s = state
  for (const url of urls) s = tabsReducer(s, { type: 'add', url, openerId, activate: false })
  return s
}

describe('a group forms only when there is something to organise', () => {
  it('does NOT group a single link opened from a page', () => {
    // One link from an article is not a project, and wrapping it in a labelled
    // box is noise.
    const s0 = initialTabsState('https://news.com/article')
    const s = fanOut(s0, s0.activeId, ['https://a.com/'])
    expect(s.groups).toHaveLength(0)
    expect(s.tabs.every((t) => !t.groupId)).toBe(true)
  })

  it('forms a group on the SECOND sibling, and takes the first one with it', () => {
    const s0 = initialTabsState('https://news.com/article')
    const s = fanOut(s0, s0.activeId, ['https://a.com/', 'https://b.com/'])
    expect(s.groups).toHaveLength(1)
    expect(membersOf(s.tabs, s.groups[0].id)).toHaveLength(2)
  })

  it('leaves the OPENER outside the group', () => {
    // The opener is the page you fanned out FROM — usually a search or an
    // index. Sweeping it in makes the group's name wrong and its contents
    // surprising.
    const s0 = initialTabsState('https://news.com/article')
    const opener = s0.activeId
    const s = fanOut(s0, opener, ['https://a.com/', 'https://b.com/'])
    expect(s.tabs.find((t) => t.id === opener)?.groupId).toBeUndefined()
  })

  it('adds later siblings to the existing group rather than making a new one', () => {
    const s0 = initialTabsState('https://news.com/article')
    let s = fanOut(s0, s0.activeId, ['https://a.com/', 'https://b.com/'])
    s = fanOut(s, s0.activeId, ['https://c.com/'])
    expect(s.groups).toHaveLength(1)
    expect(membersOf(s.tabs, s.groups[0].id)).toHaveLength(3)
  })

  it('never groups tabs opened with the + button', () => {
    // No opener means the tab is deliberately on its own.
    let s = initialTabsState('https://news.com/')
    s = tabsReducer(s, { type: 'add' })
    s = tabsReducer(s, { type: 'add' })
    expect(s.groups).toHaveLength(0)
  })

  it('keeps separate fan-outs in separate groups', () => {
    const s0 = initialTabsState('https://one.com/')
    const first = s0.activeId
    let s = fanOut(s0, first, ['https://a.com/', 'https://b.com/'])
    const second = tabsReducer(s, { type: 'add', url: 'https://two.com/' })
    s = fanOut(second, second.activeId, ['https://c.com/', 'https://d.com/'])
    expect(s.groups).toHaveLength(2)
  })
})

describe('a group dissolves when it is no longer a group', () => {
  it('disappears once it drops below two members', () => {
    const s0 = initialTabsState('https://news.com/')
    let s = fanOut(s0, s0.activeId, ['https://a.com/', 'https://b.com/'])
    const member = membersOf(s.tabs, s.groups[0].id)[0]
    s = tabsReducer(s, { type: 'close', id: member.id })
    expect(s.groups).toHaveLength(0)
    expect(s.tabs.every((t) => !t.groupId)).toBe(true)
  })

  it('prune is idempotent on a healthy state', () => {
    const s0 = initialTabsState('https://news.com/')
    const s = fanOut(s0, s0.activeId, ['https://a.com/', 'https://b.com/'])
    const out = pruneGroups(s.tabs, s.groups)
    expect(out.groups).toHaveLength(1)
    expect(out.tabs).toEqual(s.tabs)
  })
})

describe('naming', () => {
  it('uses the shared site when the tabs are all on one', () => {
    expect(
      nameForGroup([
        { id: '1', url: 'https://www.github.com/a', title: '', favicon: '' },
        { id: '2', url: 'https://github.com/b', title: '', favicon: '' },
      ]),
    ).toBe('Github')
  })

  it('falls back to the opener title when the sites differ', () => {
    expect(
      nameForGroup(
        [
          { id: '1', url: 'https://a.com/', title: '', favicon: '' },
          { id: '2', url: 'https://b.com/', title: '', favicon: '' },
        ],
        'Best espresso machines 2026',
      ),
    ).toBe('Best espresso machines 2026')
  })

  it('keeps the opener-derived name after a refresh instead of falling back to "Group"', () => {
    // refreshAutoNames runs immediately after creation and has no opener title
    // to work with, so a group spanning several sites recomputed to the generic
    // 'Group' and threw away a perfectly good name. Seen in the app while these
    // tests passed, because none of them looked at the name after a refresh.
    // The opener carries a title in the app — syncNav patches it as soon as the
    // page loads — so the test gives it one too.
    let s0 = initialTabsState('https://news.com/article')
    s0 = tabsReducer(s0, { type: 'patch', id: s0.activeId, patch: { title: 'Espresso machines' } })
    const s = fanOut(s0, s0.activeId, ['https://a.com/', 'https://b.com/'])
    expect(s.groups[0].name).toBe('Espresso machines')
  })

  it('truncates a long opener title rather than breaking the strip', () => {
    const name = nameForGroup(
      [
        { id: '1', url: 'https://a.com/', title: '', favicon: '' },
        { id: '2', url: 'https://b.com/', title: '', favicon: '' },
      ],
      'An extremely long page title that would never fit in a tab strip',
    )
    expect(name.length).toBeLessThanOrEqual(28)
    expect(name.endsWith('…')).toBe(true)
  })

  it('strips www and the tld', () => {
    expect(hostOf('https://www.example.co.uk/x')).toBe('example.co.uk')
  })
})

describe('what a human does wins', () => {
  it('a renamed group is never re-named automatically', () => {
    const s0 = initialTabsState('https://news.com/')
    let s = fanOut(s0, s0.activeId, ['https://a.com/', 'https://b.com/'])
    s = tabsReducer(s, { type: 'renameGroup', id: s.groups[0].id, name: 'Hiring' })
    expect(s.groups[0].name).toBe('Hiring')
    expect(s.groups[0].auto).toBe(false)

    // Adding another tab must not overwrite it.
    s = fanOut(s, s0.activeId, ['https://c.com/'])
    expect(s.groups[0].name).toBe('Hiring')
  })

  it('ignores an empty rename rather than clearing the label', () => {
    const s0 = initialTabsState('https://news.com/')
    let s = fanOut(s0, s0.activeId, ['https://a.com/', 'https://b.com/'])
    const before = s.groups[0].name
    s = tabsReducer(s, { type: 'renameGroup', id: s.groups[0].id, name: '   ' })
    expect(s.groups[0].name).toBe(before)
  })

  it('can be collapsed and expanded', () => {
    const s0 = initialTabsState('https://news.com/')
    let s = fanOut(s0, s0.activeId, ['https://a.com/', 'https://b.com/'])
    s = tabsReducer(s, { type: 'toggleGroup', id: s.groups[0].id })
    expect(s.groups[0].collapsed).toBe(true)
    s = tabsReducer(s, { type: 'toggleGroup', id: s.groups[0].id })
    expect(s.groups[0].collapsed).toBe(false)
  })

  it('can be dissolved without closing its tabs', () => {
    const s0 = initialTabsState('https://news.com/')
    let s = fanOut(s0, s0.activeId, ['https://a.com/', 'https://b.com/'])
    const n = s.tabs.length
    s = tabsReducer(s, { type: 'ungroup', id: s.groups[0].id })
    expect(s.groups).toHaveLength(0)
    expect(s.tabs).toHaveLength(n)
  })
})
