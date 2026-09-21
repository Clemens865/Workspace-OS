import { describe, it, expect } from 'vitest'
import { decodeTabSession, loadTabSession, saveTabSession, pruneMissingTabs } from './tabSession'

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

describe('tabSession', () => {
  it('round-trips a saved session for the same root', () => {
    const storage = memoryStorage()
    saveTabSession({ root: '/w', files: ['/w/a.md', '/w/b.md'], activeFile: '/w/b.md' }, storage)
    expect(loadTabSession('/w', storage)).toEqual({
      root: '/w',
      files: ['/w/a.md', '/w/b.md'],
      activeFile: '/w/b.md',
    })
  })

  it('does not restore into a different workspace root', () => {
    const storage = memoryStorage()
    saveTabSession({ root: '/w', files: ['/w/a.md'], activeFile: '/w/a.md' }, storage)
    expect(loadTabSession('/other', storage)).toBeNull()
  })

  it('rejects corrupt or malformed records', () => {
    expect(decodeTabSession(null)).toBeNull()
    expect(decodeTabSession('{not json')).toBeNull()
    expect(decodeTabSession('{"files": "nope"}')).toBeNull()
  })

  it('drops non-string files and repairs a stale activeFile', () => {
    const state = decodeTabSession(
      JSON.stringify({ root: '/w', files: ['/w/a.md', 42, '/w/b.md'], activeFile: '/w/gone.md' })
    )
    expect(state).toEqual({
      root: '/w',
      files: ['/w/a.md', '/w/b.md'],
      // Stale active path falls back to the last (most recently opened) tab.
      activeFile: '/w/b.md',
    })
  })
})

describe('pruneMissingTabs', () => {
  const state = { root: '/w', files: ['/w/a.pptx', '/w/gone.docx', '/w/c.xlsx'], activeFile: '/w/c.xlsx' }

  it('drops tabs whose file no longer exists', () => {
    const r = pruneMissingTabs(state, ['/w/a.pptx', '/w/c.xlsx'])
    expect(r.files).toEqual(['/w/a.pptx', '/w/c.xlsx'])
  })

  it('keeps the active file when it survived', () => {
    expect(pruneMissingTabs(state, ['/w/a.pptx', '/w/c.xlsx']).activeFile).toBe('/w/c.xlsx')
  })

  it('falls back to the last surviving tab when the active one is gone', () => {
    const r = pruneMissingTabs({ ...state, activeFile: '/w/gone.docx' }, ['/w/a.pptx', '/w/c.xlsx'])
    expect(r.activeFile).toBe('/w/c.xlsx')
  })

  it('returns the SAME object when nothing is missing (no needless re-render)', () => {
    expect(pruneMissingTabs(state, state.files)).toBe(state)
  })

  it('prunes everything when the workspace listing is empty', () => {
    // An empty listing is AUTHORITATIVE — the workspace really has no files, so
    // no tab can be valid. "Listing unavailable" is handled by the caller not
    // calling this at all; treating [] as unknown here resurrected dead tabs.
    const r = pruneMissingTabs(state, [])
    expect(r.files).toEqual([])
    expect(r.activeFile).toBeNull()
  })

  it('can empty the tab list when every file is gone', () => {
    const r = pruneMissingTabs(state, ['/w/unrelated.md'])
    expect(r.files).toEqual([])
    expect(r.activeFile).toBeNull()
  })
})
