import { describe, it, expect } from 'vitest'
import { windowChrome } from './window-chrome'

describe('windowChrome', () => {
  it('macOS keeps the full-screen window with the hidden title bar', () => {
    expect(windowChrome('darwin')).toEqual({ options: { fullscreen: true, titleBarStyle: 'hiddenInset' }, maximize: false })
  })

  it('Windows and Linux get the system title bar, a maximised window and the taskbar', () => {
    for (const p of ['win32', 'linux'] as const) {
      const c = windowChrome(p)
      expect(c.options.fullscreen).toBe(false)
      expect(c.options.titleBarStyle).toBeUndefined()
      expect(c.options.frame).toBeUndefined()
      expect(c.maximize).toBe(true)
    }
  })
})
