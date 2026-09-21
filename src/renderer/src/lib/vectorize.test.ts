import { describe, it, expect } from 'vitest'
import { imageDataToSvg, type RasterData } from './vectorize'

/** A solid-color W×H RGBA bitmap — a DOM-free `ImageData` stand-in. */
function solid(w: number, h: number, r: number, g: number, b: number): RasterData {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = 255
  }
  return { width: w, height: h, data }
}

describe('imageDataToSvg', () => {
  it('produces non-empty SVG markup with a path for a solid-color bitmap', () => {
    const svg = imageDataToSvg(solid(16, 16, 30, 120, 210), { colors: 2 })
    expect(svg.length).toBeGreaterThan(0)
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('<path')
  })

  it('emits a viewBox so the output scales resolution-independently', () => {
    const svg = imageDataToSvg(solid(8, 8, 0, 0, 0), { colors: 2 })
    expect(svg).toMatch(/viewBox=/i)
  })

  it('honors a larger palette for richer inputs', () => {
    // Two-tone checkerboard → tracer should keep it non-empty at 8 colors too.
    const w = 12
    const h = 12
    const data = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      const on = (Math.floor(i / w) + (i % w)) % 2 === 0
      data[i * 4] = on ? 240 : 20
      data[i * 4 + 1] = on ? 240 : 20
      data[i * 4 + 2] = on ? 240 : 20
      data[i * 4 + 3] = 255
    }
    const svg = imageDataToSvg({ width: w, height: h, data }, { colors: 8 })
    expect(svg).toContain('<path')
  })

  it('throws on empty image data', () => {
    expect(() => imageDataToSvg({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).toThrow(/empty/)
  })
})
