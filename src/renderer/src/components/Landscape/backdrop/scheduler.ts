/**
 * When the backdrop draws (PLAN.md §3a: "draw only when something changes").
 *
 * The landscape is drawn into a texture and reused; the screen (landscape copy +
 * glass panes) is composited from it. Each animation frame asks `plan()` what
 * to do. With nothing moving and nobody at the keyboard or mouse for a while,
 * the answer is "nothing, and stop the loop": the last frame stays on screen
 * at zero GPU cost until something wakes it.
 */

export type Quality = 'full' | 'light' | 'off'

/** Mist drift frame interval in Full (10 fps is plenty for slow fog). */
export const DRIFT_MS = 100
/** After this long without input, even the drift stops. */
export const IDLE_MS = 20_000

export interface FrameState {
  now: number
  /** The landscape layer is on screen (not covered by the stage, window visible). */
  visible: boolean
  quality: Quality
  /** Last pointer / key / wheel input. */
  lastInput: number
  /** Something is easing (focus, tint, parallax) or ripples/breath are alive. */
  easing: boolean
  /** Screens are moving: their glass and lake reflections must follow until then. */
  movingUntil: number
  /** Only glass needs to follow (a hover lift, a pill sliding), not the lake. */
  panesUntil: number
  /** The landscape must be redrawn once regardless (first frame, resize, quality change). */
  landDirty: boolean
  /** The pointer moved since the last frame (the glass's cursor light). */
  pointerDirty: boolean
  /** When the landscape was last drawn. */
  lastLand: number
}

export interface FramePlan {
  /** Redraw the landscape texture. */
  land: boolean
  /** Re-place the glass panes from their elements (screens moved). */
  panes: boolean
  /** Composite the screen (landscape copy + glass). */
  screen: boolean
  /** Ask for another animation frame. */
  again: boolean
}

const NOTHING: FramePlan = { land: false, panes: false, screen: false, again: false }

export function plan(s: FrameState): FramePlan {
  if (!s.visible || s.quality === 'off') return NOTHING
  const moving = s.now < s.movingUntil
  const drift = s.quality === 'full' && s.now - s.lastInput < IDLE_MS
  const driftDue = drift && s.now - s.lastLand >= DRIFT_MS
  const follow = s.now < s.panesUntil
  const land = s.landDirty || s.easing || moving || driftDue
  const panes = moving || follow || s.landDirty
  const screen = land || panes || s.pointerDirty
  return { land, panes, screen, again: s.easing || moving || follow || drift }
}
