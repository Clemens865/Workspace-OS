import { describe, it, expect } from 'vitest'
import { ReviewStore } from './reviewStore'
import { AgentSessionStore } from '../AgentTerminal/sessionStore'
import { jobInScope } from './backgroundRuns'

function mem(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    keys: () => [...m.keys()],
  }
}

const seed = (runId: string) => ({ runId, sessionId: 's', sessionName: 'Agent', prompt: 'p', mode: 'safe' as const, agentName: null })

describe('per-workspace scope', () => {
  it('reviewStore: runs are kept per scope; switching swaps them and writes under the scoped key', () => {
    const s = mem()
    const store = new ReviewStore(s)
    store.openRun(seed('r-everywhere'))
    store.switchScope('ws-a')
    expect(store.getSnapshot().runs).toEqual([])
    store.openRun(seed('r-a'))
    store.switchScope('ws-b')
    expect(store.getSnapshot().runs).toEqual([])
    store.switchScope('ws-a')
    expect(store.getSnapshot().runs.map((r) => r.runId)).toEqual(['r-a'])
    store.switchScope('everywhere')
    expect(store.getSnapshot().runs.map((r) => r.runId)).toEqual(['r-everywhere'])
    // Every key is scoped (an empty blob for ws-b is fine); the legacy key never appears.
    expect(s.keys().every((k) => /:(everywhere|ws-[a-z0-9-]+)$/.test(k))).toBe(true)
    expect(s.keys()).toContain('workspace-os:review-runs:v1:ws-a')
  })

  it('reviewStore: the legacy global blob is adopted by the first scope, once', () => {
    const s = mem({ 'workspace-os:review-runs:v1': JSON.stringify([{ ...seed('legacy'), agentId: 's', status: 'kept', checkpointId: null, code: 0, costUsd: 0, turns: 1, artifacts: [], createdAt: 1, resolvedAt: 2 }]) })
    const store = new ReviewStore(s)
    // Constructed at "everywhere" it only BORROWS the blob; the open root adopts it.
    expect(store.getSnapshot().runs.map((r) => r.runId)).toEqual(['legacy'])
    expect(s.getItem('workspace-os:review-runs:v1')).not.toBeNull()
    store.switchScope('ws-a')
    expect(store.getSnapshot().runs.map((r) => r.runId)).toEqual(['legacy'])
    expect(s.getItem('workspace-os:review-runs:v1')).toBeNull()
    expect(s.getItem('workspace-os:review-runs:v1:everywhere')).toBeNull()
    store.switchScope('ws-b')
    expect(store.getSnapshot().runs).toEqual([])
  })

  it('sessionStore: tabs are per scope; the legacy blob is adopted once', () => {
    const s = mem({ 'workspace-os:agent-sessions:v1': JSON.stringify({ sessions: [{ sessionId: 'legacy-1', conversationId: 'c1', name: 'Old tab' }], activeSessionId: 'legacy-1' }) })
    const store = new AgentSessionStore(s)
    expect(store.list().map((x) => x.name)).toEqual(['Old tab'])
    // The open workspace adopts the old tabs; "everywhere" keeps nothing of them.
    store.switchScope('ws-a')
    expect(store.list().map((x) => x.name)).toEqual(['Old tab'])
    expect(s.getItem('workspace-os:agent-sessions:v1')).toBeNull()
    expect(s.getItem('workspace-os:agent-sessions:v1:everywhere')).toBeNull()
    const created = store.create({ name: 'A tab' })
    store.flush()
    store.switchScope('everywhere')
    expect(store.list()).toEqual([])
    store.switchScope('ws-a')
    expect(store.list().map((x) => x.sessionId).sort()).toEqual(['legacy-1', created.sessionId].sort())
    expect(store.currentScope()).toBe('ws-a')
  })

  it('jobInScope: root match, trailing slash ignored, null = everywhere', () => {
    expect(jobInScope({ root: '/ws' }, '/ws/')).toBe(true)
    expect(jobInScope({ root: '/ws' }, '/other')).toBe(false)
    expect(jobInScope({ root: null }, null)).toBe(true)
    expect(jobInScope({ root: null }, '/ws')).toBe(false)
  })
})
