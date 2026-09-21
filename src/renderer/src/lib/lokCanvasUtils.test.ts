import { describe, it, expect } from 'vitest'
import { bgraToRgba } from './lokCanvasUtils'

/** Two BGRA pixels: (B=1,G=2,R=3,A=4) and (B=5,G=6,R=7,A=8). */
const BGRA = [1, 2, 3, 4, 5, 6, 7, 8]
/** Expected RGBA: B/R swapped, G kept, alpha forced opaque. */
const RGBA = [3, 2, 1, 255, 7, 6, 5, 255]

describe('bgraToRgba', () => {
  it('swaps B/R and forces opaque alpha on the aligned (Uint32) fast path', () => {
    const src = new Uint8Array(BGRA) // byteOffset 0 → aligned → fast path
    const dst = new Uint8ClampedArray(8)
    expect(src.byteOffset % 4).toBe(0)
    bgraToRgba(src, dst, 2)
    expect(Array.from(dst)).toEqual(RGBA)
  })

  it('produces identical output via the byte fallback for unaligned buffers', () => {
    // Offset the view by 1 byte so the Uint32 alignment guard fails.
    const buf = new ArrayBuffer(BGRA.length + 1)
    const src = new Uint8Array(buf, 1, BGRA.length)
    src.set(BGRA)
    expect(src.byteOffset % 4).not.toBe(0)
    const dst = new Uint8ClampedArray(8)
    bgraToRgba(src, dst, 2)
    expect(Array.from(dst)).toEqual(RGBA)
  })

  it('falls back when the source is shorter than px * 4 words', () => {
    // Aligned but too short for a px-sized Uint32 view → byte loop (reads
    // undefined → 0 for the missing tail, alpha still forced opaque).
    const src = new Uint8Array([1, 2, 3, 4])
    const dst = new Uint8ClampedArray(8)
    bgraToRgba(src, dst, 2)
    expect(Array.from(dst.slice(0, 4))).toEqual([3, 2, 1, 255])
    expect(dst[7]).toBe(255)
  })
})
