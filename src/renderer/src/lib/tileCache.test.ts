import { describe, it, expect } from 'vitest'
import { TileCache, tileTwipRect, type TileKey } from './tileCache'

/**
 * The tile cache's LRU + eviction geometry — the logic that must be exactly
 * right for cached scrolling to be safe. Tests use plain objects with a
 * close() spy in place of ImageBitmaps.
 */

const K = (part: number, tx: number, ty: number, zoom = 1, dpr = 2): TileKey => ({ part, zoom, dpr, tx, ty })

function bmp(): { closed: boolean; close: () => void } {
  const b = { closed: false, close: () => { b.closed = true } }
  return b
}

describe('TileCache', () => {
  it('stores and returns tiles by exact key', () => {
    const c = new TileCache<{ closed: boolean; close: () => void }>(8)
    const b = bmp()
    c.set(K(0, 0, 0), b)
    expect(c.get(K(0, 0, 0))).toBe(b)
    expect(c.get(K(0, 512, 0))).toBeUndefined()
    expect(c.get(K(1, 0, 0))).toBeUndefined() // another sheet is another tile
  })

  it('evicts least-recently-USED past capacity, closing the bitmap', () => {
    const c = new TileCache<{ closed: boolean; close: () => void }>(2)
    const a = bmp(), b = bmp(), d = bmp()
    c.set(K(0, 0, 0), a)
    c.set(K(0, 512, 0), b)
    c.get(K(0, 0, 0)) // touch a — b becomes the LRU
    c.set(K(0, 1024, 0), d)
    expect(c.size).toBe(2)
    expect(b.closed).toBe(true) // b, not a, was evicted
    expect(c.get(K(0, 0, 0))).toBe(a)
    expect(c.get(K(0, 512, 0))).toBeUndefined()
  })

  it('replacing a key closes the old bitmap', () => {
    const c = new TileCache<{ closed: boolean; close: () => void }>(8)
    const a = bmp(), b = bmp()
    c.set(K(0, 0, 0), a)
    c.set(K(0, 0, 0), b)
    expect(a.closed).toBe(true)
    expect(c.get(K(0, 0, 0))).toBe(b)
    expect(c.size).toBe(1)
  })

  /*
   * Geometry: a tile at device origin (512,512), zoom 1, dpr 2 covers twips
   * [1920..3840) each axis (devPerTwip = 96/1440*2 ≈ 0.1333).
   */
  it('maps a tile key back to the document twips it covers', () => {
    const r = tileTwipRect(K(0, 512, 512))
    expect(Math.round(r.x)).toBe(3840)
    expect(Math.round(r.w)).toBe(3840)
  })

  it('evicts exactly the tiles intersecting a dirty twip rect, on that part only', () => {
    const c = new TileCache<{ closed: boolean; close: () => void }>(16)
    const hit = bmp(), miss = bmp(), otherPart = bmp()
    c.set(K(0, 0, 0), hit)          // covers twips 0..3840
    c.set(K(0, 2048, 2048), miss)   // covers twips 15360..19200
    c.set(K(1, 0, 0), otherPart)    // same rect, different sheet
    const n = c.evictTwipsRect(0, 1000, 1000, 500, 500) // inside tile (0,0) only
    expect(n).toBe(1)
    expect(hit.closed).toBe(true)
    expect(c.get(K(0, 2048, 2048))).toBe(miss)
    expect(c.get(K(1, 0, 0))).toBe(otherPart)
  })

  it('evicts across zoom variants — an edit dirties every rendering of the spot', () => {
    const c = new TileCache<{ closed: boolean; close: () => void }>(16)
    const z1 = bmp(), z2 = bmp()
    c.set(K(0, 0, 0, 1), z1)
    c.set(K(0, 0, 0, 2), z2) // same doc region rendered at zoom 2
    c.evictTwipsRect(0, 100, 100, 100, 100)
    expect(z1.closed).toBe(true)
    expect(z2.closed).toBe(true)
    expect(c.size).toBe(0)
  })

  it('evictPart and clear release everything they remove', () => {
    const c = new TileCache<{ closed: boolean; close: () => void }>(16)
    const a = bmp(), b = bmp()
    c.set(K(0, 0, 0), a)
    c.set(K(2, 0, 0), b)
    c.evictPart(0)
    expect(a.closed).toBe(true)
    expect(c.size).toBe(1)
    c.clear()
    expect(b.closed).toBe(true)
    expect(c.size).toBe(0)
  })
})
