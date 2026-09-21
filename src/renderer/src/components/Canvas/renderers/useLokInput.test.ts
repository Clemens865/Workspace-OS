import { describe, it, expect } from 'vitest'
import { tw2mm, resizeRectBy } from './useLokInput'

/**
 * The two pure pieces of the shape-drag commit path.
 *
 * A finished drag is committed through the model API (WosShapeSize +
 * WosShapeMove) rather than by replaying mouse events at the engine. The
 * real-engine e2e (e2e/office/AA-shape-move.mjs) proves the macros mutate the
 * saved .pptx, but it feeds them 1/100 mm directly — so these two functions, the
 * step that turns a pointer drag in twips into those arguments, are only covered
 * here. Get the ratio or the origin math wrong and every engine test stays green
 * while shapes land in the wrong place.
 */
describe('tw2mm', () => {
  it('converts an inch of twips to an inch of 1/100 mm', () => {
    expect(tw2mm(1440)).toBe(2540)
  })

  it('is linear and sign-preserving (a drag delta can be negative)', () => {
    expect(tw2mm(720)).toBe(1270)
    expect(tw2mm(-1440)).toBe(-2540)
    expect(tw2mm(0)).toBe(0)
  })

  it('rounds to a whole 1/100 mm — the macro parses with CLng', () => {
    expect(Number.isInteger(tw2mm(1))).toBe(true)
    expect(tw2mm(1)).toBe(2) // 1.7638… → 2
  })
})

describe('resizeRectBy', () => {
  const o = { x: 1000, y: 2000, w: 4000, h: 3000 }

  it("'se' grows the size and leaves the origin alone", () => {
    expect(resizeRectBy(o, 'se', 500, 300)).toEqual({ x: 1000, y: 2000, w: 4500, h: 3300 })
  })

  it("'nw' moves the origin AND shrinks by the same delta", () => {
    // This is the case the commit path depends on: WosShapeSize keeps the
    // top-left anchored, so the origin shift has to be issued separately.
    const r = resizeRectBy(o, 'nw', 500, 300)
    expect(r).toEqual({ x: 1500, y: 2300, w: 3500, h: 2700 })
    expect(r.x - o.x).toBe(500)
    expect(r.y - o.y).toBe(300)
  })

  it('edge handles resize one axis only', () => {
    expect(resizeRectBy(o, 'e', 500, 300)).toEqual({ x: 1000, y: 2000, w: 4500, h: 3000 })
    expect(resizeRectBy(o, 's', 500, 300)).toEqual({ x: 1000, y: 2000, w: 4000, h: 3300 })
    expect(resizeRectBy(o, 'n', 500, 300)).toEqual({ x: 1000, y: 2300, w: 4000, h: 2700 })
    expect(resizeRectBy(o, 'w', 500, 300)).toEqual({ x: 1500, y: 2000, w: 3500, h: 3000 })
  })

  it('clamps to a minimum size so a shape can never collapse or invert', () => {
    const r = resizeRectBy(o, 'se', -9000, -9000)
    expect(r.w).toBe(100)
    expect(r.h).toBe(100)
  })

  it('does not mutate the original rect (it is the drag origin, reused per move)', () => {
    resizeRectBy(o, 'nw', 500, 300)
    expect(o).toEqual({ x: 1000, y: 2000, w: 4000, h: 3000 })
  })
})
