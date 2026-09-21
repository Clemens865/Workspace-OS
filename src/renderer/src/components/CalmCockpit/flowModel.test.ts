import { describe, it, expect } from 'vitest'
import { buildFlow, areasIn, wantsYou, STALE_DAYS } from './flowModel'
import type { WorkCase } from '../../types/workspace-api'

/**
 * The Head-of river, from real cases.
 *
 * What is worth testing is not that cases land in columns — it is that the ONE
 * warm zone means something. A view where every stage glows is a view nobody
 * reads, and it is the failure this altitude is most likely to slide into.
 */

const NOW = Date.UTC(2026, 7, 18, 12, 0)
const DAY = 86_400_000
const APPLICATION = ['drafted', 'applied', 'interview', 'offer', 'accepted', 'rejected', 'not-applied']
const TERMINAL = new Set(['accepted', 'rejected', 'not-applied', 'closed'])

function c(over: Partial<WorkCase> & { id: string; status: string }): WorkCase {
  return {
    type: 'application',
    title: over.id,
    description: '',
    subject: '',
    artifacts: [],
    acted: [],
    notes: [],
    created: new Date(NOW).toISOString(),
    updated: new Date(NOW).toISOString(),
    ...over,
  } as WorkCase
}

const daysAgo = (n: number): string => new Date(NOW - n * DAY).toISOString()

describe('areasIn', () => {
  it('puts the busiest area first, so the view opens where the work is', () => {
    const cases = [
      c({ id: 'a', status: 'drafted', type: 'task' }),
      c({ id: 'b', status: 'drafted' }),
      c({ id: 'c', status: 'applied' }),
    ]
    expect(areasIn(cases)).toEqual(['application', 'task'])
  })

  it('says nothing when there is nothing', () => {
    expect(areasIn([])).toEqual([])
  })
})

describe('wantsYou', () => {
  it('is an unanswered offer', () => {
    const one = c({ id: 'x', status: 'applied', signals: [{ kind: 'schedule', label: 'l', value: '1' }] })
    expect(wantsYou(one, NOW, TERMINAL)).toBe('asked for something')
  })

  it('counts them when there is more than one', () => {
    const two = c({
      id: 'x',
      status: 'applied',
      signals: [
        { kind: 'schedule', label: 'l', value: '1' },
        { kind: 'research-person', label: 'l', value: 'A' },
      ],
    })
    expect(wantsYou(two, NOW, TERMINAL)).toBe('asked for 2 things')
  })

  it('is a case that has gone quiet', () => {
    const old = c({ id: 'x', status: 'applied', updated: daysAgo(STALE_DAYS + 2) })
    expect(wantsYou(old, NOW, TERMINAL)).toBe(`quiet ${STALE_DAYS + 2} days`)
  })

  /** Silence is the point of a finished case, not a problem with it. */
  it('is never a finished case, however old', () => {
    const done = c({ id: 'x', status: 'rejected', updated: daysAgo(400) })
    expect(wantsYou(done, NOW, TERMINAL)).toBe('')
  })

  it('is not a case that moved recently', () => {
    expect(wantsYou(c({ id: 'x', status: 'applied', updated: daysAgo(2) }), NOW, TERMINAL)).toBe('')
  })
})

describe('buildFlow', () => {
  const cases = [
    c({ id: 'alpla', status: 'drafted', title: 'ALPLA' }),
    c({ id: 'fonio', status: 'applied', title: 'Fonio', updated: daysAgo(20) }),
    c({ id: 'bosch', status: 'interview', title: 'Bosch' }),
    c({ id: 'siemens', status: 'rejected', title: 'Siemens' }),
    c({ id: 'admin', status: 'open', type: 'task', title: 'Tax' }),
  ]

  it('lays the area out in its own stage order', () => {
    const f = buildFlow(cases, APPLICATION, TERMINAL, { now: NOW })
    expect(f.fn).toBe('application')
    expect(f.stages.filter((s) => !s.id.startsWith('_')).map((s) => s.title)).toEqual([
      'drafted',
      'applied',
      'interview',
      'offer',
    ])
  })

  it('shows only the area asked for', () => {
    const f = buildFlow(cases, APPLICATION, TERMINAL, { now: NOW })
    expect(f.total).toBe(4) // the task is not in this river
    expect(f.areas).toEqual(['application', 'task'])
  })

  /** The whole discipline of the altitude: one warm zone, or none. */
  it('warms only the stage that is waiting on the person', () => {
    const f = buildFlow(cases, APPLICATION, TERMINAL, { now: NOW })
    const warm = f.stages.filter((s) => s.warm)
    expect(warm.map((s) => s.title)).toEqual(['applied'])
    expect(warm[0].items[0].why).toBe('quiet 20 days')
  })

  it('leaves everything calm when nothing is waiting', () => {
    const calm = [c({ id: 'a', status: 'drafted' }), c({ id: 'b', status: 'interview' })]
    const f = buildFlow(calm, APPLICATION, TERMINAL, { now: NOW })
    expect(f.stages.some((s) => s.warm)).toBe(false)
    expect(f.status).toBe('2 things are moving in application. Nothing needs you.')
  })

  it('settles the finished ones at the end, out of the flow', () => {
    const f = buildFlow(cases, APPLICATION, TERMINAL, { now: NOW })
    const last = f.stages[f.stages.length - 1]
    expect(last.title).toBe('settled')
    expect(last.items.map((i) => i.label)).toEqual(['Siemens'])
    expect(last.warm).toBe(false)
  })

  it('does not add a settled stage when nothing has settled', () => {
    const f = buildFlow([c({ id: 'a', status: 'drafted' })], APPLICATION, TERMINAL, { now: NOW })
    expect(f.stages.some((s) => s.id === '_done')).toBe(false)
  })

  /**
   * A hand-edited file with a status nobody defined still exists. Dropping it
   * makes this screen disagree with the case list, which is the kind of
   * discrepancy nobody thinks to debug.
   */
  it('keeps a case whose status is not in the vocabulary', () => {
    const odd = [c({ id: 'weird', status: 'ghosted', title: 'Weird' })]
    const f = buildFlow(odd, APPLICATION, TERMINAL, { now: NOW })
    expect(f.stages[0].title).toBe('elsewhere')
    expect(f.stages[0].items[0].label).toBe('Weird')
    expect(f.total).toBe(1)
  })

  it('says the count and the age of a stage the way a person would', () => {
    const f = buildFlow(cases, APPLICATION, TERMINAL, { now: NOW })
    expect(f.stages.find((s) => s.title === 'applied')?.hint).toBe('1 · oldest 20 days')
    expect(f.stages.find((s) => s.title === 'drafted')?.hint).toBe('1 · today')
    expect(f.stages.find((s) => s.title === 'offer')?.hint).toBe('nothing here')
  })

  it('reads as a sentence, not a dashboard', () => {
    expect(buildFlow(cases, APPLICATION, TERMINAL, { now: NOW }).status).toBe(
      '3 things are moving in application. 1 wants you.',
    )
  })

  it('has something calm to say when there is nothing at all', () => {
    const f = buildFlow([], APPLICATION, TERMINAL, { now: NOW })
    expect(f.total).toBe(0)
    expect(f.status).toBe('No cases yet. One opens the moment an agent does something worth keeping.')
  })

  it('says so when everything is finished', () => {
    const f = buildFlow([c({ id: 'a', status: 'rejected' })], APPLICATION, TERMINAL, { now: NOW })
    expect(f.status).toBe('Nothing open in application — 1 settled.')
  })
})
