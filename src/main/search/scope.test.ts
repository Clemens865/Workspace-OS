import { describe, expect, it } from 'vitest'
import { inRoot, scopeByPath, scopeGraph, stubsOf } from './scope'

describe('inRoot', () => {
  it('accepts the root and what lies in it, nothing else', () => {
    expect(inRoot('/w', '/w')).toBe(true)
    expect(inRoot('/w/a/b.md', '/w')).toBe(true)
    expect(inRoot('/w2/b.md', '/w')).toBe(false) // a sibling with the same prefix
    expect(inRoot('/w/../x/b.md', '/w')).toBe(false)
    expect(inRoot('/w/a.md', null)).toBe(false)
  })
})

describe('scopeByPath', () => {
  it('keeps results from the open workspace only', () => {
    const r = [{ path: '/w/a.md' }, { path: '/other/b.md' }, { path: '/w/sub/c.md' }]
    expect(scopeByPath(r, '/w', (x) => x.path).map((x) => x.path)).toEqual(['/w/a.md', '/w/sub/c.md'])
    expect(scopeByPath(r, null, (x) => x.path)).toEqual([])
  })
})

describe('scopeGraph', () => {
  const g = {
    truncated: false,
    nodes: [
      { id: '/w/a.md', name: 'a', kind: 'note' as const, degree: 3 },
      { id: '/w/b.md', name: 'b', kind: 'note' as const, degree: 2 },
      { id: '/other/x.md', name: 'x', kind: 'note' as const, degree: 2 },
      { id: 'stub:risks', name: 'Risks', kind: 'stub' as const, degree: 2 },
      { id: 'stub:elsewhere', name: 'Elsewhere', kind: 'stub' as const, degree: 1 },
    ],
    edges: [
      { source: '/w/a.md', target: '/w/b.md', count: 1 },
      { source: '/w/a.md', target: 'stub:risks', count: 1 },
      { source: '/other/x.md', target: 'stub:risks', count: 1 },
      { source: '/other/x.md', target: 'stub:elsewhere', count: 1 },
      { source: '/other/x.md', target: '/w/a.md', count: 1 },
    ],
  }

  it('keeps this workspace’s notes, their links and the stubs they reference', () => {
    const s = scopeGraph(g, '/w')
    expect(s.nodes.map((n) => n.id)).toEqual(['/w/a.md', '/w/b.md', 'stub:risks'])
    expect(s.edges).toHaveLength(2)
  })

  it('counts degrees again over what is left', () => {
    const s = scopeGraph(g, '/w')
    expect(Object.fromEntries(s.nodes.map((n) => [n.id, n.degree]))).toEqual({ '/w/a.md': 2, '/w/b.md': 1, 'stub:risks': 1 })
  })

  it('stubsOf lists the stubs of the scoped graph', () => {
    expect(stubsOf(scopeGraph(g, '/w'))).toEqual([{ targetName: 'Risks', refCount: 1 }])
  })

  it('no workspace, no graph', () => {
    expect(scopeGraph(g, null).nodes).toEqual([])
  })
})
