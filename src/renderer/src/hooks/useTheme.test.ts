import { describe, expect, it } from 'vitest'
import { resolveTheme } from './useTheme'

describe('resolveTheme', () => {
  it('shows the chosen theme, or follows macOS for "system"', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})
