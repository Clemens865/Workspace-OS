/**
 * The team carousel's motion: wheel, trackpad, drag and arrow keys all drive
 * one target position (in front-row items); the view eases toward it, then
 * snaps to the nearest resting position. Ported from the prototype's scroll
 * engine (docs/landscape/prototype/app.js, "scroll: team carousel").
 *
 * The decisions are pure functions (tested); `Carousel` wires them to a frame
 * loop and reports the eased position through `onChange`.
 */
import { clampScroll } from './layoutModel'

export interface WheelLike {
  deltaX: number
  deltaY: number
  deltaMode: number
  ctrlKey?: boolean
}

export type WheelIntent = { kind: 'ignore' } | { kind: 'notch'; dir: 1 | -1 } | { kind: 'glide'; delta: number }

/**
 * A notched mouse wheel moves one screen per click; a trackpad glides
 * continuously and snaps once it stops. Pinch (ctrl+wheel) is left alone.
 */
export function classifyWheel(e: WheelLike): WheelIntent {
  if (e.ctrlKey) return { kind: 'ignore' }
  let d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
  if (e.deltaMode === 1) d *= 16
  if (d === 0) return { kind: 'ignore' }
  const notched = e.deltaMode === 1 || (Math.abs(d) >= 50 && e.deltaX === 0 && Number.isInteger(e.deltaY))
  if (notched) return { kind: 'notch', dir: d > 0 ? 1 : -1 }
  return { kind: 'glide', delta: Math.max(-0.6, Math.min(0.6, d / 420)) }
}

/** Frame-rate independent easing toward the target (the prototype's 1 - 0.0009^dt). */
export function easeToward(cur: number, target: number, dt: number, reduced = false): number {
  if (reduced) return target
  const k = 1 - Math.pow(0.0009, Math.min(0.05, Math.max(0, dt)))
  const next = cur + (target - cur) * k
  return Math.abs(target - next) < 0.0015 ? target : next
}

/** Where a released drag comes to rest: its position, carried by its flick velocity. */
export function flickTarget(t: number, velocityPxPerMs: number, count: number): number {
  return clampScroll(Math.round(t - velocityPxPerMs * 1.6), count)
}

/** Stage px per item while dragging (the prototype: 250 stage px moves one screen). */
export const DRAG_PX_PER_ITEM = 250

export class Carousel {
  cur = 0
  target = 0
  held = false
  private raf = 0
  private last = 0
  private snapT = 0
  private notchLock = false

  constructor(
    private count: () => number,
    private onChange: (cur: number, moving: boolean) => void,
    private reduced = false,
  ) {}

  get moving(): boolean {
    return this.raf !== 0
  }

  /** Wheel or trackpad input. Returns true when the event was used. */
  wheel(e: WheelLike): boolean {
    const intent = classifyWheel(e)
    if (intent.kind === 'ignore') return false
    if (intent.kind === 'notch') {
      if (!this.notchLock) {
        this.step(intent.dir)
        this.notchLock = true
        window.setTimeout(() => (this.notchLock = false), 90)
      }
      return true
    }
    this.target = clampScroll(this.target + intent.delta, this.count(), 0.35)
    this.kick()
    this.snapSoon()
    return true
  }

  /** One screen left or right (arrow keys, a notch). */
  step(dir: number): void {
    this.target = clampScroll(Math.round(this.target) + dir, this.count())
    this.kick()
  }

  /** Drag: follow the pointer, with a little give past the ends. */
  drag(startTarget: number, dxStagePx: number): void {
    this.held = true
    this.target = clampScroll(startTarget - dxStagePx / DRAG_PX_PER_ITEM, this.count(), 0.35)
    this.kick()
  }

  release(velocityStagePxPerMs: number): void {
    this.held = false
    this.target = flickTarget(this.target, velocityStagePxPerMs, this.count())
    this.kick()
  }

  /** Re-clamp after the team changes size. */
  refit(): void {
    this.target = clampScroll(Math.round(this.target), this.count())
    this.kick()
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    window.clearTimeout(this.snapT)
    this.raf = 0
  }

  private snapSoon(ms = 140): void {
    window.clearTimeout(this.snapT)
    this.snapT = window.setTimeout(() => {
      if (this.held) return
      this.target = clampScroll(Math.round(this.target), this.count())
      this.kick()
    }, ms)
  }

  private kick(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.tick)
  }

  private tick = (now: number): void => {
    const dt = this.last ? (now - this.last) / 1000 : 1 / 60
    this.last = now
    this.cur = easeToward(this.cur, this.target, dt, this.reduced)
    const done = this.cur === this.target && !this.held
    this.onChange(this.cur, !done)
    if (done) {
      this.raf = 0
      this.last = 0
      return
    }
    this.raf = requestAnimationFrame(this.tick)
  }
}
