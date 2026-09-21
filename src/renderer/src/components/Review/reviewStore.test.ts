import { describe, it, expect, beforeEach } from 'vitest'
import { ReviewStore, type RunSeed } from './reviewStore'
import { groupByAgent } from './reviewModel'
import type { HitlItem } from './reviewModel'
import type { HitlDecision } from '../AgentTerminal/hitlGate'

/** A fresh in-memory store per test — no localStorage, no shared singleton. */
function makeStore(): ReviewStore {
  const m = new Map<string, string>()
  return new ReviewStore({
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  })
}

function seed(overrides: Partial<RunSeed> = {}): RunSeed {
  return {
    runId: 'run-1',
    sessionId: 's1',
    sessionName: 'Agent 1',
    prompt: 'do a thing',
    mode: 'full',
    agentName: null,
    ...overrides,
  }
}

function hitlItem(overrides: Partial<HitlItem> = {}): HitlItem {
  return {
    sessionId: 's1',
    sessionName: 'Agent 1',
    agentId: 's1',
    kind: 'command',
    question: 'run?',
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('ReviewStore agentId attribution', () => {
  let store: ReviewStore
  beforeEach(() => { store = makeStore() })

  it('openRun defaults agentId to the sessionId (lane per session)', () => {
    store.openRun(seed({ runId: 'r1', sessionId: 'sess-A' }))
    const run = store.getSnapshot().runs.find((r) => r.runId === 'r1')!
    expect(run.agentId).toBe('sess-A')
  })

  it('openRun honors an explicit agentId', () => {
    store.openRun(seed({ runId: 'r1', sessionId: 'sess-A', agentId: 'lane-X' }))
    expect(store.getSnapshot().runs[0].agentId).toBe('lane-X')
  })

  it('groups runs from different sessions into distinct lanes', () => {
    store.openRun(seed({ runId: 'a', sessionId: 'A' }))
    store.openRun(seed({ runId: 'b', sessionId: 'B' }))
    const lanes = groupByAgent(store.getSnapshot().runs, store.getSnapshot().hitl)
    expect(lanes.map((l) => l.agentId).sort()).toEqual(['A', 'B'])
  })

  it('patch and resolve act per lane without cross-contamination', () => {
    store.openRun(seed({ runId: 'a', sessionId: 'A' }))
    store.openRun(seed({ runId: 'b', sessionId: 'B' }))
    store.patchRun('a', { status: 'pending', checkpointId: 'cp' })
    store.resolveRun('a', 'kept')
    const runs = store.getSnapshot().runs
    expect(runs.find((r) => r.runId === 'a')!.status).toBe('kept')
    expect(runs.find((r) => r.runId === 'b')!.status).toBe('running')
  })
})

describe('ReviewStore respondHitl routing', () => {
  it('routes a decision to the right session and clears it', () => {
    const store = makeStore()
    const decisions: Record<string, HitlDecision> = {}
    store.setHitl(hitlItem({ sessionId: 'A', agentId: 'A' }), (d) => { decisions['A'] = d })
    store.setHitl(hitlItem({ sessionId: 'B', agentId: 'B' }), (d) => { decisions['B'] = d })
    store.respondHitl('A', 'deny')
    expect(decisions).toEqual({ A: 'deny' })
    // A is cleared, B remains live.
    expect(store.getSnapshot().hitl.map((h) => h.sessionId)).toEqual(['B'])
  })
})

describe('ReviewStore auto-approve (auditable, never silent)', () => {
  it('is OFF by default — a reversible request stays live and awaits the human', () => {
    const store = makeStore()
    let responded: HitlDecision | null = null
    store.setHitl(hitlItem({ kind: 'fetch', sessionId: 'A', agentId: 'A' }), (d) => { responded = d })
    expect(responded).toBeNull()
    expect(store.getSnapshot().hitl).toHaveLength(1)
  })

  it('when ON, resolves a reversible request AND logs a resolved card (audit)', () => {
    const store = makeStore()
    store.setAutoApprovePredicate(() => true)
    let responded: HitlDecision | null = null
    store.setHitl(hitlItem({ kind: 'fetch', sessionId: 'A', agentId: 'A', question: 'fetch example.com?' }), (d) => {
      responded = d
    })
    // Auto-approved (allow-once) and NOT left live.
    expect(responded).toBe('allow-once')
    expect(store.getSnapshot().hitl).toHaveLength(0)
    // But it IS logged as a resolved card — auditable, never silent.
    const card = store.getSnapshot().runs.find((r) => r.status === 'kept')
    expect(card).toBeDefined()
    expect(card!.agentId).toBe('A')
    expect(card!.prompt).toContain('Auto-approved')
    expect(card!.prompt).toContain('fetch example.com?')
  })

  it('when ON, a GATED (irreversible) request is NEVER auto-approved', () => {
    const store = makeStore()
    store.setAutoApprovePredicate(() => true)
    let responded: HitlDecision | null = null
    store.setHitl(hitlItem({ kind: 'command', sessionId: 'A', agentId: 'A' }), (d) => { responded = d })
    // Gated → still requires the human; parked live, nothing auto-resolved.
    expect(responded).toBeNull()
    expect(store.getSnapshot().hitl).toHaveLength(1)
    expect(store.getSnapshot().runs.filter((r) => r.status === 'kept')).toHaveLength(0)
  })
})

describe('ReviewStore.approveReversible (batched)', () => {
  it('keeps reversible runs, allows read-only HITL, never touches gated items', () => {
    const store = makeStore()
    // Reversible edit run.
    store.openRun(seed({ runId: 'edit', sessionId: 'A' }))
    store.patchRun('edit', { status: 'pending', checkpointId: 'cp' })
    // Irreversible action run (no checkpoint).
    store.openRun(seed({ runId: 'action', sessionId: 'A' }))
    store.patchRun('action', { status: 'pending', checkpointId: null })
    // Live requests: one read-only (fetch), one gated (command).
    const fetched: string[] = []
    store.setHitl(hitlItem({ kind: 'fetch', sessionId: 'F', agentId: 'A' }), () => fetched.push('fetch'))
    store.setHitl(hitlItem({ kind: 'command', sessionId: 'C', agentId: 'A' }), () => fetched.push('command'))

    const result = store.approveReversible()
    expect(result).toEqual({ runs: 1, hitl: 1, gatedExcluded: 2 })

    const runs = store.getSnapshot().runs
    expect(runs.find((r) => r.runId === 'edit')!.status).toBe('kept')
    // The irreversible action is UNTOUCHED.
    expect(runs.find((r) => r.runId === 'action')!.status).toBe('pending')
    // Only the read-only fetch was resolved; the gated command remains live.
    expect(fetched).toEqual(['fetch'])
    expect(store.getSnapshot().hitl.map((h) => h.sessionId)).toEqual(['C'])
  })

  it('scopes to a single lane when given an agentId', () => {
    const store = makeStore()
    store.openRun(seed({ runId: 'a', sessionId: 'A' }))
    store.patchRun('a', { status: 'pending', checkpointId: 'cp' })
    store.openRun(seed({ runId: 'b', sessionId: 'B' }))
    store.patchRun('b', { status: 'pending', checkpointId: 'cp' })
    store.approveReversible('A')
    const runs = store.getSnapshot().runs
    expect(runs.find((r) => r.runId === 'a')!.status).toBe('kept')
    expect(runs.find((r) => r.runId === 'b')!.status).toBe('pending')
  })
})
