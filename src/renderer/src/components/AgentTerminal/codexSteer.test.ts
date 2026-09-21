import { describe, expect, it } from 'vitest'
import { claimRun, settleRun, steerTarget } from './codexSteer'

describe('Codex steer gate', () => {
  it('a Codex run is a steer target from submit time, before main has answered', () => {
    const owned = new Set<string>()
    claimRun(owned, 'r1', 'codex:')
    expect(steerTarget(owned, ['r1'])).toBe('r1') // typed 2 s later: steer, do not start a second thread
  })
  it('a Claude pick is never steered, and the main reply settles a wrong guess either way', () => {
    const owned = new Set<string>()
    claimRun(owned, 'r2', 'haiku')
    expect(steerTarget(owned, ['r2'])).toBeUndefined()
    settleRun(owned, 'r2', 'codex')
    expect(steerTarget(owned, ['r2'])).toBe('r2')
    settleRun(owned, 'r2', 'claude')
    expect(steerTarget(owned, ['r2'])).toBeUndefined()
  })
  it('switching the dropdown mid-run does not matter: a running Codex turn is steered', () => {
    const owned = new Set(['r3'])
    expect(steerTarget(owned, ['r0', 'r3'])).toBe('r3')
    expect(steerTarget(owned, [])).toBeUndefined() // finished: a new run starts
  })
})
