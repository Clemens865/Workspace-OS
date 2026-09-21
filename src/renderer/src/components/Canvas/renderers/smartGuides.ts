/**
 * Smart guides for shape drags: the moving box snaps to the edges and centres
 * of its sibling shapes and of the page, and the matched lines are drawn as
 * guides. Everything is in document twips; the caller converts to pixels.
 */

export interface Rect { x: number; y: number; w: number; h: number }

export interface Guide {
  axis: 'v' | 'h'
  /** Document coordinate (twips) of the guide line. */
  pos: number
  /** Extent along the guide so it spans both boxes (twips). */
  from: number
  to: number
}

export interface SnapResult {
  rect: Rect
  guides: Guide[]
}

/** The three candidate lines per axis for a box: start, centre, end. */
function lines(r: Rect, axis: 'v' | 'h'): number[] {
  return axis === 'v' ? [r.x, r.x + r.w / 2, r.x + r.w] : [r.y, r.y + r.h / 2, r.y + r.h]
}

/**
 * Snap `moving` against `siblings` and the page box. The nearest candidate
 * within `tol` twips wins per axis; ties prefer the smaller shift.
 */
export function snapRect(moving: Rect, siblings: Rect[], page: { w: number; h: number } | null, tol: number): SnapResult {
  const targets: Rect[] = [...siblings]
  if (page && page.w > 0 && page.h > 0) targets.push({ x: 0, y: 0, w: page.w, h: page.h })
  const guides: Guide[] = []
  let dx = 0, dy = 0
  for (const axis of ['v', 'h'] as const) {
    let best: { shift: number; pos: number; target: Rect } | null = null
    const mine = lines(moving, axis)
    for (const t of targets) {
      for (const tp of lines(t, axis)) {
        for (const mp of mine) {
          const shift = tp - mp
          if (Math.abs(shift) <= tol && (!best || Math.abs(shift) < Math.abs(best.shift))) best = { shift, pos: tp, target: t }
        }
      }
    }
    if (!best) continue
    if (axis === 'v') dx = best.shift; else dy = best.shift
    const cross = axis === 'v' ? 'y' : 'x', extent = axis === 'v' ? 'h' : 'w'
    const a0 = moving[cross] + (axis === 'v' ? dy : dx), a1 = a0 + moving[extent]
    const b0 = best.target[cross], b1 = b0 + best.target[extent]
    guides.push({ axis, pos: best.pos, from: Math.min(a0, b0), to: Math.max(a1, b1) })
  }
  return { rect: { x: moving.x + dx, y: moving.y + dy, w: moving.w, h: moving.h }, guides }
}

/** One 'i|x|y|w|h|sel' line per shape (WosShapeRects, 1/100 mm) → twips rects of the OTHER shapes. */
export function parseSiblingRects(raw: string): Rect[] {
  const tw = (v: number): number => Math.round((v * 1440) / 2540)
  return raw.split('\n').map((l) => l.trim()).filter((l) => /^\d+\|/.test(l)).map((l) => l.split('|').map(Number))
    .filter((p) => p.length >= 6 && p[5] !== 1 && p[3] > 0 && p[4] > 0)
    .map((p) => ({ x: tw(p[1]), y: tw(p[2]), w: tw(p[3]), h: tw(p[4]) }))
}
