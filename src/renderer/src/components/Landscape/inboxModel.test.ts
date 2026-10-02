import { describe, it, expect } from 'vitest'
import { deriveInbox, revisionPrompt, ERROR_WINDOW_MS } from './inboxModel'
import type { ReviewRun, HitlItem } from '../Review/reviewModel'

const T = 1_700_000_000_000

const run = (o: Partial<ReviewRun>): ReviewRun => ({
  runId: 'r1',
  sessionId: 's1',
  sessionName: 'Lena — Designer',
  agentId: 's1',
  agentName: 'Lena — Designer',
  prompt: 'Draft the launch plan',
  mode: 'full',
  status: 'running',
  checkpointId: null,
  code: null,
  costUsd: 0,
  turns: 0,
  artifacts: [],
  createdAt: T,
  resolvedAt: null,
  ...o,
})
const empty = { runs: [] as ReviewRun[], hitl: [] as HitlItem[], jobs: [], codex: [], dismissed: new Set<string>() }

describe('deriveInbox', () => {
  it('is empty when nothing waits', () => {
    expect(deriveInbox(empty, T)).toEqual([])
  })

  it('lists every pending result separately, with its files and revertibility', () => {
    const runs = [
      run({ runId: 'a', status: 'pending', resolvedAt: T + 1, checkpointId: 'cp', artifacts: [{ path: '/w/Plan.md', name: 'Plan.md', type: 'md' }] }),
      run({ runId: 'b', status: 'pending', resolvedAt: T + 2 }),
    ]
    const items = deriveInbox({ ...empty, runs }, T + 10)
    expect(items.map((i) => i.key)).toEqual(['review:b', 'review:a'])
    expect(items[1]).toMatchObject({ kind: 'review', who: 'Lena', title: 'Plan.md', files: ['/w/Plan.md'], revertible: true })
  })

  it('puts questions first, attributed to the run that asked', () => {
    const runs = [run({}), run({ runId: 'p', status: 'pending', resolvedAt: T + 50 })]
    const hitl: HitlItem[] = [{ sessionId: 's1', sessionName: 'x', kind: 'command', question: 'Allow npm test?', createdAt: T + 5 }]
    const items = deriveInbox({ ...empty, runs, hitl }, T + 60)
    expect(items[0]).toMatchObject({ kind: 'question', title: 'Allow npm test?', runId: 'r1', sessionId: 's1', who: 'Lena' })
    expect(items[0].text).toContain('Draft the launch plan')
  })

  it('carries a Codex request id for answering', () => {
    const items = deriveInbox({ ...empty, runs: [run({})], codex: [{ runId: 'r1', requestId: 'q7', method: 'm', text: 'Who is it for?' }] }, T)
    expect(items[0]).toMatchObject({ kind: 'question', requestId: 'q7', title: 'Who is it for?' })
  })

  it('shows a recent failure once per agent, and not after a newer run', () => {
    const runs = [run({ runId: 'f1', status: 'error', createdAt: T }), run({ runId: 'f2', status: 'error', createdAt: T + 10 })]
    expect(deriveInbox({ ...empty, runs }, T + 20).map((i) => i.key)).toEqual(['error:f2'])
    const superseded = [...runs, run({ runId: 'ok', status: 'kept', createdAt: T + 30, resolvedAt: T + 40 })]
    expect(deriveInbox({ ...empty, runs: superseded }, T + 50)).toEqual([])
  })

  it('lets old and dismissed failures go', () => {
    const runs = [run({ runId: 'f', status: 'error', createdAt: T })]
    expect(deriveInbox({ ...empty, runs }, T + ERROR_WINDOW_MS + 1)).toEqual([])
    expect(deriveInbox({ ...empty, runs, dismissed: new Set(['error:f']) }, T + 1)).toEqual([])
  })

  it('names an interrupted background job as interrupted, and ignores a cancelled one', () => {
    const runs = [run({ runId: 'j', status: 'error', createdAt: T })]
    const job = (status: 'interrupted' | 'cancelled') => [{ id: 'j', label: 'x', prompt: 'p', agentName: 'Lena — Designer', status, enqueuedAt: T, startedAt: T, finishedAt: T + 1 }]
    expect(deriveInbox({ ...empty, runs, jobs: job('interrupted') }, T + 5)[0].kind).toBe('interrupted')
    expect(deriveInbox({ ...empty, runs, jobs: job('cancelled') }, T + 5)).toEqual([])
  })
})

describe('revisionPrompt', () => {
  it('gives the agent the task, its files and the requested change', () => {
    const p = revisionPrompt('Draft the launch plan', ['/w/Plan.md'], 'Shorter, and add week numbers')
    expect(p).toContain('Original task:\nDraft the launch plan')
    expect(p).toContain('- /w/Plan.md')
    expect(p).toContain('What should change:\nShorter, and add week numbers')
  })
})
