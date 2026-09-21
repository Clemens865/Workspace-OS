import { describe, it, expect } from 'vitest'
import { buildStream, groupStream, streamStatus, costLabel, dayLabel, type StreamInput } from './streamModel'

const NOW = Date.parse('2026-09-02T12:00:00Z')
const H = 3_600_000
const D = 24 * H

function input(over: Partial<StreamInput> = {}): StreamInput {
  return { cases: [], runs: [], files: [], seenAt: null, now: NOW, ...over }
}

function run(over: Partial<StreamInput['runs'][number]> = {}): StreamInput['runs'][number] {
  return {
    runId: 'r1',
    agentName: 'Elias',
    sessionName: 'Agent 1',
    status: 'kept',
    prompt: 'tailor the cover letter',
    createdAt: NOW - 2 * H,
    resolvedAt: NOW - H,
    costUsd: 0.12,
    artifacts: [],
    ...over,
  }
}

describe('buildStream — sentences', () => {
  it('opens a case and reads every note in the Home voice', () => {
    const items = buildStream(
      input({
        cases: [
          {
            id: 'c1',
            title: 'Yorizon',
            created: new Date(NOW - 3 * D).toISOString(),
            notes: [
              { at: new Date(NOW - 2 * D).toISOString(), author: 'you', text: 'Sent the deck' },
              { at: new Date(NOW - D).toISOString(), author: 'agent', text: 'Drafted a follow-up' },
              { at: new Date(NOW - H).toISOString(), author: 'system', text: 'Status → offer' },
            ],
          },
        ],
      }),
    )
    expect(items.map((i) => i.text)).toEqual([
      'Yorizon — now offer',
      'Agent, on Yorizon: Drafted a follow-up',
      'You, on Yorizon: Sent the deck',
      'Case opened: Yorizon',
    ])
    expect(items.every((i) => i.caseId === 'c1' && i.kind === 'case' && i.who === 'Yorizon')).toBe(true)
  })

  it('says what an agent did, by status, and names the thing it made', () => {
    const items = buildStream(
      input({
        runs: [
          run({ runId: 'a', status: 'running', resolvedAt: null }),
          run({ runId: 'b', status: 'pending', resolvedAt: null }),
          run({ runId: 'c', status: 'error' }),
          run({ runId: 'd', status: 'reverted' }),
          run({ runId: 'e', status: 'kept', artifacts: [{ path: '/ws/out/letter.docx', name: 'letter.docx' }] }),
          run({ runId: 'f', status: 'kept', agentName: null }),
        ],
      }),
    )
    const byId = Object.fromEntries(items.map((i) => [i.id, i]))
    expect(byId['run:a'].text).toBe('Elias is working: tailor the cover letter')
    expect(byId['run:b'].text).toBe('Elias is waiting on you: tailor the cover letter')
    expect(byId['run:c'].text).toBe('Elias hit an error on: tailor the cover letter')
    expect(byId['run:d'].text).toBe('Elias did, and you reverted: tailor the cover letter')
    expect(byId['run:e'].text).toBe('Elias finished: tailor the cover letter → letter.docx')
    expect(byId['run:e'].path).toBe('/ws/out/letter.docx')
    expect(byId['run:f'].who).toBe('Agent 1')
    // A running run sits at its start; a resolved one at its end.
    expect(byId['run:a'].at).toBe(NOW - 2 * H)
    expect(byId['run:e'].at).toBe(NOW - H)
  })

  it('reports a new file by its name and keeps the path to open it', () => {
    const [it] = buildStream(input({ files: [{ path: '/ws/reports/q3.xlsx', at: NOW - H }] }))
    expect(it.text).toBe('New in the workspace: q3.xlsx')
    expect(it.path).toBe('/ws/reports/q3.xlsx')
    expect(it.kind).toBe('file')
  })

  it('a routine speaks as itself, not as an agent', () => {
    const items = buildStream(
      input({
        runs: [
          run({ runId: 'a', status: 'pending', origin: 'routine', sessionName: 'Morning sift', agentName: 'Elias' }),
          run({ runId: 'b', status: 'kept', origin: 'routine', sessionName: 'Weekly case report', artifacts: [{ path: '/ws/r.md', name: 'r.md' }] }),
          run({ runId: 'c', status: 'error', origin: 'routine', sessionName: 'Stale case check' }),
        ],
      }),
    )
    expect(items.map((i) => i.text).sort()).toEqual(['Morning sift ran and needs you', 'Stale case check failed', 'Weekly case report ran → r.md'])
    expect(items.find((i) => i.id === 'run:a')?.who).toBe('Morning sift')
  })

  it('a connection that needs sign-in becomes one line; a healthy one says nothing', () => {
    const items = buildStream(
      input({
        connections: [
          { id: 'site:asana.com', name: 'Asana', status: 'needs-signin', checkedAt: NOW - H },
          { id: 'mcp:github', name: 'GitHub', status: 'connected', checkedAt: NOW - H },
        ],
      }),
    )
    expect(items.map((i) => i.text)).toEqual(['Asana needs you to sign in again'])
    expect(items[0].kind).toBe('connector')
  })

  it('clips long prompts to one line', () => {
    const [it] = buildStream(input({ runs: [run({ prompt: 'x'.repeat(200) + '\nsecond line' })] }))
    expect(it.text.length).toBeLessThan(110)
    expect(it.text.endsWith('…')).toBe(true)
    expect(it.text).not.toContain('second')
  })
})

describe('buildStream — order and freshness', () => {
  it('is newest first and drops events with no usable time', () => {
    const items = buildStream(
      input({
        runs: [run({ runId: 'old', resolvedAt: NOW - 5 * D }), run({ runId: 'new', resolvedAt: NOW - H })],
        files: [{ path: '/ws/a.txt', at: NaN }],
        cases: [{ id: 'c', title: 'Broken', created: 'not a date', notes: [] }],
      }),
    )
    expect(items.map((i) => i.id)).toEqual(['run:new', 'run:old'])
  })

  it('marks what is newer than the last look as fresh', () => {
    const items = buildStream(
      input({
        seenAt: NOW - 3 * H,
        runs: [run({ runId: 'before', resolvedAt: NOW - 4 * H }), run({ runId: 'after', resolvedAt: NOW - H })],
      }),
    )
    expect(items.find((i) => i.id === 'run:after')?.fresh).toBe(true)
    expect(items.find((i) => i.id === 'run:before')?.fresh).toBe(false)
  })

  it('treats a never-looked stream as all fresh', () => {
    const items = buildStream(input({ runs: [run()] }))
    expect(items[0].fresh).toBe(true)
  })
})

describe('groupStream — the prism', () => {
  const items = buildStream(
    input({
      seenAt: null,
      cases: [{ id: 'c1', title: 'Yorizon', created: new Date(NOW - 2 * D).toISOString(), notes: [] }],
      runs: [
        run({ runId: 'a', resolvedAt: NOW - H, costUsd: 0.3 }),
        run({ runId: 'b', resolvedAt: NOW - D - H, agentName: 'Mira', costUsd: 0.05 }),
        run({ runId: 'c', resolvedAt: NOW - D - 2 * H, agentName: 'Mira', costUsd: 0.05 }),
      ],
      files: [{ path: '/ws/x.md', at: NOW - 2 * H }],
    }),
  )

  it('by day: Today, Yesterday, then dates — each with its cost', () => {
    const g = groupStream(items, 'day', NOW)
    expect(g.map((x) => x.label)).toEqual(['Today', 'Yesterday', dayLabel(NOW - 2 * D, NOW)])
    expect(g[0].cost).toBeCloseTo(0.3)
    expect(g[1].cost).toBeCloseTo(0.1)
    expect(g[2].cost).toBe(0)
    expect(g[0].items.map((i) => i.id)).toEqual(['run:a', 'file:/ws/x.md'])
  })

  it('by agent: busiest agent first, things not by an agent last', () => {
    const g = groupStream(items, 'agent', NOW)
    expect(g.map((x) => x.label)).toEqual(['Mira', 'Elias', 'Not by an agent'])
    expect(g[2].items.length).toBe(2)
  })

  it('by case: the case, then everything outside one', () => {
    const g = groupStream(items, 'case', NOW)
    expect(g[0].label).toBe('Yorizon')
    expect(g[g.length - 1].label).toBe('Outside any case')
  })

  it('by kind: Agents / Cases / Files', () => {
    const g = groupStream(items, 'kind', NOW)
    expect(g.map((x) => x.label).sort()).toEqual(['Agents', 'Cases', 'Files'])
    expect(g[0].label).toBe('Agents')
  })
})

describe('labels', () => {
  it('dayLabel walks from Today through the weekday to a date', () => {
    expect(dayLabel(NOW, NOW)).toBe('Today')
    expect(dayLabel(NOW - D, NOW)).toBe('Yesterday')
    expect(dayLabel(NOW - 3 * D, NOW)).toBe(new Date(NOW - 3 * D).toLocaleDateString(undefined, { weekday: 'long' }))
    expect(dayLabel(NOW - 20 * D, NOW)).toMatch(/\d/)
  })

  it('streamStatus speaks to what changed since the last look', () => {
    expect(streamStatus([], null)).toBe('Nothing has happened here yet.')
    const items = buildStream(input({ seenAt: NOW - 3 * H, runs: [run({ runId: 'a', resolvedAt: NOW - H }), run({ runId: 'b', resolvedAt: NOW - 4 * H })] }))
    expect(streamStatus(items, NOW - 3 * H)).toBe('1 new thing since you last looked.')
    expect(streamStatus(items.map((i) => ({ ...i, fresh: false })), NOW - 3 * H)).toBe('Quiet — nothing new since you last looked.')
    expect(streamStatus(items, null)).toBe('2 things happened here so far.')
  })

  it('costLabel stays silent at zero and honest below a cent', () => {
    expect(costLabel(0)).toBe('')
    expect(costLabel(0.004)).toBe('<$0.01')
    expect(costLabel(1.5)).toBe('$1.50')
  })
})
