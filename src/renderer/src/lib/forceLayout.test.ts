import { describe, it, expect } from 'vitest'
import { initLayout, step, layout, type LayoutEdge } from './forceLayout'

const nodes = (ids: string[], deg = 1): { id: string; degree: number }[] =>
  ids.map((id) => ({ id, degree: deg }))

describe('forceLayout', () => {
  it('is deterministic given the same seed', () => {
    const ns = nodes(['a', 'b', 'c', 'd'])
    const es: LayoutEdge[] = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ]
    const r1 = layout(ns, es, { seed: 7 })
    const r2 = layout(ns, es, { seed: 7 })
    expect(r1.map((n) => [n.x, n.y])).toEqual(r2.map((n) => [n.x, n.y]))
  })

  it('produces finite, distinct positions (no NaN / collapse)', () => {
    const ns = nodes(['a', 'b', 'c', 'd', 'e'])
    const es: LayoutEdge[] = [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'a', target: 'd' },
      { source: 'a', target: 'e' },
    ]
    const out = layout(ns, es, { seed: 1 })
    for (const n of out) {
      expect(Number.isFinite(n.x)).toBe(true)
      expect(Number.isFinite(n.y)).toBe(true)
    }
    // All node positions are distinct (repulsion separated them).
    const keys = new Set(out.map((n) => `${n.x.toFixed(3)},${n.y.toFixed(3)}`))
    expect(keys.size).toBe(out.length)
  })

  it('converges — kinetic energy decreases over the run', () => {
    const ns = nodes(['a', 'b', 'c'])
    const es: LayoutEdge[] = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ]
    const sim = initLayout(ns, es, { seed: 3 })
    const early = step(sim.nodes, sim.edges, sim.options)
    for (let i = 0; i < 200; i++) step(sim.nodes, sim.edges, sim.options)
    const late = step(sim.nodes, sim.edges, sim.options)
    expect(late).toBeLessThan(early)
    expect(late).toBeLessThan(1)
  })

  it('handles a single node without error', () => {
    const out = layout(nodes(['solo']), [], { seed: 1 })
    expect(out).toHaveLength(1)
    expect(Number.isFinite(out[0].x)).toBe(true)
  })

  it('drops edges referencing unknown nodes', () => {
    const sim = initLayout(nodes(['a', 'b']), [{ source: 'a', target: 'zzz' }], {})
    expect(sim.edges).toHaveLength(0)
  })
})
