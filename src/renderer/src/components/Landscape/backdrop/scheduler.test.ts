import { describe, it, expect } from 'vitest'
import { plan, DRIFT_MS, IDLE_MS, type FrameState } from './scheduler'

const base = (o: Partial<FrameState> = {}): FrameState => ({
  now: 100_000,
  visible: true,
  quality: 'full',
  lastInput: 0,
  easing: false,
  movingUntil: 0,
  panesUntil: 0,
  landDirty: false,
  pointerDirty: false,
  lastLand: 0,
  ...o,
})

describe('backdrop scheduler', () => {
  it('draws nothing and stops when idle (the 0 fps budget)', () => {
    expect(plan(base())).toEqual({ land: false, panes: false, screen: false, again: false })
  })

  it('draws nothing while the stage covers the landscape or the window is hidden', () => {
    expect(plan(base({ visible: false, landDirty: true, easing: true }))).toEqual({ land: false, panes: false, screen: false, again: false })
  })

  it('draws nothing in Off', () => {
    expect(plan(base({ quality: 'off', landDirty: true })).screen).toBe(false)
  })

  it('draws once when the landscape is dirty, then may stop', () => {
    const p = plan(base({ landDirty: true }))
    expect(p).toMatchObject({ land: true, panes: true, screen: true, again: false })
  })

  it('follows moving screens every frame until they settle', () => {
    expect(plan(base({ movingUntil: 100_500 }))).toEqual({ land: true, panes: true, screen: true, again: true })
    expect(plan(base({ movingUntil: 99_000 })).again).toBe(false)
  })

  it('a hover lift moves only the glass, not the landscape', () => {
    expect(plan(base({ panesUntil: 100_300 }))).toEqual({ land: false, panes: true, screen: true, again: true })
  })

  it('a pointer move only re-composites the glass (cursor light), not the landscape', () => {
    expect(plan(base({ pointerDirty: true }))).toEqual({ land: false, panes: false, screen: true, again: false })
  })

  it('drifts the mist at 10 fps in Full while someone is around', () => {
    const recent = base({ lastInput: 99_000, lastLand: 100_000 - DRIFT_MS / 2 })
    expect(plan(recent)).toMatchObject({ land: false, again: true })
    expect(plan({ ...recent, lastLand: 100_000 - DRIFT_MS })).toMatchObject({ land: true, again: true })
  })

  it('stops drifting after the idle timeout', () => {
    expect(plan(base({ lastInput: 100_000 - IDLE_MS - 1, lastLand: 0 })).again).toBe(false)
  })

  it('never drifts in Light: the landscape is frozen', () => {
    expect(plan(base({ quality: 'light', lastInput: 99_999, lastLand: 0 }))).toMatchObject({ land: false, again: false })
  })

  it('still eases in Light (focus and ripples are feedback, not decoration)', () => {
    expect(plan(base({ quality: 'light', easing: true }))).toMatchObject({ land: true, again: true })
  })
})
