/** Pure canvas/pixel helpers for the LOK renderer (no React, no DOM state). */

/** 1 inch = 1440 twips = 96 px at 100%. */
export const DPI = 96
export const TWIPS_PER_INCH = 1440
export const TILE = 512

/**
 * BGRA→RGBA swizzle — the hottest loop on every full repaint (every device
 * pixel, ×4 on Retina). Swizzle a word at a time via Uint32 views — one
 * iteration per pixel instead of four byte writes — swapping the B/R bytes and
 * forcing opaque alpha. Falls back to the byte loop when the buffers aren't
 * 4-byte-aligned (Uint32Array requires it).
 */
export function bgraToRgba(src: Uint8Array, dst: Uint8ClampedArray, px: number): void {
  if (src.byteOffset % 4 === 0 && dst.byteOffset % 4 === 0 && src.byteLength >= px * 4) {
    const s32 = new Uint32Array(src.buffer, src.byteOffset, px)
    const d32 = new Uint32Array(dst.buffer, dst.byteOffset, px)
    for (let i = 0; i < px; i++) {
      const p = s32[i]
      // p (LE) = A R G B (high→low). Keep A,G; swap R and B → opaque RGBA.
      d32[i] = 0xff000000 | (p & 0x0000ff00) | ((p & 0x00ff0000) >>> 16) | ((p & 0x000000ff) << 16)
    }
  } else {
    for (let i = 0, n = px * 4; i < n; i += 4) {
      dst[i] = src[i + 2]
      dst[i + 1] = src[i + 1]
      dst[i + 2] = src[i]
      dst[i + 3] = 255
    }
  }
}
