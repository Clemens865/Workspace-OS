/**
 * NEEDS-YOU NOTIFICATIONS — the pure part.
 *
 * The person hears about a waiting approval, a routine that needs a look, a
 * case that is waiting on them, or a sign-in that died — without watching the
 * app. Four sources, each with its own switch; approvals, routines and
 * connectors on by default, cases off (a case changes status because the
 * person just changed it, most of the time).
 *
 * THROTTLED, NOT SILENCED. One notification per thing per ten minutes. The
 * same approval asked twice in a minute is one interruption; a different
 * approval is a different one.
 *
 * No Electron here, so the rules are unit-tested.
 */

export type NotifySource = 'approvals' | 'routines' | 'cases' | 'connectors' | 'test'
export type NotifyRail = 'agents' | 'cockpit' | 'connectors'

export interface NotifyPrefs {
  approvals: boolean
  routines: boolean
  cases: boolean
  connectors: boolean
}

export const DEFAULT_PREFS: NotifyPrefs = { approvals: true, routines: true, cases: false, connectors: true }

export interface NotifyEvent {
  source: NotifySource
  /** What this is about — the throttle key together with the source. */
  key: string
  title: string
  body: string
  /** Where a click lands. */
  rail: NotifyRail
}

export type NotifyDecision = 'show' | 'off' | 'throttled'

export const THROTTLE_MS = 10 * 60_000
const TITLE_MAX = 80
const BODY_MAX = 200

/** Defensive parse of the persisted prefs; unknown or malformed → defaults. */
export function parsePrefs(raw: unknown): NotifyPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pick = (k: keyof NotifyPrefs): boolean => (typeof o[k] === 'boolean' ? (o[k] as boolean) : DEFAULT_PREFS[k])
  return { approvals: pick('approvals'), routines: pick('routines'), cases: pick('cases'), connectors: pick('connectors') }
}

/** Validates an event from an untrusted boundary (the renderer). Null = reject. */
export function sanitizeEvent(input: unknown): NotifyEvent | null {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const source = o.source
  if (source !== 'approvals' && source !== 'routines' && source !== 'cases' && source !== 'connectors' && source !== 'test') return null
  const rail = o.rail === 'cockpit' || o.rail === 'connectors' ? o.rail : 'agents'
  const key = typeof o.key === 'string' ? o.key.trim().slice(0, 120) : ''
  const title = typeof o.title === 'string' ? o.title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) : ''
  const body = typeof o.body === 'string' ? o.body.replace(/\s+/g, ' ').trim().slice(0, BODY_MAX) : ''
  if (!key || !title) return null
  return { source, key, title, body, rail }
}

/** One notification per (source, key) per window. */
export class Throttle {
  private last = new Map<string, number>()
  constructor(
    private readonly windowMs = THROTTLE_MS,
    private readonly now: () => number = Date.now,
  ) {}

  allow(source: string, key: string): boolean {
    const k = `${source}:${key}`
    const t = this.now()
    const prev = this.last.get(k)
    if (prev !== undefined && t - prev < this.windowMs) return false
    this.last.set(k, t)
    // Keep the map from growing forever.
    if (this.last.size > 500) {
      for (const [kk, tt] of this.last) if (t - tt >= this.windowMs) this.last.delete(kk)
    }
    return true
  }
}

export function decide(prefs: NotifyPrefs, throttle: Throttle, ev: NotifyEvent): NotifyDecision {
  if (ev.source !== 'test' && !prefs[ev.source]) return 'off'
  return throttle.allow(ev.source, ev.key) ? 'show' : 'throttled'
}
