import { describe, it, expect } from 'vitest'
import { pickHero, deskSummary, buildDeskAsk, parseSnoozes, nextMorning } from './deskModel'

const NOW = 1_700_000_000_000

describe('pickHero — one loud thing, ranked', () => {
  it('a waiting case beats everything', () => {
    const h = pickHero({
      warmCases: [
        { id: 'a', title: 'fonio', status: 'drafted', updated: '2026-08-20' },
        { id: 'b', title: 'ALPLA', status: 'interview', updated: '2026-08-22' },
      ],
      running: [{ runId: 'r', name: 'Jonas' }],
      nextEvent: { summary: 'Standup', start: NOW + 60_000 },
      now: NOW,
    })
    expect(h.kind).toBe('case')
    // The WARMEST (most recently updated) case wins, with status-specific language.
    expect(h.headline).toBe('ALPLA moved you to interview.')
    expect(h.primary.go).toBe('cockpit')
  })

  it('with no decisions, a running agent is the story — with its live line', () => {
    const h = pickHero({
      warmCases: [],
      running: [
        { runId: 'r1', name: 'Jonas', live: 'scoring karriere.at' },
        { runId: 'r2', name: 'Mira' },
      ],
      nextEvent: null,
      now: NOW,
    })
    expect(h.kind).toBe('agent')
    expect(h.headline).toBe('Jonas is on it — and 1 more.')
    expect(h.sub).toContain('scoring karriere.at')
  })

  it('a meeting counts only when it is CLOSE — three hours, not next week', () => {
    const near = pickHero({ warmCases: [], running: [], nextEvent: { summary: 'Interview', start: NOW + 2 * 3600_000 }, now: NOW })
    expect(near.kind).toBe('event')
    const far = pickHero({ warmCases: [], running: [], nextEvent: { summary: 'Interview', start: NOW + 26 * 3600_000 }, now: NOW })
    expect(far.kind).toBe('clear')
  })

  it('the empty state is an invitation, not an apology', () => {
    const h = pickHero({ warmCases: [], running: [], nextEvent: null, now: NOW })
    expect(h.kind).toBe('clear')
    expect(h.headline).toBe('A clear desk.')
    expect(h.primary.go).toBe('agents')
  })

  it('an unknown warm status still reads as a sentence', () => {
    const h = pickHero({
      warmCases: [{ id: 'x', title: 'Tender X', status: 'review', updated: '2026-08-22' }],
      running: [], nextEvent: null, now: NOW,
    })
    expect(h.headline).toBe('Tender X is waiting on you.')
  })
})

describe('deskSummary', () => {
  it('composes the greeting half', () => {
    expect(deskSummary(2, 1)).toBe('2 decisions, one agent out.')
    expect(deskSummary(1, 0)).toBe('One decision.')
    expect(deskSummary(0, 3)).toBe('3 agents out.')
    expect(deskSummary(0, 0)).toBe('All quiet.')
  })
})

describe('buildDeskAsk', () => {
  it('grounds the assistant in exactly what the desk shows, with lookup paths', () => {
    const p = buildDeskAsk('what should I do first?', {
      cases: [{ id: 'alpla', title: 'ALPLA', status: 'interview' }],
      events: [{ summary: 'Interview prep', start: NOW, allDay: false }],
      running: [{ name: 'Jonas', live: 'scoring karriere.at' }],
      files: ['/w/Founder_Operator_Roles.xlsx'],
      pages: [{ title: 'ALPLA careers', url: 'https://x' }],
    })
    expect(p).toContain('ALPLA [interview] (id: alpla)')
    expect(p).toContain('Jonas (scoring karriere.at)')
    expect(p).toContain('cases.get --id')
    expect(p).toContain('Founder_Operator_Roles.xlsx')
  })

  it('empty desks say so honestly and a blank instruction becomes a briefing ask', () => {
    const p = buildDeskAsk('  ', { cases: [], events: [], running: [], files: [], pages: [] })
    expect(p).toContain('short briefing')
    expect(p).toContain('Cases: none open.')
    expect(p).not.toContain('Recent files:')
  })
})

describe('hero snooze', () => {
  const NOW = 1_700_000_000_000
  it('parseSnoozes prunes expired and survives garbage', () => {
    const raw = JSON.stringify({ a: NOW + 1000, b: NOW - 1000, c: 'nope' })
    expect(parseSnoozes(raw, NOW)).toEqual({ a: NOW + 1000 })
    expect(parseSnoozes('not json', NOW)).toEqual({})
    expect(parseSnoozes(null, NOW)).toEqual({})
  })
  it('nextMorning rolls to the NEXT 05:00, never backwards', () => {
    const at9 = new Date(2026, 8, 2, 9, 0).getTime()
    const wake9 = new Date(nextMorning(at9))
    expect(wake9.getHours()).toBe(5)
    expect(wake9.getTime()).toBeGreaterThan(at9)
    const at2340 = new Date(2026, 8, 2, 23, 40).getTime()
    const wakeLate = new Date(nextMorning(at2340))
    expect(wakeLate.getDate()).toBe(3) // tomorrow, not midnight tonight
  })
  it('a case hero carries its caseId for snoozing', () => {
    const h = pickHero({ warmCases: [{ id: 'x', title: 'X', status: 'drafted', updated: '2026-01-01' }], running: [], nextEvent: null, now: NOW })
    expect(h.kind).toBe('case')
    expect(h.caseId).toBe('x')
  })
})
