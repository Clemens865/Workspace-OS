import { describe, it, expect } from 'vitest'
import { ghostSourceRect, rectsIntersect, chooseSettlePlan } from './dragGhost'

/**
 * The drag ghost copies pixels out of the doc canvas. Canvas coordinates are
 * DEVICE px (CSS × dpr) while every overlay rect is CSS px — mixing the two
 * copies the wrong part of the slide, on Retina by exactly a factor of 2, which
 * looks like "the preview shows the neighbouring shape". No engine test can
 * catch that, so the conversion is pinned here.
 */
describe('ghostSourceRect', () => {
  const CANVAS = { w: 2000, h: 1000 } // device px

  it('scales a CSS rect by dpr', () => {
    expect(ghostSourceRect({ x: 100, y: 50, w: 200, h: 100 }, 2, CANVAS.w, CANVAS.h))
      .toEqual({ sx: 200, sy: 100, sw: 400, sh: 200 })
  })

  it('is identity at dpr 1', () => {
    expect(ghostSourceRect({ x: 10, y: 20, w: 30, h: 40 }, 1, CANVAS.w, CANVAS.h))
      .toEqual({ sx: 10, sy: 20, sw: 30, sh: 40 })
  })

  it('clamps a rect that overhangs the canvas instead of reading past the buffer', () => {
    const r = ghostSourceRect({ x: 900, y: 400, w: 400, h: 400 }, 2, CANVAS.w, CANVAS.h)
    expect(r).toEqual({ sx: 1800, sy: 800, sw: 200, sh: 200 })
  })

  it('clamps a negative origin to 0 (a shape can start off the top-left)', () => {
    const r = ghostSourceRect({ x: -50, y: -20, w: 100, h: 100 }, 2, CANVAS.w, CANVAS.h)
    expect(r).toEqual({ sx: 0, sy: 0, sw: 100, sh: 160 })
  })

  it('returns null when there is nothing to copy', () => {
    expect(ghostSourceRect({ x: 0, y: 0, w: 0, h: 100 }, 2, CANVAS.w, CANVAS.h)).toBeNull()
    expect(ghostSourceRect({ x: 5000, y: 0, w: 100, h: 100 }, 2, CANVAS.w, CANVAS.h)).toBeNull()
    expect(ghostSourceRect({ x: 0, y: 0, w: 10, h: 10 }, 0, CANVAS.w, CANVAS.h)).toBeNull()
    expect(ghostSourceRect({ x: 0, y: 0, w: 10, h: 10 }, 2, 0, 0)).toBeNull()
  })
})

describe('rectsIntersect', () => {
  const a = { x: 0, y: 0, w: 100, h: 100 }

  it('detects overlap', () => {
    expect(rectsIntersect(a, { x: 50, y: 50, w: 100, h: 100 })).toBe(true)
    expect(rectsIntersect(a, { x: 10, y: 10, w: 10, h: 10 })).toBe(true) // contained
  })

  it('treats edge-touching as NOT overlapping', () => {
    expect(rectsIntersect(a, { x: 100, y: 0, w: 50, h: 50 })).toBe(false)
  })

  it('detects separation on either axis', () => {
    expect(rectsIntersect(a, { x: 200, y: 0, w: 50, h: 50 })).toBe(false)
    expect(rectsIntersect(a, { x: 0, y: 200, w: 50, h: 50 })).toBe(false)
  })
})

describe('chooseSettlePlan', () => {
  const shape = { x: 1000, y: 1000, w: 2000, h: 1000 }

  it('uses one union paint for a small nudge (bounds still overlap)', () => {
    expect(chooseSettlePlan(shape, { ...shape, x: shape.x + 300 })).toBe('union')
  })

  it('erases the old position first when the shape is thrown clear of it', () => {
    // Disjoint bounds mean the stale copy is plainly visible next to the ghost,
    // so the vacated area is repainted first rather than as part of one big union.
    expect(chooseSettlePlan(shape, { ...shape, x: shape.x + 9000 })).toBe('old-then-new')
  })

  it('is symmetric', () => {
    const far = { ...shape, x: shape.x + 9000 }
    expect(chooseSettlePlan(far, shape)).toBe(chooseSettlePlan(shape, far))
  })
})
