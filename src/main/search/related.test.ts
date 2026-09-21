import { describe, it, expect } from 'vitest'
import { scoreRelated, type RelatedEdge } from './related'

/** Build the resolved edge set from `source → target` string pairs. */
function edges(...pairs: Array<[string, string]>): RelatedEdge[] {
  return pairs.map(([source, target]) => ({ source, target }))
}

describe('scoreRelated', () => {
  it('ranks a directly-linked note high', () => {
    // A → B (direct). C only shares nothing → excluded.
    const r = scoreRelated(edges(['A', 'B'], ['C', 'D']), 'A')
    expect(r.map((n) => n.path)).toEqual(['B'])
    expect(r[0].reasons.direct).toBe(true)
    expect(r[0].score).toBe(3)
  })

  it('counts a backlink (B → A) as a direct relation too', () => {
    const r = scoreRelated(edges(['B', 'A']), 'A')
    expect(r[0].path).toBe('B')
    expect(r[0].reasons.direct).toBe(true)
  })

  it('bibliographic coupling: more shared targets ranks higher', () => {
    // A→{X,Y}, B→{X,Y} (2 shared), C→{X} (1 shared). B outranks C.
    const r = scoreRelated(
      edges(['A', 'X'], ['A', 'Y'], ['B', 'X'], ['B', 'Y'], ['C', 'X']),
      'A',
    )
    const b = r.find((n) => n.path === 'B')!
    const c = r.find((n) => n.path === 'C')!
    expect(b.reasons.coupling).toBe(2)
    expect(c.reasons.coupling).toBe(1)
    expect(b.score).toBeGreaterThan(c.score)
    expect(r.findIndex((n) => n.path === 'B')).toBeLessThan(
      r.findIndex((n) => n.path === 'C'),
    )
  })

  it('co-citation: more shared citers ranks higher', () => {
    // {P,Q}→A and {P,Q}→B (2 shared citers), {P}→C (1). B outranks C.
    const r = scoreRelated(
      edges(['P', 'A'], ['Q', 'A'], ['P', 'B'], ['Q', 'B'], ['P', 'C']),
      'A',
    )
    const b = r.find((n) => n.path === 'B')!
    const c = r.find((n) => n.path === 'C')!
    expect(b.reasons.cocitation).toBe(2)
    expect(c.reasons.cocitation).toBe(1)
    expect(b.score).toBeGreaterThan(c.score)
    expect(r.findIndex((n) => n.path === 'B')).toBeLessThan(
      r.findIndex((n) => n.path === 'C'),
    )
  })

  it('combines signals into a weighted score', () => {
    // A→B direct (3) + A→X,B→X coupling (2) + Y→A,Y→B cocitation (2) = 7.
    const r = scoreRelated(
      edges(['A', 'B'], ['A', 'X'], ['B', 'X'], ['Y', 'A'], ['Y', 'B']),
      'A',
    )
    expect(r[0].path).toBe('B')
    expect(r[0].score).toBe(3 + 2 + 2)
    expect(r[0].reasons).toEqual({ direct: true, coupling: 1, cocitation: 1 })
  })

  it('tie-breaks equal scores deterministically by name', () => {
    // A citer S links A, Zed and Abe → Zed/Abe each co-cite with A once (equal
    // score, no direct link). Abe sorts before Zed by name. S also scores (it
    // couples with A via nothing, but S→A makes S a direct backlink) — so
    // filter to the two tied notes to assert the tie-break.
    const r = scoreRelated(edges(['S', 'A'], ['S', 'Zed'], ['S', 'Abe']), 'A')
    const tied = r.filter((n) => n.path === 'Abe' || n.path === 'Zed')
    expect(tied.map((n) => n.path)).toEqual(['Abe', 'Zed'])
    expect(tied[0].score).toBe(tied[1].score)
  })

  it('excludes A itself, stubs, and zero-relation notes', () => {
    // A links B (direct). A also self-loops (ignored). D is unrelated. Stubs
    // never reach here (edges only carry resolved note→note pairs).
    const r = scoreRelated(edges(['A', 'B'], ['A', 'A'], ['D', 'E']), 'A')
    const paths = r.map((n) => n.path)
    expect(paths).toContain('B')
    expect(paths).not.toContain('A')
    expect(paths).not.toContain('D')
    expect(paths).not.toContain('E')
  })

  it('caps the result at the limit', () => {
    // Ten distinct notes each couple with A via X → limit trims to 3.
    const pairs: Array<[string, string]> = [['A', 'X']]
    for (let i = 0; i < 10; i++) pairs.push([`n${i}`, 'X'])
    const r = scoreRelated(edges(...pairs), 'A', 3)
    expect(r).toHaveLength(3)
  })

  it('uses the nameOf mapper for display labels', () => {
    const r = scoreRelated(edges(['A', '/ws/B.md']), 'A', 10, () => 'Beta')
    expect(r[0].name).toBe('Beta')
    expect(r[0].path).toBe('/ws/B.md')
  })
})
