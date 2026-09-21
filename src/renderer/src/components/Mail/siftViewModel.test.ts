import { describe, it, expect } from 'vitest'
import { briefingLine, zoneRows, groupNoise, mergeVerdicts, parseSiftCache, type SiftRow } from './siftViewModel'

const row = (over: Partial<SiftRow>): SiftRow => ({
  uid: 1,
  folder: 'INBOX',
  zone: 'noise',
  priority: 0,
  summary: 's',
  caseTitle: null,
  fromName: 'Zalando',
  fromAddress: 'style@zalando.de',
  subject: 'Deals',
  date: 100,
  ...over,
})

describe('briefingLine', () => {
  it('mentions only zones that have mail, with honest grammar', () => {
    const rows = [
      row({ uid: 1, zone: 'answer' }),
      row({ uid: 2, zone: 'noise' }),
      row({ uid: 3, zone: 'noise' }),
    ]
    expect(briefingLine(rows)).toBe('3 unread — 1 needs an answer, 2 are noise.')
  })

  it('an empty sift is good news, not an error', () => {
    expect(briefingLine([])).toBe('Nothing unread — a clear inbox.')
  })
})

describe('zoneRows', () => {
  it('sorts by priority, then recency', () => {
    const rows = [
      row({ uid: 1, zone: 'answer', priority: 1, date: 300 }),
      row({ uid: 2, zone: 'answer', priority: 3, date: 100 }),
      row({ uid: 3, zone: 'answer', priority: 1, date: 400 }),
    ]
    expect(zoneRows(rows, 'answer').map((r) => r.uid)).toEqual([2, 3, 1])
  })
})

describe('groupNoise', () => {
  it('groups per sender, biggest first, keeping the newest mail as the opener', () => {
    const rows = [
      row({ uid: 1, date: 100 }),
      row({ uid: 2, date: 900 }),
      row({ uid: 3, fromName: 'TUI', fromAddress: 'x@tui.at' }),
    ]
    const groups = groupNoise(rows)
    expect(groups.map((g) => [g.label, g.count])).toEqual([
      ['Zalando', 2],
      ['TUI', 1],
    ])
    expect(groups[0].top.uid).toBe(2)
  })
})

describe('mergeVerdicts', () => {
  it('fresh wins on a shared uid, union pruned to what is still unread', () => {
    const cached = [row({ uid: 1, zone: 'answer' }), row({ uid: 2 }), row({ uid: 3 })]
    const fresh = [row({ uid: 1, zone: 'noise' }), row({ uid: 4, zone: 'glance' })]
    const merged = mergeVerdicts(cached, fresh, [1, 3, 4])
    expect(merged.map((r) => [r.uid, r.zone]).sort()).toEqual([
      [1, 'noise'], // re-judged: fresh verdict replaced the cached one
      [3, 'noise'], // cached, still unread → kept
      [4, 'glance'], // new
    ]) // uid 2 was read elsewhere → gone
  })

  it('an empty refresh still prunes — reading mail elsewhere shrinks the sift', () => {
    const cached = [row({ uid: 1 }), row({ uid: 2 })]
    expect(mergeVerdicts(cached, [], [2]).map((r) => r.uid)).toEqual([2])
  })
})

describe('parseSiftCache', () => {
  const none = { rows: [], briefing: null }

  it('round-trips the current form and reads garbage as no cache', () => {
    const rows = [row({ uid: 7 })]
    expect(parseSiftCache(JSON.stringify({ rows, briefing: 'Anna is waiting.' }))).toEqual({
      rows,
      briefing: 'Anna is waiting.',
    })
    expect(parseSiftCache(null)).toEqual(none)
    expect(parseSiftCache('not json')).toEqual(none)
    expect(parseSiftCache('{"a":1}')).toEqual(none)
    expect(parseSiftCache('[{"broken":true}]')).toEqual(none)
  })

  it('accepts the v1 bare-array form with no briefing — old caches survive', () => {
    const rows = [row({ uid: 7 })]
    expect(parseSiftCache(JSON.stringify(rows))).toEqual({ rows, briefing: null })
  })
})
