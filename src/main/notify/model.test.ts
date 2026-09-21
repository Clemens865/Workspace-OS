import { describe, it, expect } from 'vitest'
import { DEFAULT_PREFS, Throttle, decide, parsePrefs, sanitizeEvent, THROTTLE_MS } from './model'

const ev = (over = {}) => ({ source: 'approvals' as const, key: 's1', title: 'Elias', body: 'May I run npm test?', rail: 'agents' as const, ...over })

describe('notify model', () => {
  it('prefs: defaults, partial, malformed', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS)
    expect(parsePrefs({ cases: true })).toEqual({ ...DEFAULT_PREFS, cases: true })
    expect(parsePrefs({ approvals: 'yes' })).toEqual(DEFAULT_PREFS)
    expect(DEFAULT_PREFS.cases).toBe(false)
  })

  it('sanitizeEvent: rejects unknown sources and empty keys, clips and collapses text', () => {
    expect(sanitizeEvent({ source: 'mail', key: 'x', title: 't' })).toBeNull()
    expect(sanitizeEvent({ source: 'approvals', key: '', title: 't' })).toBeNull()
    expect(sanitizeEvent({ source: 'approvals', key: 'k', title: '' })).toBeNull()
    const e = sanitizeEvent({ source: 'routines', key: ' bg-1 ', title: 'A\n\nB', body: 'x'.repeat(500), rail: 'nowhere' })!
    expect(e).toMatchObject({ source: 'routines', key: 'bg-1', title: 'A B', rail: 'agents' })
    expect(e.body.length).toBe(200)
    expect(sanitizeEvent({ source: 'connectors', key: 'k', title: 't', rail: 'connectors' })?.rail).toBe('connectors')
  })

  it('throttle: one per (source,key) per window; different keys are independent', () => {
    let now = 0
    const t = new Throttle(THROTTLE_MS, () => now)
    expect(t.allow('approvals', 'a')).toBe(true)
    expect(t.allow('approvals', 'a')).toBe(false)
    expect(t.allow('approvals', 'b')).toBe(true)
    expect(t.allow('routines', 'a')).toBe(true)
    now = THROTTLE_MS - 1
    expect(t.allow('approvals', 'a')).toBe(false)
    now = THROTTLE_MS
    expect(t.allow('approvals', 'a')).toBe(true)
  })

  it('decide: a switched-off source is off, not throttled; test always passes prefs', () => {
    const t = new Throttle(THROTTLE_MS, () => 0)
    expect(decide({ ...DEFAULT_PREFS, approvals: false }, t, ev())).toBe('off')
    expect(decide(DEFAULT_PREFS, t, ev())).toBe('show')
    expect(decide(DEFAULT_PREFS, t, ev())).toBe('throttled')
    expect(decide({ approvals: false, routines: false, cases: false, connectors: false }, t, ev({ source: 'test', key: 'x' }))).toBe('show')
  })
})
