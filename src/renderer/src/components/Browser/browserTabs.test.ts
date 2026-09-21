import { describe, it, expect } from 'vitest'
import {
  tabsReducer,
  initialTabsState,
  activeTab,
  newTabId,
  type BrowserTabsState,
} from './browserTabs'

describe('browser tab-model reducer', () => {
  it('starts with exactly one active tab', () => {
    const s = initialTabsState()
    expect(s.tabs).toHaveLength(1)
    expect(s.activeId).toBe(s.tabs[0].id)
    expect(activeTab(s).url).toBe('')
  })

  it('initial state can open at a url', () => {
    const s = initialTabsState('https://example.com/')
    expect(activeTab(s).url).toBe('https://example.com/')
  })

  it('mints stable, unique tab ids', () => {
    const ids = new Set([newTabId(), newTabId(), newTabId()])
    expect(ids.size).toBe(3)
  })

  it('add appends a tab and activates it', () => {
    const s0 = initialTabsState()
    const s1 = tabsReducer(s0, { type: 'add' })
    expect(s1.tabs).toHaveLength(2)
    expect(s1.activeId).toBe(s1.tabs[1].id)
    expect(activeTab(s1).url).toBe('') // a blank start tab
  })

  it('add can open at a url', () => {
    const s = tabsReducer(initialTabsState(), { type: 'add', url: 'https://a.test/' })
    expect(activeTab(s).url).toBe('https://a.test/')
  })

  it('activate switches the active tab', () => {
    const s0 = tabsReducer(initialTabsState(), { type: 'add' })
    const firstId = s0.tabs[0].id
    const s1 = tabsReducer(s0, { type: 'activate', id: firstId })
    expect(s1.activeId).toBe(firstId)
    // tabs order/identity are preserved
    expect(s1.tabs).toEqual(s0.tabs)
  })

  it('activate on an unknown id is a no-op', () => {
    const s0 = initialTabsState()
    const s1 = tabsReducer(s0, { type: 'activate', id: 'nope' })
    expect(s1).toBe(s0)
  })

  it('patch updates title/url/favicon of one tab', () => {
    const s0 = initialTabsState()
    const id = s0.tabs[0].id
    const s1 = tabsReducer(s0, {
      type: 'patch',
      id,
      patch: { url: 'https://x.test/', title: 'X', favicon: 'https://x.test/f.ico' },
    })
    const t = s1.tabs[0]
    expect(t.id).toBe(id) // id is immutable
    expect(t.url).toBe('https://x.test/')
    expect(t.title).toBe('X')
    expect(t.favicon).toBe('https://x.test/f.ico')
  })

  it('patch on an unknown id is a no-op', () => {
    const s0 = initialTabsState()
    const s1 = tabsReducer(s0, { type: 'patch', id: 'nope', patch: { title: 'Y' } })
    expect(s1).toBe(s0)
  })

  it('closing an inactive tab leaves the active one alone', () => {
    let s: BrowserTabsState = initialTabsState() // tab A (active)
    s = tabsReducer(s, { type: 'add' }) // tab B (active)
    const a = s.tabs[0].id
    const b = s.tabs[1].id
    s = tabsReducer(s, { type: 'close', id: a })
    expect(s.tabs).toHaveLength(1)
    expect(s.activeId).toBe(b)
  })

  it('closing the active tab activates the RIGHT neighbour', () => {
    let s: BrowserTabsState = initialTabsState() // A
    s = tabsReducer(s, { type: 'add' }) // B
    s = tabsReducer(s, { type: 'add' }) // C
    const [a, b, c] = s.tabs.map((t) => t.id)
    s = tabsReducer(s, { type: 'activate', id: b })
    s = tabsReducer(s, { type: 'close', id: b })
    expect(s.tabs.map((t) => t.id)).toEqual([a, c])
    expect(s.activeId).toBe(c) // right neighbour
  })

  it('closing the last (rightmost) active tab activates the LEFT neighbour', () => {
    let s: BrowserTabsState = initialTabsState() // A
    s = tabsReducer(s, { type: 'add' }) // B (active, rightmost)
    const a = s.tabs[0].id
    s = tabsReducer(s, { type: 'close', id: s.activeId })
    expect(s.tabs.map((t) => t.id)).toEqual([a])
    expect(s.activeId).toBe(a)
  })

  it('closing the only tab yields a fresh blank tab (never zero tabs)', () => {
    const s0 = initialTabsState('https://gone.test/')
    const s1 = tabsReducer(s0, { type: 'close', id: s0.activeId })
    expect(s1.tabs).toHaveLength(1)
    expect(s1.activeId).toBe(s1.tabs[0].id)
    expect(s1.tabs[0].id).not.toBe(s0.tabs[0].id) // a genuinely new tab
    expect(s1.tabs[0].url).toBe('') // blank/start
  })

  it('closing an unknown id is a no-op', () => {
    const s0 = initialTabsState()
    const s1 = tabsReducer(s0, { type: 'close', id: 'nope' })
    expect(s1).toBe(s0)
  })
})
