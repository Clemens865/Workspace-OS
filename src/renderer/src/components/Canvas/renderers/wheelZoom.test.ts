import { describe, expect, it } from 'vitest'
import { anchoredScroll, zoomForDelta, ZOOM_MAX, ZOOM_MIN } from './wheelZoom'

describe('zoomForDelta', () => {
  it('zooms in on a negative delta and out on a positive one', () => {
    expect(zoomForDelta(1, -100)).toBeGreaterThan(1)
    expect(zoomForDelta(1, 100)).toBeLessThan(1)
  })
  it('is symmetric: in then out returns close to the start', () => {
    const z = zoomForDelta(zoomForDelta(1, -80), 80)
    expect(Math.abs(z - 1)).toBeLessThan(0.002)
  })
  it('clamps to the shared bounds', () => {
    expect(zoomForDelta(2.9, -5000)).toBe(ZOOM_MAX)
    expect(zoomForDelta(0.55, 5000)).toBe(ZOOM_MIN)
  })
  it('treats a trackpad pinch (tiny deltas) as a small step', () => {
    const z = zoomForDelta(1, -2)
    expect(z).toBeGreaterThan(1)
    expect(z).toBeLessThan(1.02)
  })
})

describe('anchoredScroll', () => {
  it('keeps the point under the pointer fixed when zooming in', () => {
    // Pointer 200px into the viewport, content scrolled 300px: the content
    // point is at 500. At 2× it sits at 1000, so the scroll must be 800.
    expect(anchoredScroll(1, 2, 300, 0, 200, 0)).toEqual({ left: 800, top: 0 })
  })
  it('never scrolls negative when zooming out near the origin', () => {
    expect(anchoredScroll(2, 1, 0, 0, 50, 50)).toEqual({ left: 0, top: 0 })
  })
  it('handles both axes independently', () => {
    const r = anchoredScroll(1, 1.5, 100, 400, 20, 80)
    expect(r.left).toBeCloseTo(160)
    expect(r.top).toBeCloseTo(640)
  })
})
