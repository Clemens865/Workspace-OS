import { describe, expect, it } from 'vitest'
import { keyLabel, keysIn } from './platform'

describe('platform key labels', () => {
  it('keeps Mac notation on a Mac', () => {
    expect(keyLabel('⌥⌘J', true)).toBe('⌥⌘J')
    expect(keysIn('Hide (⌘J)', true)).toBe('Hide (⌘J)')
  })
  it('writes Ctrl, Alt and Shift elsewhere, in that order', () => {
    expect(keyLabel('⌘K', false)).toBe('Ctrl+K')
    expect(keyLabel('⌥⌘J', false)).toBe('Ctrl+Alt+J')
    expect(keyLabel('⇧⌘Z', false)).toBe('Ctrl+Shift+Z')
    expect(keyLabel('⇧⌥⌘V', false)).toBe('Ctrl+Alt+Shift+V')
    expect(keyLabel('⇧⏎', false)).toBe('Shift+Enter')
    expect(keyLabel('⌘−', false)).toBe('Ctrl+-')
    expect(keyLabel('⇧⌘F9', false)).toBe('Ctrl+Shift+F9')
    expect(keyLabel('Esc', false)).toBe('Esc')
  })
  it('rewrites every shortcut inside a text', () => {
    expect(keysIn('⌘P to open a file · ⌘K to search contents', false)).toBe('Ctrl+P to open a file · Ctrl+K to search contents')
    expect(keysIn('Find… (Enter / ⇧Enter)', false)).toBe('Find… (Enter / Shift+Enter)')
    expect(keysIn('Restore the terminal (⌥⌘J)', false)).toBe('Restore the terminal (Ctrl+Alt+J)')
  })
})
