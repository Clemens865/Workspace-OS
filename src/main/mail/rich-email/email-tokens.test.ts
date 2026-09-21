import { describe, it, expect } from 'vitest'
import { resolveLiveTokens, type MetricLookup } from './email-tokens'

/** A tiny in-memory metric lookup for the tests. */
function fakeMetrics(map: Record<string, number>): MetricLookup {
  return { get: (id) => (id in map ? { value: map[id] } : undefined) }
}

describe('resolveLiveTokens', () => {
  it('replaces a known {{metric:id}} with its live value', () => {
    const m = fakeMetrics({ mrr: 42000 })
    const r = resolveLiveTokens('Our MRR is {{metric:mrr}} this month.', m)
    expect(r.text).toBe('Our MRR is 42000 this month.')
    expect(r.unresolved).toEqual([])
  })

  it('resolves multiple tokens, including repeated ids', () => {
    const m = fakeMetrics({ users: 1200, mrr: 42000 })
    const r = resolveLiveTokens('{{metric:users}} users, {{metric:mrr}} MRR, still {{metric:users}}.', m)
    expect(r.text).toBe('1200 users, 42000 MRR, still 1200.')
    expect(r.unresolved).toEqual([])
  })

  it('tolerates inner whitespace in the token', () => {
    const m = fakeMetrics({ mrr: 500 })
    const r = resolveLiveTokens('{{ metric: mrr }}', m)
    expect(r.text).toBe('500')
  })

  it('leaves an unknown id as a VISIBLE placeholder and reports it (never blank)', () => {
    const m = fakeMetrics({})
    const r = resolveLiveTokens('Value: {{metric:ghost}}', m)
    expect(r.text).toContain('[metric ghost unavailable]')
    expect(r.text).not.toBe('Value: ') // not silently blanked
    expect(r.unresolved).toEqual([{ token: '{{metric:ghost}}', id: 'ghost', reason: 'unknown' }])
  })

  it('treats a non-finite value as unreadable — placeholder + reported, keeps nothing blank', () => {
    const m: MetricLookup = { get: () => ({ value: NaN }) }
    const r = resolveLiveTokens('{{metric:broken}}', m)
    expect(r.text).toContain('[metric broken unavailable]')
    expect(r.unresolved).toEqual([{ token: '{{metric:broken}}', id: 'broken', reason: 'unreadable' }])
  })

  it('coerces non-string input to empty (boundary safety, no throw)', () => {
    const m = fakeMetrics({})
    const r = resolveLiveTokens(undefined, m)
    expect(r.text).toBe('')
    expect(r.unresolved).toEqual([])
  })

  it('leaves text without tokens untouched', () => {
    const m = fakeMetrics({ mrr: 1 })
    const r = resolveLiveTokens('No tokens here.', m)
    expect(r.text).toBe('No tokens here.')
    expect(r.unresolved).toEqual([])
  })
})
