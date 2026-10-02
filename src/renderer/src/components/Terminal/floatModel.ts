/**
 * Geometry of the floating terminal window: moving, resizing from any edge or
 * corner, staying on screen, and snapping to the right or bottom edge to dock.
 * Pure, so every rule is a test.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Viewport {
  w: number
  h: number
}

/** n, s, e, w and the four corners. */
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const MIN_W = 360
export const MIN_H = 200
/** How close to an edge the pointer must come for the window to offer docking there. */
export const SNAP_PX = 28
/** The part of the title bar that must stay on screen, so the window can always be dragged back. */
const KEEP = 80

/** The window a first float opens with: right side, comfortably sized, clear of the landscape's dock. */
export function defaultRect(v: Viewport): Rect {
  const w = Math.min(720, Math.max(MIN_W, Math.round(v.w * 0.46)))
  const h = Math.min(440, Math.max(MIN_H, Math.round(v.h * 0.42)))
  return clampRect({ x: v.w - w - 32, y: Math.max(96, v.h - h - 150), w, h }, v)
}

/** Keeps the window at least its minimum size, no larger than the screen, with its title bar reachable. */
export function clampRect(r: Rect, v: Viewport): Rect {
  const w = Math.max(MIN_W, Math.min(r.w, v.w - 16))
  const h = Math.max(MIN_H, Math.min(r.h, v.h - 16))
  const x = Math.max(KEEP - w, Math.min(r.x, v.w - KEEP))
  const y = Math.max(0, Math.min(r.y, v.h - 40))
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
}

/** The window moved by the pointer's travel. */
export function moveRect(start: Rect, dx: number, dy: number, v: Viewport): Rect {
  return clampRect({ ...start, x: start.x + dx, y: start.y + dy }, v)
}

/** The window resized by dragging `handle`; the opposite edge stays where it was. */
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number, v: Viewport): Rect {
  let { x, y, w, h } = start
  if (handle.includes('e')) w = start.w + dx
  if (handle.includes('s')) h = start.h + dy
  if (handle.includes('w')) {
    w = Math.max(MIN_W, start.w - dx)
    x = start.x + (start.w - w)
  }
  if (handle.includes('n')) {
    h = Math.max(MIN_H, start.h - dy)
    y = start.y + (start.h - h)
  }
  return clampRect({ x, y, w, h }, v)
}

/** Where the window would dock if dropped with the pointer here: the right or bottom edge, or nowhere. */
export function snapZone(px: number, py: number, v: Viewport): 'right' | 'bottom' | null {
  if (px >= v.w - SNAP_PX) return 'right'
  if (py >= v.h - SNAP_PX) return 'bottom'
  return null
}

/** Reads a stored rect defensively; anything malformed gives the default. */
export function parseRect(raw: unknown, v: Viewport): Rect {
  const r = raw as Partial<Rect> | null
  if (!r || ![r.x, r.y, r.w, r.h].every((n) => typeof n === 'number' && Number.isFinite(n))) return defaultRect(v)
  return clampRect(r as Rect, v)
}
