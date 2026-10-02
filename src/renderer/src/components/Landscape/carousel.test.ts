import { describe, it, expect } from 'vitest'
import { classifyWheel, easeToward, flickTarget } from './carousel'
import { FRONT_VISIBLE, scrollRange } from './layoutModel'

describe('classifyWheel', () => {
  it('leaves pinch-zoom alone', () => {
    expect(classifyWheel({ deltaX: 0, deltaY: 30, deltaMode: 0, ctrlKey: true })).toEqual({ kind: 'ignore' })
  })

  it('treats line-mode wheels and big integer steps as notches', () => {
    expect(classifyWheel({ deltaX: 0, deltaY: 3, deltaMode: 1 })).toEqual({ kind: 'notch', dir: 1 })
    expect(classifyWheel({ deltaX: 0, deltaY: -100, deltaMode: 0 })).toEqual({ kind: 'notch', dir: -1 })
  })

  it('glides a trackpad, capped per event', () => {
    const g = classifyWheel({ deltaX: 12.5, deltaY: 1, deltaMode: 0 })
    expect(g.kind).toBe('glide')
    if (g.kind === 'glide') expect(g.delta).toBeCloseTo(12.5 / 420)
    const big = classifyWheel({ deltaX: 900.5, deltaY: 0, deltaMode: 0 })
    if (big.kind === 'glide') expect(big.delta).toBe(0.6)
  })

  it('ignores a zero delta', () => {
    expect(classifyWheel({ deltaX: 0, deltaY: 0, deltaMode: 0 })).toEqual({ kind: 'ignore' })
  })
})

describe('easeToward', () => {
  it('moves part of the way each frame and lands exactly', () => {
    let cur = 0
    for (let i = 0; i < 120; i++) cur = easeToward(cur, 1, 1 / 60)
    expect(cur).toBe(1)
    expect(easeToward(0, 1, 1 / 60)).toBeGreaterThan(0)
    expect(easeToward(0, 1, 1 / 60)).toBeLessThan(1)
  })

  it('is frame-rate independent', () => {
    let a = 0
    let b = 0
    for (let i = 0; i < 4; i++) a = easeToward(a, 1, 1 / 120)
    for (let i = 0; i < 2; i++) b = easeToward(b, 1, 1 / 60)
    expect(a).toBeCloseTo(b, 6)
  })

  it('jumps when reduced motion is on', () => {
    expect(easeToward(0, 3, 1 / 60, true)).toBe(3)
  })
})

describe('flickTarget', () => {
  const n = FRONT_VISIBLE + 4
  it('rests on a whole screen, carried by the flick', () => {
    expect(flickTarget(0.2, 0, n)).toBe(0)
    expect(flickTarget(0.2, -1, n)).toBe(2) // flicked left → moves right
  })

  it('never rests beyond the ends', () => {
    expect(flickTarget(0, -100, n)).toBe(scrollRange(n).max)
  })
})
