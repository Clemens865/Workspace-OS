/**
 * New-mail watching — the reconnect policy, as a pure state machine.
 *
 * IDLE is the first LONG-LIVED connection in this codebase. Everything else
 * here is connect → do one thing → log out, which is forgiving: a failure
 * affects one operation and the next call starts clean. A persistent connection
 * is not forgiving, and the ways it goes wrong are all quiet:
 *
 *   - it drops and never comes back, so mail silently stops arriving
 *   - it reconnects in a tight loop against a server that is rejecting us,
 *     which is how an account gets rate-limited or locked
 *   - it survives a logout or an account removal and keeps polling with
 *     credentials the user believes they revoked
 *
 * So the policy lives here, pure and tested, rather than being implicit in
 * whatever `setTimeout` calls ended up in the connection code. The I/O wrapper
 * asks this what to do next; it never decides for itself.
 */

export type WatchState = 'idle' | 'connecting' | 'watching' | 'backoff' | 'stopped'

export interface WatcherPolicy {
  /** First retry delay in ms. */
  baseDelayMs?: number
  /** Ceiling, so a long outage does not schedule a retry days away. */
  maxDelayMs?: number
  /**
   * Consecutive failures after which we stop retrying entirely and surface the
   * problem. A watcher that retries forever hides a broken account behind an
   * inbox that merely looks quiet.
   */
  maxFailures?: number
}

export interface WatcherState {
  state: WatchState
  failures: number
  /** Delay before the next attempt, or null when no retry is scheduled. */
  nextDelayMs: number | null
  /** Non-secret reason the watcher gave up, when it has. */
  stoppedReason: string | null
}

export function initialState(): WatcherState {
  return { state: 'idle', failures: 0, nextDelayMs: null, stoppedReason: null }
}

const DEFAULTS: Required<WatcherPolicy> = {
  baseDelayMs: 2_000,
  maxDelayMs: 5 * 60_000,
  maxFailures: 8,
}

/**
 * Exponential backoff with a ceiling.
 *
 * Deterministic — no jitter — because a single desktop client is not a
 * thundering herd, and a predictable delay is far easier to reason about when
 * someone reports "it stopped updating".
 */
export function backoffFor(failures: number, policy: WatcherPolicy = {}): number {
  const { baseDelayMs, maxDelayMs } = { ...DEFAULTS, ...policy }
  const raw = baseDelayMs * 2 ** Math.max(0, failures - 1)
  return Math.min(maxDelayMs, raw)
}

/** A connection attempt has begun. */
export function onConnecting(s: WatcherState): WatcherState {
  if (s.state === 'stopped') return s
  return { ...s, state: 'connecting', nextDelayMs: null }
}

/** Connected and idling. Resets the failure count — recovery must be complete. */
export function onConnected(s: WatcherState): WatcherState {
  if (s.state === 'stopped') return s
  return { state: 'watching', failures: 0, nextDelayMs: null, stoppedReason: null }
}

/**
 * The connection failed or dropped.
 *
 * An auth failure is terminal immediately rather than retried: credentials do
 * not fix themselves, and hammering a server with a rejected password is how an
 * account gets locked. Everything else backs off.
 */
export function onFailure(
  s: WatcherState,
  reason: { code?: string; message?: string } = {},
  policy: WatcherPolicy = {},
): WatcherState {
  if (s.state === 'stopped') return s
  const { maxFailures } = { ...DEFAULTS, ...policy }

  if (reason.code === 'auth') {
    return {
      state: 'stopped',
      failures: s.failures + 1,
      nextDelayMs: null,
      stoppedReason: 'Sign-in was rejected, so watching for new mail stopped. Reconnect the account.',
    }
  }

  const failures = s.failures + 1
  if (failures >= maxFailures) {
    return {
      state: 'stopped',
      failures,
      nextDelayMs: null,
      stoppedReason: `Could not keep a connection open after ${failures} attempts. Watching stopped; refresh manually.`,
    }
  }
  return { state: 'backoff', failures, nextDelayMs: backoffFor(failures, policy), stoppedReason: null }
}

/** Explicit stop — logout, account removal, app quit. Always terminal. */
export function onStop(s: WatcherState, reason = 'Stopped.'): WatcherState {
  return { state: 'stopped', failures: s.failures, nextDelayMs: null, stoppedReason: reason }
}

/** True when the caller should schedule another attempt. */
export function shouldRetry(s: WatcherState): boolean {
  return s.state === 'backoff' && s.nextDelayMs !== null
}

/**
 * Decides what a batch of newly-seen uids means for notification.
 *
 * Servers re-announce; a reconnect can replay what we already knew. Only uids
 * above the watermark are new, or a reconnect notifies the user about mail they
 * read an hour ago.
 */
export function newUidsSince(seen: number[], watermark: number): number[] {
  return seen.filter((u) => u > watermark).sort((a, b) => a - b)
}
