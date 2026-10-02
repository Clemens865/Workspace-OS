import { describe, it, expect } from 'vitest'
import {
  STAGE_W,
  FRONT_VISIBLE,
  FOCUS_FRAME,
  arc,
  awayLayout,
  clampScroll,
  flankLayout,
  focusLayout,
  overviewLayout,
  scrollRange,
  stageScale,
  type Layout,
} from './layoutModel'

const ids = (n: number, p = 'a'): string[] => Array.from({ length: n }, (_, i) => `${p}${i}`)

describe('arc', () => {
  it('centres an odd row and mirrors it', () => {
    const L: Layout = {}
    arc(L, ids(5), 0, { R: 2000, step: 0.125, w: 200, h: 200, y: 400, z0: 0, depth: 0.2, turn: 0.6, sag: 1, vis: 3, glass: 0, delay: 0 })
    expect(L.a2.x + L.a2.w / 2).toBeCloseTo(STAGE_W / 2)
    expect(L.a2.ry).toBeCloseTo(0)
    expect(L.a0.x + L.a0.w / 2 - STAGE_W / 2).toBeCloseTo(-(L.a4.x + L.a4.w / 2 - STAGE_W / 2))
    expect(L.a0.ry).toBeCloseTo(-L.a4.ry)
  })

  it('pushes the edges back and turns them toward the viewer', () => {
    const L = overviewLayout(ids(7), [], 0)
    expect(L.a0.z).toBeGreaterThan(L.a3.z) // the inside of a cylinder comes toward the viewer
    expect(L.a0.ry).toBeGreaterThan(0)
    expect(L.a6.ry).toBeLessThan(0)
  })

  it('fades screens beyond the visible span', () => {
    const L = overviewLayout(ids(15), [], 0)
    expect(L.a7.op).toBe(1)
    expect(L.a0.op).toBe(0)
  })
})

describe('carousel range', () => {
  it('has nothing to scroll for a small team', () => {
    expect(scrollRange(3)).toEqual({ min: 0, max: 0 })
    expect(scrollRange(FRONT_VISIBLE)).toEqual({ min: 0, max: 0 })
  })

  it('lets a long row travel until its ends are in view', () => {
    const r = scrollRange(FRONT_VISIBLE + 4)
    expect(r.max - r.min).toBe(4)
    expect(clampScroll(99, FRONT_VISIBLE + 4)).toBe(r.max)
    expect(clampScroll(-99, FRONT_VISIBLE + 4, 0.3)).toBeCloseTo(r.min - 0.3)
  })

  it('scrolling moves the front faster than the back (parallax)', () => {
    const a = overviewLayout(ids(9), ids(9, 'b'), 0)
    const b = overviewLayout(ids(9), ids(9, 'b'), 1)
    const front = Math.abs(b.a4.x - a.a4.x)
    const back = Math.abs(b.b4.x - a.b4.x)
    expect(front).toBeGreaterThan(back)
  })

  it('a scrolling row moves without the wave delay', () => {
    const L = overviewLayout(ids(9), [], 0, true)
    expect(Object.values(L).every((p) => p.delay === 0)).toBe(true)
  })
})

describe('focus', () => {
  const front = ids(6)
  const all = [...front, ...ids(4, 'b')]

  it('brings one screen into the focus frame, upright, on top', () => {
    const L = focusLayout(front, all, 'a2')
    expect(L.a2).toMatchObject({ ...FOCUS_FRAME, ry: 0, op: 1 })
    expect(L.a2.zi).toBeGreaterThan(1000)
  })

  it('flanks it with its ring neighbours and hides the rest', () => {
    const L = flankLayout(front, all, 'a2')
    expect(L.a1.side).toBe(true) // left neighbour
    expect(L.a3.side).toBe(true) // right neighbour
    expect(L.b0.op).toBe(0)
  })

  it('places every screen exactly once', () => {
    const L = focusLayout(front, all, 'a0')
    expect(Object.keys(L).sort()).toEqual([...all].sort())
  })

  it('survives a team of one', () => {
    const L = focusLayout(['solo'], ['solo'], 'solo')
    expect(L.solo.zi).toBeGreaterThan(0)
  })
})

describe('away and scale', () => {
  it('recedes everything into the mist', () => {
    const L = awayLayout(ids(3), ids(2, 'b'), 0)
    expect(Object.values(L).every((p) => p.op === 0 && p.z <= -1300)).toBe(true)
  })

  it('letterboxes the 1600 × 900 stage into the window', () => {
    expect(stageScale(1600, 900)).toBe(1)
    expect(stageScale(3200, 900)).toBe(1)
    expect(stageScale(800, 900)).toBe(0.5)
  })
})
