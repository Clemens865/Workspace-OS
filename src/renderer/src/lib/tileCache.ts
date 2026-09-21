import { DPI, TWIPS_PER_INCH, TILE } from './lokCanvasUtils'

/**
 * The client-side tile cache — the piece that separates a usable LOK client
 * from a naive one (Collabora Online's core trick). Rendered tiles are kept
 * keyed by (part, zoom, dpr, absolute device-px origin); scrolling back over
 * anything already rendered redraws from here instantly, with zero engine
 * work and zero pixel transport. The engine's INVALIDATE_TILES callbacks
 * evict exactly the touched tiles.
 *
 * Generic over the bitmap type so the LRU/eviction/geometry logic — the part
 * that can be subtly wrong — is unit-testable without a DOM (the app stores
 * ImageBitmaps; tests store plain objects). Eviction calls `close()` when the
 * entry has one, releasing ImageBitmap GPU/native memory deterministically.
 *
 * Capacity is counted in tiles (512×512×4 ≈ 1 MiB each), so the default cap
 * bounds the cache near 256 MiB — enough for several screens of several
 * sheets without threatening the process.
 */

export interface TileKey {
  part: number
  /** The zoom factor the tile was rendered at (not devPerTwip — see twipRect). */
  zoom: number
  dpr: number
  /** ABSOLUTE device-px origin of the tile within the document (multiples of TILE). */
  tx: number
  ty: number
}

interface Entry<T> {
  bmp: T
  key: TileKey
}

const keyStr = (k: TileKey): string => `${k.part}|${k.zoom}|${k.dpr}|${k.tx}|${k.ty}`

/** The document-twip rect a cached tile covers, derived from its own zoom/dpr. */
export function tileTwipRect(k: TileKey): { x: number; y: number; w: number; h: number } {
  const devPerTwip = ((DPI * k.zoom) / TWIPS_PER_INCH) * k.dpr
  return { x: k.tx / devPerTwip, y: k.ty / devPerTwip, w: TILE / devPerTwip, h: TILE / devPerTwip }
}

export class TileCache<T extends { close?: () => void }> {
  private map = new Map<string, Entry<T>>()
  constructor(private maxTiles = 256) {}

  get size(): number {
    return this.map.size
  }

  /** Returns the cached tile and marks it most-recently-used. */
  get(k: TileKey): T | undefined {
    const s = keyStr(k)
    const e = this.map.get(s)
    if (!e) return undefined
    // Map preserves insertion order; delete+set moves the entry to the end,
    // which is what makes plain Map iteration an LRU eviction order.
    this.map.delete(s)
    this.map.set(s, e)
    return e.bmp
  }

  /** Stores (or replaces) a tile, evicting least-recently-used past capacity. */
  set(k: TileKey, bmp: T): void {
    const s = keyStr(k)
    const prev = this.map.get(s)
    if (prev) {
      prev.bmp.close?.()
      this.map.delete(s)
    }
    this.map.set(s, { bmp, key: k })
    while (this.map.size > this.maxTiles) {
      const oldest = this.map.keys().next().value as string
      this.map.get(oldest)?.bmp.close?.()
      this.map.delete(oldest)
    }
  }

  /**
   * Evicts every tile of `part` whose coverage intersects the dirty TWIP rect —
   * across all zoom/dpr variants, because a cell edit dirties them all.
   */
  evictTwipsRect(part: number, x: number, y: number, w: number, h: number): number {
    let evicted = 0
    for (const [s, e] of [...this.map]) {
      if (e.key.part !== part) continue
      const r = tileTwipRect(e.key)
      const hit = r.x < x + w && r.x + r.w > x && r.y < y + h && r.y + r.h > y
      if (hit) {
        e.bmp.close?.()
        this.map.delete(s)
        evicted++
      }
    }
    return evicted
  }

  /** Evicts every tile of one part (an "EMPTY" whole-doc invalidation). */
  evictPart(part: number): void {
    for (const [s, e] of [...this.map]) {
      if (e.key.part === part) {
        e.bmp.close?.()
        this.map.delete(s)
      }
    }
  }

  clear(): void {
    for (const e of this.map.values()) e.bmp.close?.()
    this.map.clear()
  }
}
