import { describe, it, expect } from 'vitest'
import { chooseSettleMode } from './useLokPaint'

// A standard slide-sized doc (twips): ~10in × 7.5in.
const DOC = { w: 14400, h: 10800 }

describe('chooseSettleMode', () => {
  it('region-paints a small dirty band (a shape move / typed line)', () => {
    // A shape-sized band well under half the doc → region is the win.
    expect(chooseSettleMode({ x: 1000, y: 1000, w: 2000, h: 1500 }, DOC)).toBe('region')
  })

  it('full-paints when the dirty band covers more than half the doc', () => {
    // A corner-to-corner union spanning most of the slide → region saves nothing.
    expect(chooseSettleMode({ x: 0, y: 0, w: DOC.w, h: DOC.h }, DOC)).toBe('full')
  })

  it('full-paints when the dirty rect is unknown (null band)', () => {
    // Caret/position unknown → we cannot bound the reflow, so repaint everything.
    expect(chooseSettleMode(null, DOC)).toBe('full')
  })

  it('full-paints when the doc size is unknown', () => {
    expect(chooseSettleMode({ x: 0, y: 0, w: 100, h: 100 }, null)).toBe('full')
  })

  it('is exactly at the half-doc boundary → region (not strictly greater)', () => {
    // Area == 0.5 * docArea is NOT "> half", so it stays a region paint.
    const half = { x: 0, y: 0, w: DOC.w, h: DOC.h / 2 }
    expect(chooseSettleMode(half, DOC)).toBe('region')
  })

  it('treats a degenerate (zero/negative) band as region, never crashes', () => {
    expect(chooseSettleMode({ x: 0, y: 0, w: 0, h: 0 }, DOC)).toBe('region')
    expect(chooseSettleMode({ x: 0, y: 0, w: -50, h: -50 }, DOC)).toBe('region')
  })
})

import { computeCalcWindow } from './useLokPaint'

/**
 * The Calc viewport window — the fix for tiling the whole used range. These
 * pin the coordinate math (tile-alignment, doc-edge clamping, the prefetch
 * margin, an out-of-range scroll) that broke the reverted 2026-07 attempt.
 * TILE=512. Use dpr=1 for readable device==css math unless testing HiDPI.
 */
describe('computeCalcWindow', () => {
  const base = { dpr: 1, devPerTwip: 0.1, marginTiles: 1 }

  it('windows a huge sheet down to viewport+margin, not the whole doc', () => {
    // 100k×100k device-px "sheet", a 1000×800 viewport at the top-left.
    const w = computeCalcWindow({ ...base, scrollLeftCss: 0, scrollTopCss: 0, clientWCss: 1000, clientHCss: 800, docWDev: 100000, docHDev: 100000 })
    // Origin at 0; far edge = ceil((0+1000+512)/512)*512 = 1536, ×(same for h: ceil((800+512)/512)*512=1536).
    expect(w.devX).toBe(0)
    expect(w.devY).toBe(0)
    expect(w.devW).toBe(1536)
    expect(w.devH).toBe(1536)
    // A handful of tiles, NOT thousands.
    expect(w.tiles.length).toBe(9) // 3×3
  })

  it('aligns the window origin down to a tile boundary and offsets source rects', () => {
    const w = computeCalcWindow({ ...base, scrollLeftCss: 700, scrollTopCss: 300, clientWCss: 1000, clientHCss: 800, docWDev: 100000, docHDev: 100000 })
    // floor((700-512)/512)*512 = floor(188/512)*512 = 0 ; floor((300-512)/512)... negative → clamped 0.
    expect(w.devX).toBe(0)
    expect(w.devY).toBe(0)
    // First tile's twip source = window origin / devPerTwip = 0.
    expect(w.tiles[0].tx).toBe(0)
    expect(w.tiles[0].ty).toBe(0)
  })

  it('scrolled deep: origin is tile-aligned and source twips track the window', () => {
    const w = computeCalcWindow({ ...base, scrollLeftCss: 5000, scrollTopCss: 6000, clientWCss: 1000, clientHCss: 800, docWDev: 100000, docHDev: 100000 })
    // floor((5000-512)/512)*512 = floor(4488/512)=8 → 4096 ; floor((6000-512)/512)=10 → 5120.
    expect(w.devX).toBe(4096)
    expect(w.devY).toBe(5120)
    expect(w.cssX).toBe(4096) // dpr 1
    // The first tile draws at window-local (0,0) but reads twips from the window origin.
    expect(w.tiles[0].ox).toBe(0)
    expect(w.tiles[0].tx).toBe(Math.round(4096 / 0.1))
  })

  it('clamps the far edge to the document extent (no tiles past the end)', () => {
    // Small doc, viewport bigger than it → window is the whole doc, once.
    const w = computeCalcWindow({ ...base, scrollLeftCss: 0, scrollTopCss: 0, clientWCss: 4000, clientHCss: 4000, docWDev: 800, docHDev: 500 })
    expect(w.devW).toBe(800)
    expect(w.devH).toBe(500)
    expect(w.tiles.length).toBe(2) // 2 cols (512 + 288) × 1 row (500 < 512)
  })

  it('honors HiDPI: css origin is device origin / dpr', () => {
    const w = computeCalcWindow({ ...base, dpr: 2, scrollLeftCss: 2000, scrollTopCss: 0, clientWCss: 1000, clientHCss: 800, docWDev: 100000, docHDev: 100000 })
    // visX = 2000*2 = 4000 ; floor((4000-512)/512)*512 = floor(3488/512=6.8)=6 → 3072 device.
    expect(w.devX).toBe(3072)
    expect(w.cssX).toBe(1536) // 3072 / dpr 2
  })
})
