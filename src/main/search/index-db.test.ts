import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { SearchIndex } from './index-db'

describe('SearchIndex', () => {
  let dbPath: string
  let index: SearchIndex

  beforeEach(() => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wos-idx-')), 'index.db')
    index = new SearchIndex(dbPath)
  })

  afterEach(() => {
    index.close()
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
  })

  const doc = (p: string, name: string, content: string) =>
    index.upsert({ path: p, name, ext: 'docx', mtimeMs: 1, content })

  it('finds a document by its content', () => {
    doc('/ws/q3.docx', 'q3.docx', 'The marketing budget increased by 20 percent in Q3.')
    const results = index.query('budget')
    expect(results).toHaveLength(1)
    expect(results[0].path).toBe('/ws/q3.docx')
    expect(results[0].matchType).toBe('content')
  })

  it('scopes a query to one workspace before the limit (ADOPTION.md B4)', () => {
    // Other workspaces flood the index with the same word…
    for (let i = 0; i < 5; i++) doc(`/other/f${i}.docx`, `f${i}.docx`, 'allocation allocation allocation')
    doc('/ws/budget.docx', 'budget.docx', 'the allocation')
    doc('/ws_sibling/x.docx', 'x.docx', 'allocation')
    // …so an unscoped top-3 never reaches this workspace's file.
    expect(index.query('allocation', 3).some((r) => r.path === '/ws/budget.docx')).toBe(false)
    const scoped = index.query('allocation', 3, ['/ws'])
    expect(scoped.map((r) => r.path)).toEqual(['/ws/budget.docx'])
  })

  it('finds a document by filename', () => {
    doc('/ws/proposal.docx', 'proposal.docx', 'unrelated text')
    const results = index.query('proposal')
    expect(results[0].matchType).toBe('filename')
  })

  it('supports prefix (as-you-type) matching', () => {
    doc('/ws/a.docx', 'a.docx', 'quarterly forecast numbers')
    expect(index.query('forecas').length).toBe(1)
    expect(index.query('quar').length).toBe(1)
  })

  it('ranks and returns a snippet around the match', () => {
    doc('/ws/long.docx', 'long.docx', 'lorem ipsum '.repeat(50) + ' the secret keyword here ' + 'dolor '.repeat(50))
    const [r] = index.query('secret')
    expect(r.snippet).toContain('secret')
  })

  it('updates content on re-upsert (no duplicates)', () => {
    doc('/ws/a.docx', 'a.docx', 'first version about apples')
    doc('/ws/a.docx', 'a.docx', 'second version about oranges')
    expect(index.query('apples')).toHaveLength(0)
    expect(index.query('oranges')).toHaveLength(1)
  })

  it('removes a file from the index', () => {
    doc('/ws/a.docx', 'a.docx', 'findable content')
    index.remove('/ws/a.docx')
    expect(index.query('findable')).toHaveLength(0)
    expect(index.stats().indexed).toBe(0)
  })

  it('tracks mtime for incremental skip', () => {
    index.upsert({ path: '/ws/a.txt', name: 'a.txt', ext: 'txt', mtimeMs: 1234, content: 'x' })
    expect(index.getMtime('/ws/a.txt')).toBe(1234)
    expect(index.getMtime('/ws/missing.txt')).toBeNull()
  })

  it('ignores special FTS characters in the query', () => {
    doc('/ws/a.docx', 'a.docx', 'normal content here')
    expect(() => index.query('content" OR (')).not.toThrow()
  })

  it('returns empty for a blank query', () => {
    doc('/ws/a.docx', 'a.docx', 'content')
    expect(index.query('   ')).toHaveLength(0)
  })

  it('stores and searches structural symbols', () => {
    index.setSymbols('/ws/app.ts', [
      { name: 'createServer', kind: 'function', line: 3 },
      { name: 'Server', kind: 'class', line: 10 },
    ])
    const hits = index.searchSymbols('serv')
    expect(hits.map((h) => h.name).sort()).toEqual(['Server', 'createServer'])
    // Prefix match ranks ahead of a mid-string match.
    expect(index.searchSymbols('server')[0].name).toBe('Server')
  })

  it('replaces symbols on re-index and clears them on remove', () => {
    index.setSymbols('/ws/app.ts', [{ name: 'oldFn', kind: 'function', line: 1 }])
    index.setSymbols('/ws/app.ts', [{ name: 'newFn', kind: 'function', line: 1 }])
    expect(index.searchSymbols('oldFn')).toHaveLength(0)
    expect(index.searchSymbols('newFn')).toHaveLength(1)
    index.remove('/ws/app.ts')
    expect(index.searchSymbols('newFn')).toHaveLength(0)
  })

  // ── Wikilink / backlink index ──────────────────────────────────────────────
  describe('links', () => {
    const note = (p: string, content = '') =>
      index.upsert({ path: p, name: p.split('/').pop()!, ext: 'md', mtimeMs: 1, content })

    it('records backlinks with the linking snippet', () => {
      note('/ws/A.md')
      note('/ws/B.md')
      index.setLinks('/ws/A.md', [
        { targetName: 'B', position: 5, snippet: 'see [[B]] for more' },
      ])
      const back = index.backlinksFor('/ws/B.md')
      expect(back).toHaveLength(1)
      expect(back[0].path).toBe('/ws/A.md')
      expect(back[0].name).toBe('A.md')
      expect(back[0].snippet).toBe('see [[B]] for more')
    })

    it('reports outgoing links as resolved or stub', () => {
      note('/ws/A.md')
      note('/ws/B.md')
      index.setLinks('/ws/A.md', [
        { targetName: 'B', position: 0, snippet: '[[B]]' },
        { targetName: 'Ghost', position: 10, snippet: '[[Ghost]]' },
      ])
      const out = index.outgoingLinks('/ws/A.md')
      expect(out).toHaveLength(2)
      const b = out.find((o) => o.targetName === 'B')!
      const g = out.find((o) => o.targetName === 'Ghost')!
      expect(b.resolvedPath).toBe('/ws/B.md')
      expect(g.resolvedPath).toBeNull()
    })

    it('lists stubs with a reference count', () => {
      note('/ws/A.md')
      note('/ws/C.md')
      index.setLinks('/ws/A.md', [{ targetName: 'Ghost', position: 0, snippet: '[[Ghost]]' }])
      index.setLinks('/ws/C.md', [{ targetName: 'Ghost', position: 0, snippet: '[[Ghost]]' }])
      const stubs = index.stubs()
      expect(stubs).toHaveLength(1)
      expect(stubs[0].targetName).toBe('Ghost')
      expect(stubs[0].refCount).toBe(2)
    })

    it('re-resolves a stub when a matching file is later indexed', () => {
      note('/ws/A.md')
      index.setLinks('/ws/A.md', [{ targetName: 'Ghost', position: 0, snippet: '[[Ghost]]' }])
      expect(index.outgoingLinks('/ws/A.md')[0].resolvedPath).toBeNull()
      expect(index.stubs()).toHaveLength(1)

      // A file named Ghost appears → the stub becomes a live link, no re-index of A.
      note('/ws/Ghost.md')
      expect(index.outgoingLinks('/ws/A.md')[0].resolvedPath).toBe('/ws/Ghost.md')
      expect(index.stubs()).toHaveLength(0)
      expect(index.backlinksFor('/ws/Ghost.md')).toHaveLength(1)
    })

    it('resolves case-insensitively by basename-without-extension', () => {
      note('/ws/MyNote.md')
      index.setLinks('/ws/A.md', [{ targetName: 'mynote', position: 0, snippet: '[[mynote]]' }])
      // (A wasn't a file, but links can be recorded regardless.)
      expect(index.resolveName('MYNOTE')).toBe('/ws/MyNote.md')
      expect(index.outgoingLinks('/ws/A.md')[0].resolvedPath).toBe('/ws/MyNote.md')
    })

    it('marks an ambiguous target and picks deterministically', () => {
      note('/ws/z/Dup.md')
      note('/ws/a/Dup.md')
      index.setLinks('/ws/src.md', [{ targetName: 'Dup', position: 0, snippet: '[[Dup]]' }])
      const [out] = index.outgoingLinks('/ws/src.md')
      // Alphabetically-first path wins deterministically.
      expect(out.resolvedPath).toBe('/ws/a/Dup.md')
      expect(out.ambiguous).toBe(true)
    })

    it('replaces links on re-index and clears them on remove', () => {
      note('/ws/A.md')
      note('/ws/B.md')
      index.setLinks('/ws/A.md', [{ targetName: 'B', position: 0, snippet: '[[B]]' }])
      expect(index.backlinksFor('/ws/B.md')).toHaveLength(1)
      // Re-index A with no links → backlink gone.
      index.setLinks('/ws/A.md', [])
      expect(index.backlinksFor('/ws/B.md')).toHaveLength(0)
      // A link, then removing the source file, clears it too.
      index.setLinks('/ws/A.md', [{ targetName: 'B', position: 0, snippet: '[[B]]' }])
      index.remove('/ws/A.md')
      expect(index.backlinksFor('/ws/B.md')).toHaveLength(0)
    })

    it('demotes a resolved link back to a stub when its target is removed', () => {
      note('/ws/A.md')
      note('/ws/B.md')
      index.setLinks('/ws/A.md', [{ targetName: 'B', position: 0, snippet: '[[B]]' }])
      index.remove('/ws/B.md')
      expect(index.outgoingLinks('/ws/A.md')[0].resolvedPath).toBeNull()
      expect(index.stubs().map((s) => s.targetName)).toContain('B')
    })
  })

  // ── Knowledge graph model (graph()) ─────────────────────────────────────────
  describe('graph', () => {
    const note = (p: string, content = '') =>
      index.upsert({ path: p, name: p.split('/').pop()!, ext: 'md', mtimeMs: 1, content })

    it('builds nodes (notes + stub), edges, and correct degrees', () => {
      // A → [[B]], B → [[C]], A → [[Ghost]] (Ghost is unresolved).
      note('/ws/A.md')
      note('/ws/B.md')
      note('/ws/C.md')
      index.setLinks('/ws/A.md', [
        { targetName: 'B', position: 0, snippet: '[[B]]' },
        { targetName: 'Ghost', position: 5, snippet: '[[Ghost]]' },
      ])
      index.setLinks('/ws/B.md', [{ targetName: 'C', position: 0, snippet: '[[C]]' }])

      const g = index.graph()
      expect(g.truncated).toBe(false)

      // Nodes: A, B, C (notes) + Ghost (stub).
      const byId = new Map(g.nodes.map((n) => [n.id, n]))
      expect(byId.get('/ws/A.md')?.kind).toBe('note')
      expect(byId.get('/ws/B.md')?.kind).toBe('note')
      expect(byId.get('/ws/C.md')?.kind).toBe('note')
      const ghost = g.nodes.find((n) => n.kind === 'stub')!
      expect(ghost.id).toBe('stub:ghost')
      expect(ghost.name).toBe('Ghost')

      // Edges: A→B, B→C, A→Ghost-stub (order-independent).
      const edgeSet = new Set(g.edges.map((e) => `${e.source}=>${e.target}`))
      expect(edgeSet).toEqual(
        new Set(['/ws/A.md=>/ws/B.md', '/ws/B.md=>/ws/C.md', '/ws/A.md=>stub:ghost']),
      )

      // Degrees (in+out): A=2, B=2, C=1, Ghost=1.
      expect(byId.get('/ws/A.md')?.degree).toBe(2)
      expect(byId.get('/ws/B.md')?.degree).toBe(2)
      expect(byId.get('/ws/C.md')?.degree).toBe(1)
      expect(ghost.degree).toBe(1)
    })

    it('collapses parallel links into one edge with a count', () => {
      note('/ws/A.md')
      note('/ws/B.md')
      index.setLinks('/ws/A.md', [
        { targetName: 'B', position: 0, snippet: 'one [[B]]' },
        { targetName: 'B', position: 20, snippet: 'two [[B]]' },
      ])
      const g = index.graph()
      const ab = g.edges.filter((e) => e.source === '/ws/A.md' && e.target === '/ws/B.md')
      expect(ab).toHaveLength(1)
      expect(ab[0].count).toBe(2)
    })

    it('excludes non-note (non-linkable) file kinds from nodes', () => {
      note('/ws/A.md')
      index.upsert({ path: '/ws/data.xlsx', name: 'data.xlsx', ext: 'xlsx', mtimeMs: 1, content: 'x' })
      const g = index.graph()
      expect(g.nodes.map((n) => n.id)).not.toContain('/ws/data.xlsx')
    })

    it('caps nodes and flips the truncated flag', () => {
      for (let i = 0; i < 5; i++) note(`/ws/n${i}.md`)
      const g = index.graph(3)
      expect(g.nodes.filter((n) => n.kind === 'note')).toHaveLength(3)
      expect(g.truncated).toBe(true)
    })

    it('caps edges and flips the truncated flag', () => {
      note('/ws/A.md')
      note('/ws/B.md')
      note('/ws/C.md')
      note('/ws/D.md')
      index.setLinks('/ws/A.md', [
        { targetName: 'B', position: 0, snippet: '[[B]]' },
        { targetName: 'C', position: 5, snippet: '[[C]]' },
        { targetName: 'D', position: 10, snippet: '[[D]]' },
      ])
      const g = index.graph(2000, 2)
      expect(g.edges).toHaveLength(2)
      expect(g.truncated).toBe(true)
    })
  })

  // ── Related notes (link-graph proximity via relatedNotes) ────────────────────
  describe('relatedNotes', () => {
    const note = (p: string) =>
      index.upsert({ path: p, name: p.split('/').pop()!, ext: 'md', mtimeMs: 1, content: '' })

    it('surfaces direct + coupling + co-citation, ranked, from the resolved edges', () => {
      // A→B (direct) ; A→X, B→X (coupling) ; C→X only (weak coupling) ;
      // D→A, D→B (co-citation for B). Ghost stub is ignored (unresolved).
      for (const p of ['A', 'B', 'C', 'D', 'X']) note(`/ws/${p}.md`)
      index.setLinks('/ws/A.md', [
        { targetName: 'B', position: 0, snippet: '[[B]]' },
        { targetName: 'X', position: 5, snippet: '[[X]]' },
        { targetName: 'Ghost', position: 9, snippet: '[[Ghost]]' },
      ])
      index.setLinks('/ws/B.md', [{ targetName: 'X', position: 0, snippet: '[[X]]' }])
      index.setLinks('/ws/C.md', [{ targetName: 'X', position: 0, snippet: '[[X]]' }])
      index.setLinks('/ws/D.md', [
        { targetName: 'A', position: 0, snippet: '[[A]]' },
        { targetName: 'B', position: 3, snippet: '[[B]]' },
      ])

      const rel = index.relatedNotes('/ws/A.md')
      const paths = rel.map((r) => r.path)
      // B outscores C; A itself and the Ghost stub are excluded.
      expect(paths[0]).toBe('/ws/B.md')
      expect(paths).toContain('/ws/C.md')
      expect(paths).not.toContain('/ws/A.md')
      expect(paths).not.toContain('stub:ghost')
      const b = rel.find((r) => r.path === '/ws/B.md')!
      expect(b.name).toBe('B.md')
      expect(b.reasons.direct).toBe(true)
      expect(b.score).toBeGreaterThan(rel.find((r) => r.path === '/ws/C.md')!.score)
    })

    it('respects the limit', () => {
      note('/ws/A.md')
      note('/ws/X.md')
      const links = [{ targetName: 'X', position: 0, snippet: '[[X]]' }]
      index.setLinks('/ws/A.md', links)
      for (let i = 0; i < 5; i++) {
        note(`/ws/n${i}.md`)
        index.setLinks(`/ws/n${i}.md`, links)
      }
      expect(index.relatedNotes('/ws/A.md', 2)).toHaveLength(2)
    })
  })
})
