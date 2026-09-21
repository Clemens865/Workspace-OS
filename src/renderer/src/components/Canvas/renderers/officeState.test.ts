import { describe, expect, it } from 'vitest'
import { commandState, menuStateSnapshot, sameSnapshot } from './officeState'

describe('commandState', () => {
  const active = {
    '.uno:Bold': 'true',
    '.uno:Italic': 'false',
    '.uno:Cut': 'disabled',
    '.uno:Paste': 'enabled',
    '.uno:StyleApply': 'Heading 1',
  }
  it('reads toggles, enablement and values from the engine strings', () => {
    expect(commandState(active, '.uno:Bold')).toEqual({ enabled: true, checked: true, value: null })
    expect(commandState(active, '.uno:Italic')).toEqual({ enabled: true, checked: false, value: null })
    expect(commandState(active, '.uno:Cut')).toEqual({ enabled: false, checked: null, value: null })
    expect(commandState(active, '.uno:Paste')).toEqual({ enabled: true, checked: null, value: null })
    expect(commandState(active, '.uno:StyleApply')).toEqual({ enabled: true, checked: null, value: 'Heading 1' })
  })
  it('treats a command the engine never reported as enabled and uncheckable', () => {
    expect(commandState(active, '.uno:Nope')).toEqual({ enabled: true, checked: null, value: null })
  })
})

describe('menuStateSnapshot', () => {
  it('collects every boolean and disabled state, with stable ordering', () => {
    const snap = menuStateSnapshot({ '.uno:Bold': 'true', '.uno:Cut': 'disabled', '.uno:FontHeight': '12', '.uno:Undo': 'disabled' })
    expect(snap).toEqual({ checked: { '.uno:Bold': true }, disabled: ['.uno:Cut', '.uno:Undo'] })
  })
  it('compares snapshots by content so an unchanged state skips the menu rebuild', () => {
    const a = menuStateSnapshot({ '.uno:Bold': 'true', '.uno:Cut': 'disabled' })
    const b = menuStateSnapshot({ '.uno:Bold': 'true', '.uno:Cut': 'disabled', '.uno:CharFontName': 'Arial' })
    const c = menuStateSnapshot({ '.uno:Bold': 'false', '.uno:Cut': 'disabled' })
    expect(sameSnapshot(a, b)).toBe(true)
    expect(sameSnapshot(a, c)).toBe(false)
    expect(sameSnapshot(null, a)).toBe(false)
  })
})
