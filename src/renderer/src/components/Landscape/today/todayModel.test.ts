import { describe, expect, it } from 'vitest'
import { buildToday, eventWhen, mergeFiles, mergePages, type TodayInput } from './todayModel'

const NOW = new Date('2026-10-02T10:00:00').getTime()
const H = 3600_000

const base = (over: Partial<TodayInput> = {}): TodayInput => ({
  now: NOW,
  cases: [],
  events: [],
  runs: [],
  created: [],
  recent: [],
  openTabs: [],
  history: [],
  mailAccounts: 0,
  mailWaiting: [],
  snoozes: {},
  ...over,
})

const warmCase = { id: 'c1', title: 'Acme offer', status: 'offer', updated: '2026-10-02T09:00:00Z', lastNote: 'Offer in', lastNoteAt: NOW - H, lastNoteAuthor: 'agent' }

describe('buildToday — the hero', () => {
  it('a case waiting on the person leads, and its action opens that case', () => {
    const t = buildToday(base({ cases: [warmCase] }))
    expect(t.hero.kind).toBe('case')
    expect(t.hero.go).toEqual({ to: 'case', caseId: 'c1' })
    expect(t.hero.goSecondary).toEqual({ to: 'cases' })
    expect(t.hero.of).toBe(1)
  })

  it('a snoozed case steps aside until it wakes', () => {
    const t = buildToday(base({ cases: [warmCase], snoozes: { c1: NOW + H } }))
    expect(t.hero.kind).toBe('clear')
    const later = buildToday(base({ cases: [warmCase], snoozes: { c1: NOW - 1 } }))
    expect(later.hero.kind).toBe('case')
  })

  it('a running agent leads the team; the action goes to the team', () => {
    const t = buildToday(base({ runs: [{ runId: 'r', name: 'Nadia', status: 'running', prompt: 'Research', at: NOW, live: 'reading a page' }] }))
    expect(t.hero.kind).toBe('agent')
    expect(t.hero.go).toEqual({ to: 'team' })
  })

  it('a meeting within three hours leads to the calendar surface', () => {
    const t = buildToday(base({ events: [{ uid: 'e', summary: 'Standup', start: NOW + H, end: NOW + 2 * H, allDay: false }] }))
    expect(t.hero.kind).toBe('event')
    expect(t.hero.go).toEqual({ to: 'surface', rail: 'calendar' })
  })

  it('mail waiting for a reply counts as a decision in the summary', () => {
    const t = buildToday(base({ mailWaiting: [{ id: 'm', subject: 'Hi', from: 'A' }] }))
    expect(t.summary).toBe('One decision.')
    expect(buildToday(base()).summary).toBe('All quiet.')
  })
})

describe('buildToday — the cards', () => {
  it('Next lists only events that have not ended, soonest first', () => {
    const t = buildToday(
      base({
        events: [
          { uid: 'b', summary: 'Later', start: NOW + 5 * H, end: NOW + 6 * H, allDay: false },
          { uid: 'a', summary: 'Over', start: NOW - 3 * H, end: NOW - 2 * H, allDay: false },
          { uid: 'c', summary: 'Soon', start: NOW + H, end: NOW + 2 * H, allDay: false },
        ],
      }),
    )
    expect(t.next.map((e) => e.summary)).toEqual(['Soon', 'Later'])
  })

  it('While you were away tells the news in sentences', () => {
    const t = buildToday(base({ cases: [warmCase], runs: [{ runId: 'r', name: 'Felix', status: 'pending', prompt: 'Find grants', at: NOW - 2 * H }] }))
    expect(t.away.map((a) => a.text)).toEqual(['Agent, on Acme offer: Offer in', 'Felix finished: Find grants'])
  })
})

describe('mergeFiles / mergePages', () => {
  it('created files come first, then opened ones, one entry per path', () => {
    const f = mergeFiles(
      [{ path: '/w/new.docx', at: 5 }],
      [
        { path: '/w/new.docx', ts: 9 },
        { path: '/w/old.xlsx', ts: 3 },
      ],
    )
    expect(f).toEqual([
      { path: '/w/new.docx', name: 'new.docx', at: 5, tag: 'new' },
      { path: '/w/old.xlsx', name: 'old.xlsx', at: 3, tag: 'opened' },
    ])
  })

  it('open tabs first, visited pages after, no duplicates', () => {
    const p = mergePages([{ url: 'https://a', title: 'A' }], [{ url: 'https://a' }, { url: 'https://b', title: 'B' }])
    expect(p).toEqual([
      { url: 'https://a', title: 'A', open: true },
      { url: 'https://b', title: 'B', open: false },
    ])
  })
})

describe('eventWhen', () => {
  it('names today, tomorrow and all-day events', () => {
    expect(eventWhen({ uid: '', summary: '', start: NOW, end: NOW, allDay: true }, NOW)).toBe('All day')
    expect(eventWhen({ uid: '', summary: '', start: NOW + H, end: NOW + 2 * H, allDay: false }, NOW)).toMatch(/^Today /)
    expect(eventWhen({ uid: '', summary: '', start: NOW + 24 * H, end: NOW + 25 * H, allDay: false }, NOW)).toMatch(/^Tomorrow /)
  })
})
