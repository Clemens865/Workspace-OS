import { describe, it, expect } from 'vitest'
import {
  initialState, onConnecting, onConnected, onFailure, onStop,
  shouldRetry, backoffFor, newUidsSince,
} from './idle-watcher'

/**
 * A persistent connection fails quietly. These tests are about the three quiet
 * failures: never coming back, hammering a server that is rejecting us, and
 * outliving the logout that was supposed to end it.
 */

describe('backoffFor', () => {
  it('grows exponentially', () => {
    expect(backoffFor(1, { baseDelayMs: 1000 })).toBe(1000)
    expect(backoffFor(2, { baseDelayMs: 1000 })).toBe(2000)
    expect(backoffFor(3, { baseDelayMs: 1000 })).toBe(4000)
  })

  it('is capped, so a long outage cannot schedule a retry days away', () => {
    expect(backoffFor(40, { baseDelayMs: 1000, maxDelayMs: 60_000 })).toBe(60_000)
  })
})

describe('lifecycle', () => {
  it('goes idle → connecting → watching', () => {
    const s = onConnected(onConnecting(initialState()))
    expect(s.state).toBe('watching')
  })

  it('RESETS the failure count on a successful connect', () => {
    // Otherwise a flaky network slowly walks the watcher to its give-up limit
    // even though it keeps recovering.
    let s = onFailure(onFailure(initialState(), {}), {})
    expect(s.failures).toBe(2)
    s = onConnected(s)
    expect(s.failures).toBe(0)
  })

  it('backs off after a failure and asks to retry', () => {
    const s = onFailure(initialState(), { code: 'host' })
    expect(s.state).toBe('backoff')
    expect(shouldRetry(s)).toBe(true)
    expect(s.nextDelayMs).toBeGreaterThan(0)
  })
})

describe('the quiet failures', () => {
  it('stops IMMEDIATELY on an auth failure instead of retrying', () => {
    // Credentials do not fix themselves. Hammering a server with a rejected
    // password is how an account gets locked.
    const s = onFailure(initialState(), { code: 'auth' })
    expect(s.state).toBe('stopped')
    expect(shouldRetry(s)).toBe(false)
    expect(s.stoppedReason).toContain('rejected')
  })

  it('gives up after repeated failures rather than retrying forever', () => {
    // A watcher that never gives up hides a broken account behind an inbox
    // that merely looks quiet.
    let s = initialState()
    for (let i = 0; i < 8; i++) s = onFailure(s, { code: 'host' }, { maxFailures: 8 })
    expect(s.state).toBe('stopped')
    expect(s.stoppedReason).toContain('8 attempts')
  })

  it('an explicit stop is terminal — it cannot be revived by a callback', () => {
    // The dangerous one: an in-flight reconnect landing after logout and
    // resuming with credentials the user believes they revoked.
    const stopped = onStop(initialState(), 'signed out')
    expect(onConnecting(stopped).state).toBe('stopped')
    expect(onConnected(stopped).state).toBe('stopped')
    expect(onFailure(stopped, {}).state).toBe('stopped')
    expect(shouldRetry(stopped)).toBe(false)
  })
})

describe('newUidsSince', () => {
  it('reports only uids above the watermark', () => {
    expect(newUidsSince([8, 9, 10, 11], 9)).toEqual([10, 11])
  })

  it('reports nothing on a replay of what we already knew', () => {
    // A reconnect re-announces; without this the user is notified about mail
    // they read an hour ago.
    expect(newUidsSince([1, 2, 3], 3)).toEqual([])
  })

  it('sorts ascending so notifications arrive in arrival order', () => {
    expect(newUidsSince([12, 10, 11], 9)).toEqual([10, 11, 12])
  })

  it('handles an empty announcement', () => {
    expect(newUidsSince([], 5)).toEqual([])
  })
})
