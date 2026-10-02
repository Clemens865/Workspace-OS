import { describe, expect, it } from 'vitest'
import { relPath, searchFiles, shelves } from './libraryModel'

describe('searchFiles', () => {
  const names = ['/w/Budget 2026.xlsx', '/w/notes/budget-ideas.md', '/w/Pilot/plan.docx', '/w/archive/old.txt']

  it('matches every word of the query, in any order, names before folders', () => {
    expect(searchFiles('budget', names, []).map((f) => f.name)).toEqual(['Budget 2026.xlsx', 'budget-ideas.md'])
    expect(searchFiles('pilot plan', names, []).map((f) => f.name)).toEqual(['plan.docx'])
    expect(searchFiles('2026 budget', names, []).map((f) => f.name)).toEqual(['Budget 2026.xlsx'])
  })

  it('adds content matches after name matches, once per path', () => {
    const r = searchFiles('budget', names, [
      { path: '/w/archive/old.txt', snippet: 'the budget was…' },
      { path: '/w/Budget 2026.xlsx', snippet: 'dup' },
    ])
    expect(r.map((f) => [f.name, f.why])).toEqual([
      ['Budget 2026.xlsx', 'name'],
      ['budget-ideas.md', 'name'],
      ['old.txt', 'content'],
    ])
    expect(r[2].snippet).toBe('the budget was…')
  })

  it('an empty query finds nothing', () => {
    expect(searchFiles('   ', names, [])).toEqual([])
  })
})

describe('shelves', () => {
  it('new, opened, starred, without repeating a file, empty shelves left out', () => {
    const s = shelves([{ path: '/w/a.md', at: 2 }], [{ path: '/w/a.md', ts: 9 }, { path: '/w/b.md', ts: 3 }], ['/w/b.md'])
    expect(s.map((x) => [x.title, x.files.map((f) => f.name)])).toEqual([
      ['New', ['a.md']],
      ['Opened recently', ['b.md']],
    ])
  })
})

describe('relPath', () => {
  it('shows a path inside the workspace relative to it', () => {
    expect(relPath('/w/Pilot/plan.docx', '/w')).toBe('Pilot/plan.docx')
    expect(relPath('/elsewhere/x', '/w')).toBe('/elsewhere/x')
  })
})
