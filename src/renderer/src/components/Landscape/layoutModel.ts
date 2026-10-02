/**
 * Where each agent screen stands in the landscape. Pure math, ported from the
 * approved prototype (docs/landscape/prototype/app.js: arc, overviewLayout,
 * flankLayout, focusLayout) and generalised from the sample's fixed 8 + 8
 * screens to any team size.
 *
 * Coordinates are in the 1600 × 900 design stage, which the view scales to the
 * window. Screens stand on the inside of a shallow cylinder: the further from
 * the centre, the further back and the more turned toward the viewer.
 */

export const STAGE_W = 1600
export const STAGE_H = 900

export interface Placement {
  x: number
  y: number
  z: number
  w: number
  h: number
  /** Rotation about the vertical axis, degrees. */
  ry: number
  /** 0..1, the screen's opacity (and how strongly its glass lenses). */
  op: number
  /** Glass depth: 0 clear, 1 the back row, 2 a side flank. */
  glass: 0 | 1 | 2
  /** Transition delay in ms, so a row moves as a wave rather than a block. */
  delay: number
  side?: boolean
  /** Explicit stacking order (the focused screen). */
  zi?: number
}

export type Layout = Record<string, Placement>

interface ArcOpts {
  R: number
  step: number
  w: number
  h: number
  y: number
  z0: number
  depth: number
  turn: number
  sag: number
  vis: number
  glass: 0 | 1 | 2
  delay: number
}

const FRONT_ARC: ArcOpts = { R: 2000, step: 0.125, w: 222, h: 232, y: 428, z0: 0, depth: 0.2, turn: 0.62, sag: 1.2, vis: 2.6, glass: 0, delay: 0 }
const BACK_ARC: ArcOpts = { R: 2100, step: 0.104, w: 190, h: 182, y: 196, z0: -160, depth: 0.16, turn: 0.5, sag: 0.8, vis: 3.4, glass: 1, delay: 120 }

/** How many front screens are fully in view at a resting position. */
export const FRONT_VISIBLE = 7

/** Lay `ids` along an arc, `off` items scrolled (0 = centred). */
export function arc(L: Layout, ids: string[], off: number, o: ArcOpts, scrolling = false): void {
  const mid = (ids.length - 1) / 2
  ids.forEach((id, i) => {
    const d = i - mid - off
    const a = d * o.step
    const ad = Math.abs(d)
    L[id] = {
      x: STAGE_W / 2 + o.R * Math.sin(a) - o.w / 2,
      y: o.y + ad * ad * o.sag,
      z: o.z0 + o.R * o.depth * (1 - Math.cos(a)),
      ry: -a * (180 / Math.PI) * o.turn,
      w: o.w,
      h: o.h,
      glass: o.glass,
      op: ad <= o.vis ? 1 : Math.max(0, 1 - (ad - o.vis) / 0.75),
      delay: scrolling ? 0 : o.delay + Math.round(ad) * 35,
    }
  })
}

/**
 * The carousel's resting range, in front-row items. With up to FRONT_VISIBLE
 * screens there is nothing to scroll; beyond that the row can travel until its
 * last screen is in view. The prototype rests at -1 for a row of eight.
 */
export function scrollRange(frontCount: number): { min: number; max: number } {
  const half = Math.max(0, frontCount - FRONT_VISIBLE) / 2
  if (frontCount <= FRONT_VISIBLE) return { min: 0, max: 0 }
  return { min: -half, max: half }
}

export function clampScroll(v: number, frontCount: number, give = 0): number {
  const { min, max } = scrollRange(frontCount)
  return Math.max(min - give, Math.min(max + give, v))
}

/** The team overview: the front row on the carousel, the back row in slower parallax. */
export function overviewLayout(front: string[], back: string[], cur: number, scrolling = false): Layout {
  const L: Layout = {}
  // A small team has no back row: its single row stands nearer the middle.
  arc(L, front, cur, back.length ? FRONT_ARC : { ...FRONT_ARC, y: 300 }, scrolling)
  // The back row drifts at 78% of the front's speed: a quiet parallax that reads as depth.
  arc(L, back, cur * 0.78, BACK_ARC, scrolling)
  return L
}

const SIDE_L = [
  { x: 22, y: 180, w: 178, h: 310, ry: 30 },
  { x: 206, y: 182, w: 166, h: 305, ry: 26 },
]
const SIDE_R = [
  { x: 1240, y: 190, w: 112, h: 296, ry: -26 },
  { x: 1362, y: 194, w: 108, h: 290, ry: -26 },
  { x: 1480, y: 200, w: 104, h: 284, ry: -28 },
]

/** Off-stage: receded into the mist, invisible. */
function hidden(i: number): Placement {
  return { x: 700 + (i % 2 ? 140 : -140), y: 260, z: -1200, w: 190, h: 190, ry: 0, op: 0, glass: 0, delay: 0 }
}

/**
 * Neighbours flank a focused screen in carousel order, so ← / → feels like
 * turning the ring. Everything else recedes.
 */
export function flankLayout(ring: string[], all: string[], focusId: string): Layout {
  const L: Layout = {}
  const n = ring.length
  const c = Math.max(0, ring.indexOf(focusId))
  const at = (k: number): string | undefined => (n ? ring[((k % n) + n) % n] : undefined)
  SIDE_L.forEach((slot, j) => {
    const id = at(c - (SIDE_L.length - j))
    if (id && id !== focusId && !L[id]) L[id] = { ...slot, z: -40, op: 1, glass: 2, side: true, delay: 60 + j * 50 }
  })
  SIDE_R.forEach((slot, j) => {
    const id = at(c + j + 1)
    if (id && id !== focusId && !L[id]) L[id] = { ...slot, z: -40, op: 1, glass: 2, side: true, delay: 60 + j * 50 }
  })
  all.forEach((id, i) => {
    if (!L[id]) L[id] = hidden(i)
  })
  return L
}

/** One screen steps forward into the stage-sized frame; its neighbours flank it. */
export const FOCUS_FRAME = { x: 392, y: 64, w: 826, h: 612 }

export function focusLayout(ring: string[], all: string[], focusId: string): Layout {
  const L = flankLayout(ring, all, focusId)
  L[focusId] = { ...FOCUS_FRAME, z: 80, ry: 0, op: 1, glass: 0, delay: 0, zi: 3000 }
  return L
}

/** Every screen recedes into the mist (another landscape view is in front). */
export function awayLayout(front: string[], back: string[], cur: number): Layout {
  const L = overviewLayout(front, back, cur)
  Object.values(L).forEach((p, i) => Object.assign(p, { z: -1300, y: p.y - 40, op: 0, delay: i * 15 }))
  return L
}

/** CSS transform for a placement (the stage is a preserve-3d world). */
export function transformOf(p: Placement): string {
  return `translate3d(${p.x}px,${p.y}px,${p.z}px) rotateY(${p.ry}deg)`
}

/** The stage → window scale (the stage is letterboxed into the window). */
export function stageScale(winW: number, winH: number): number {
  return Math.min(winW / STAGE_W, winH / STAGE_H)
}
