/**
 * Drag ghost — the shape's own pixels, lifted off the canvas and flown with the
 * pointer.
 *
 * WHY: the drag-commit profile (e2e/office/AB-drag-profile.mjs) attributed the
 * residual drag lag precisely: committing the move costs ~1.4ms, selecting costs
 * ~5.6ms, and ~90% of drop-to-sharp is the ENGINE re-rendering tiles — ~65ms per
 * tile on a real deck vs ~3.9ms on a synthetic one. That cost is content-bound;
 * no amount of restructuring the commit path removes it.
 *
 * So this attacks PERCEIVED latency instead. At drag start we copy the shape's
 * rendered pixels out of the doc canvas. That copy follows the pointer (a real
 * preview instead of an empty outline), and on release it STAYS at the drop
 * position while the engine repaints underneath — so the shape looks like it
 * arrived instantly, and the ~300ms repaint lands invisibly.
 *
 * The geometry here is pure and unit-tested: canvas coordinates are device px
 * (CSS × dpr) while overlays are CSS px, and getting that wrong silently copies
 * the wrong part of the slide.
 */

export interface GhostRect {
  x: number
  y: number
  w: number
  h: number
}

export interface DragGhost {
  /** Detached canvas holding the copied pixels (rendered into the overlay). */
  canvas: HTMLCanvasElement
  /** Where to draw it, in CSS px relative to the doc canvas. */
  x: number
  y: number
  w: number
  h: number
  /** False while the pointer is still down (translucent preview), true once
   *  dropped and awaiting the engine repaint (opaque — it IS the result). */
  committed: boolean
}

/**
 * The source rect to copy out of the canvas backing store, given a rect in CSS
 * px and the device-pixel ratio, clamped to the canvas. Returns null when the
 * rect lies entirely outside the canvas or has no area — nothing to capture.
 */
export function ghostSourceRect(
  rectCss: GhostRect,
  dpr: number,
  canvasW: number,
  canvasH: number,
): { sx: number; sy: number; sw: number; sh: number } | null {
  if (!(dpr > 0) || canvasW <= 0 || canvasH <= 0) return null
  const sx = Math.max(0, Math.floor(rectCss.x * dpr))
  const sy = Math.max(0, Math.floor(rectCss.y * dpr))
  const x1 = Math.min(canvasW, Math.ceil((rectCss.x + rectCss.w) * dpr))
  const y1 = Math.min(canvasH, Math.ceil((rectCss.y + rectCss.h) * dpr))
  const sw = x1 - sx
  const sh = y1 - sy
  if (sw <= 0 || sh <= 0) return null
  return { sx, sy, sw, sh }
}

/** Do two rects overlap? Drives the settle strategy (see chooseSettlePlan). */
export function rectsIntersect(a: GhostRect, b: GhostRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * How to settle the pixels after a drop.
 *
 * The ghost sits at the destination, but the ORIGINAL is still painted at the
 * old position until the engine repaints — a brief double image. When the two
 * bounds are disjoint that double image is obvious, so erase the old position
 * FIRST (a smaller, faster paint) and bring in the new one after. When they
 * overlap, one union paint is both cheaper and visually equivalent, since the
 * stale pixels are mostly hidden behind the ghost anyway.
 */
export function chooseSettlePlan(oldB: GhostRect, newB: GhostRect): 'union' | 'old-then-new' {
  return rectsIntersect(oldB, newB) ? 'union' : 'old-then-new'
}

/**
 * Copy a CSS-px rect out of the doc canvas into a detached canvas. Returns null
 * if there is nothing to copy or the 2D context is unavailable.
 */
export function captureGhost(
  canvas: HTMLCanvasElement,
  rectCss: GhostRect,
  dpr: number,
): HTMLCanvasElement | null {
  const src = ghostSourceRect(rectCss, dpr, canvas.width, canvas.height)
  if (!src) return null
  const out = document.createElement('canvas')
  out.width = src.sw
  out.height = src.sh
  const ctx = out.getContext('2d')
  if (!ctx) return null
  try {
    ctx.drawImage(canvas, src.sx, src.sy, src.sw, src.sh, 0, 0, src.sw, src.sh)
  } catch {
    return null // tainted or zero-sized canvas — fall back to the outline overlay
  }
  out.style.width = '100%'
  out.style.height = '100%'
  out.style.display = 'block'
  return out
}
