import { describe, it, expect } from 'vitest'
import { windowChrome } from './window-chrome'

describe('windowChrome', () => {
  it('macOS keeps the full-screen window with the hidden title bar, whatever the setting', () => {
    for (const style of ['standard', 'clean'] as const) {
      expect(windowChrome('darwin', style)).toEqual({ options: { fullscreen: true, titleBarStyle: 'hiddenInset' }, maximize: false, style: 'mac' })
    }
  })

  it('Windows and Linux default to the system title bar, a maximised window and the taskbar', () => {
    for (const p of ['win32', 'linux'] as const) {
      const c = windowChrome(p)
      expect(c.options.fullscreen).toBe(false)
      expect(c.options.titleBarStyle).toBeUndefined()
      expect(c.options.frame).toBeUndefined()
      expect(c.maximize).toBe(true)
      expect(c.style).toBe('standard')
    }
  })

  it('the clean style hides the title bar but stays a normal maximised window', () => {
    for (const p of ['win32', 'linux'] as const) {
      const c = windowChrome(p, 'clean')
      expect(c.options.titleBarStyle).toBe('hidden')
      expect(c.options.fullscreen).toBe(false)
      expect(c.options.titleBarOverlay).toBeUndefined()
      expect(c.maximize).toBe(true)
      expect(c.style).toBe('clean')
    }
  })
})
