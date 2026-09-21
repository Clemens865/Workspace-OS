import { describe, it, expect } from 'vitest'
import { toStored, fromStored, isRestorable } from './session-restore'
import { makeTab, type BrowserTabsState } from './browserTabs'

const state = (urls: string[], activeIdx = 0): BrowserTabsState => {
  const tabs = urls.map((u) => ({ ...makeTab(u), title: `T ${u}`, favicon: '' }))
  return { tabs, activeId: tabs[activeIdx].id, groups: [] }
}

describe('what survives a restart', () => {
  it('restores ordinary pages', () => {
    expect(isRestorable('https://a.com/x')).toBe(true)
    expect(isRestorable('http://localhost:3000')).toBe(true)
  })

  it('never restores about:blank — the placeholder every tab mounts at', () => {
    expect(isRestorable('about:blank')).toBe(false)
    expect(isRestorable('')).toBe(false)
  })

  it('never restores file: or data: urls', () => {
    // At best useless on restore, at worst a resurrected surprise.
    expect(isRestorable('file:///etc/passwd')).toBe(false)
    expect(isRestorable('data:text/html,<h1>x')).toBe(false)
  })
})

describe('round trip', () => {
  it('brings back the tabs and the one that was active', () => {
    const s = state(['https://a.com/', 'https://b.com/', 'https://c.com/'], 1)
    const restored = fromStored(toStored(s), makeTab)
    expect(restored?.tabs.map((t) => t.url)).toEqual(['https://a.com/', 'https://b.com/', 'https://c.com/'])
    expect(restored?.tabs.find((t) => t.id === restored.activeId)?.url).toBe('https://b.com/')
  })

  it('keeps titles so the strip is readable before pages load', () => {
    const restored = fromStored(toStored(state(['https://a.com/'])), makeTab)
    expect(restored?.tabs[0].title).toBe('T https://a.com/')
  })

  it('assigns FRESH ids rather than reusing stored ones', () => {
    // Tab ids scope drive calls to a guest. A restored id colliding with a live
    // one would let one tab control another tab's page.
    const s = state(['https://a.com/'])
    const restored = fromStored(toStored(s), makeTab)
    expect(restored?.tabs[0].id).not.toBe(s.tabs[0].id)
  })

  it('drops unrestorable tabs but keeps the rest', () => {
    const s = state(['https://a.com/', 'about:blank', 'https://c.com/'])
    const restored = fromStored(toStored(s), makeTab)
    expect(restored?.tabs.map((t) => t.url)).toEqual(['https://a.com/', 'https://c.com/'])
  })

  it('still has an active tab when the active one was dropped', () => {
    // The stored index can point past the end once tabs are filtered out;
    // a session with no active tab would render nothing.
    const s = state(['https://a.com/', 'about:blank'], 1)
    const restored = fromStored(toStored(s), makeTab)
    expect(restored).not.toBeNull()
    expect(restored?.tabs.some((t) => t.id === restored.activeId)).toBe(true)
  })

  it('stores nothing when every tab is blank', () => {
    expect(toStored(state(['', 'about:blank']))).toBeNull()
  })
})

describe('a corrupt payload never breaks the browser', () => {
  it('returns null rather than throwing', () => {
    for (const bad of [null, undefined, 42, 'nonsense', {}, { v: 1 }, { v: 2, tabs: [] }, { v: 1, tabs: [] }]) {
      expect(fromStored(bad, makeTab)).toBeNull()
    }
  })

  it('ignores malformed tab entries inside an otherwise valid session', () => {
    const restored = fromStored(
      { v: 1, activeIndex: 0, tabs: [{ url: 'https://ok.com/' }, null, { url: 5 }, { nope: true }] },
      makeTab,
    )
    expect(restored?.tabs.map((t) => t.url)).toEqual(['https://ok.com/'])
  })
})
