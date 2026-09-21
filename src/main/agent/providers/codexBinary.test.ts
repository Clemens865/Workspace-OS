import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ exec: vi.fn() }))
vi.mock('fs', () => ({ default: { existsSync: () => false, readFileSync: () => { throw new Error('none') } } }))
vi.mock('child_process', () => ({ execFileSync: m.exec }))
import { resolveCodexBinary } from './codex'

describe('resolveCodexBinary on a machine without Codex', () => {
  beforeEach(() => { vi.useFakeTimers(); m.exec.mockReset(); m.exec.mockImplementation(() => { throw new Error('not found') }) })
  afterEach(() => vi.useRealTimers())
  it('remembers a miss instead of running a login shell on every catalog call', () => {
    expect(() => resolveCodexBinary()).toThrow(/not found/)
    expect(() => resolveCodexBinary()).toThrow(/not found/)
    expect(() => resolveCodexBinary()).toThrow(/not found/)
    expect(m.exec).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(61_000)
    expect(() => resolveCodexBinary()).toThrow(/not found/)
    expect(m.exec).toHaveBeenCalledTimes(2) // re-probed after the TTL, so a fresh install is picked up
  })
})
