import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  requestNewTab,
  requestTabs,
  requestCloseTab,
  requestActivateTab,
  NEW_TAB_TIMEOUT_MS,
  TAB_COMMAND_EVENT,
  type TabCommand,
} from './browserTabCommands'

/**
 * A stand-in for the BrowserSurface command-bus listener: capture the last
 * dispatched TabCommand so a test can drive its `resolve` the way BrowserSurface
 * does (newTab resolves ONLY after the tab's guest registers).
 */
function installBus() {
  let last: TabCommand | undefined
  const listener = vi.fn((detail: TabCommand) => { last = detail })
  const g = globalThis as Record<string, unknown>
  const prevWindow = g.window
  const prevCE = g.CustomEvent
  g.CustomEvent = class {
    type: string; detail: unknown
    constructor(type: string, init?: { detail?: unknown }) { this.type = type; this.detail = init?.detail }
  }
  g.window = {
    dispatchEvent: (e: { type: string; detail: TabCommand }) => {
      if (e.type === TAB_COMMAND_EVENT) listener(e.detail)
      return true
    },
  }
  return { get last() { return last }, restore: () => { g.window = prevWindow; g.CustomEvent = prevCE } }
}

describe('browserTabCommands — newTab id round-trip', () => {
  let bus: ReturnType<typeof installBus>
  beforeEach(() => { vi.useFakeTimers(); bus = installBus() })
  afterEach(() => { bus.restore(); vi.useRealTimers() })

  it('resolves with the tab id ONLY after the surface registers the guest', async () => {
    const p = requestNewTab('https://a.test/', true)
    // The surface received the command with a resolve callback + the url/focus.
    const cmd = bus.last!
    expect(cmd.kind).toBe('newTab')
    if (cmd.kind !== 'newTab') throw new Error('expected newTab')
    expect(cmd.url).toBe('https://a.test/')
    expect(cmd.focus).toBe(true)
    // Simulate BrowserSurface fulfilling the resolver once the guest registered.
    cmd.resolve({ ok: true, tabId: 'tab-xyz', url: 'https://a.test/' })
    await expect(p).resolves.toEqual({ ok: true, tabId: 'tab-xyz', url: 'https://a.test/' })
  })

  it('times out with a clear error when no surface ever registers the tab', async () => {
    const p = requestNewTab('https://a.test/')
    vi.advanceTimersByTime(NEW_TAB_TIMEOUT_MS + 10)
    await expect(p).resolves.toEqual({ ok: false, error: expect.stringMatching(/timed out/) })
  })

  it('the FIRST resolution wins (a late register after timeout is ignored)', async () => {
    const p = requestNewTab()
    const cmd = bus.last!
    if (cmd.kind !== 'newTab') throw new Error('expected newTab')
    vi.advanceTimersByTime(NEW_TAB_TIMEOUT_MS + 10) // timeout fires first
    cmd.resolve({ ok: true, tabId: 'late' }) // ignored — already settled
    await expect(p).resolves.toEqual({ ok: false, error: expect.stringMatching(/timed out/) })
  })
})

describe('browserTabCommands — tabs/close/activate', () => {
  let bus: ReturnType<typeof installBus>
  beforeEach(() => { vi.useFakeTimers(); bus = installBus() })
  afterEach(() => { bus.restore(); vi.useRealTimers() })

  it('tabs resolves the surface list, close/activate resolve {ok}', async () => {
    const pt = requestTabs()
    const ct = bus.last!
    if (ct.kind !== 'tabs') throw new Error('expected tabs')
    ct.resolve([{ id: 't1', url: 'https://a', title: 'A', active: true }])
    await expect(pt).resolves.toEqual([{ id: 't1', url: 'https://a', title: 'A', active: true }])

    const pc = requestCloseTab('t1')
    const cc = bus.last!
    if (cc.kind !== 'closeTab') throw new Error('expected closeTab')
    expect(cc.id).toBe('t1')
    cc.resolve({ ok: true })
    await expect(pc).resolves.toEqual({ ok: true })

    const pa = requestActivateTab('t2')
    const ca = bus.last!
    if (ca.kind !== 'activateTab') throw new Error('expected activateTab')
    expect(ca.id).toBe('t2')
    ca.resolve({ ok: false })
    await expect(pa).resolves.toEqual({ ok: false })
  })

  it('tabs falls back to [] when no surface answers (timeout)', async () => {
    const pt = requestTabs()
    vi.advanceTimersByTime(2100)
    await expect(pt).resolves.toEqual([])
  })
})
