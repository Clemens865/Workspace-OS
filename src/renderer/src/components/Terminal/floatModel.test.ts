import { describe, expect, it } from 'vitest'
import { MIN_H, MIN_W, clampRect, defaultRect, moveRect, parseRect, resizeRect, snapZone } from './floatModel'

const V = { w: 1440, h: 900 }

describe('floating terminal geometry', () => {
  it('opens lower right, inside the window', () => {
    const r = defaultRect(V)
    expect(r.x + r.w).toBeLessThanOrEqual(V.w)
    expect(r.y + r.h).toBeLessThanOrEqual(V.h)
    expect(r.x).toBeGreaterThan(V.w / 3)
  })

  it('moves with the pointer but keeps its title bar reachable', () => {
    const r = { x: 100, y: 100, w: 600, h: 400 }
    expect(moveRect(r, 50, 20, V)).toMatchObject({ x: 150, y: 120 })
    const far = moveRect(r, 5000, 5000, V)
    expect(far.x).toBeLessThanOrEqual(V.w - 80)
    expect(far.y).toBeLessThanOrEqual(V.h - 40)
    expect(moveRect(r, 0, -500, V).y).toBe(0)
  })

  it('resizes from a corner, keeping the opposite corner put', () => {
    const r = { x: 200, y: 200, w: 600, h: 400 }
    expect(resizeRect(r, 'se', 100, 50, V)).toEqual({ x: 200, y: 200, w: 700, h: 450 })
    const nw = resizeRect(r, 'nw', -100, -50, V)
    expect(nw).toEqual({ x: 100, y: 150, w: 700, h: 450 })
  })

  it('never shrinks below its minimum, even dragging the left/top edge', () => {
    const r = { x: 200, y: 200, w: 600, h: 400 }
    const tiny = resizeRect(r, 'nw', 1000, 1000, V)
    expect(tiny.w).toBe(MIN_W)
    expect(tiny.h).toBe(MIN_H)
    // the right and bottom edges stayed where they were
    expect(tiny.x + tiny.w).toBe(800)
    expect(tiny.y + tiny.h).toBe(600)
  })

  it('offers to dock at the right or bottom edge only', () => {
    expect(snapZone(V.w - 5, 300, V)).toBe('right')
    expect(snapZone(500, V.h - 5, V)).toBe('bottom')
    expect(snapZone(500, 300, V)).toBeNull()
  })

  it('reads a stored window defensively', () => {
    expect(parseRect({ x: 10, y: 20, w: 500, h: 300 }, V)).toEqual({ x: 10, y: 20, w: 500, h: 300 })
    expect(parseRect({ x: 'a' }, V)).toEqual(defaultRect(V))
    expect(parseRect(null, V)).toEqual(defaultRect(V))
    expect(clampRect({ x: 0, y: 0, w: 99999, h: 99999 }, V).w).toBe(V.w - 16)
  })
})
