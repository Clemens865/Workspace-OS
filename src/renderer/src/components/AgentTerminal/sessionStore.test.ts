import { describe, it, expect } from 'vitest'
import { AgentSessionStore, TRANSCRIPT_MAX } from './sessionStore'

function fakeStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { dump: () => string | null } {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    dump: () => [...m.values()][0] ?? null,
  }
}

describe('AgentSessionStore', () => {
  it('creates sessions with generated ids and default names', () => {
    const store = new AgentSessionStore(fakeStorage())
    const a = store.create()
    const b = store.create()
    expect(a.sessionId).not.toBe(b.sessionId)
    expect(a.conversationId).toMatch(/^convo-/)
    expect(a.name).toBe('Agent 1')
    expect(b.name).toBe('Agent 2')
    expect(a.runMode).toBe('prompt') // default broker is the shipped -p console
    expect(store.list().map((s) => s.sessionId)).toEqual([a.sessionId, b.sessionId])
  })

  it('persists and restores sessions (round-trip through storage)', () => {
    const storage = fakeStorage()
    const store = new AgentSessionStore(storage)
    const s = store.create({ mode: 'safe', agentName: 'writer', runMode: 'pty' })
    store.appendTranscript(s.sessionId, 'hello \x1b[1mworld\x1b[0m\n')
    store.update(s.sessionId, { lastPrompt: 'summarize the deck', name: 'Quarterly' })
    store.setActive(s.sessionId)
    store.flush()

    const restored = new AgentSessionStore(storage)
    const r = restored.get(s.sessionId)
    expect(r).toBeDefined()
    expect(r!.conversationId).toBe(s.conversationId)
    expect(r!.transcript).toBe('hello \x1b[1mworld\x1b[0m\n')
    expect(r!.lastPrompt).toBe('summarize the deck')
    expect(r!.name).toBe('Quarterly')
    expect(r!.mode).toBe('safe')
    expect(r!.agentName).toBe('writer')
    expect(r!.runMode).toBe('pty')
    expect(restored.getActiveId()).toBe(s.sessionId)
  })

  it('caps the transcript, trimming the oldest lines', () => {
    const store = new AgentSessionStore(fakeStorage())
    const s = store.create()
    const line = 'x'.repeat(999) + '\n' // 1000 chars per line
    for (let i = 0; i < 200; i++) store.appendTranscript(s.sessionId, line)
    const t = store.get(s.sessionId)!.transcript
    expect(t.length).toBeLessThanOrEqual(TRANSCRIPT_MAX)
    expect(t.endsWith('\n')).toBe(true)
    expect(t.length).toBeGreaterThan(TRANSCRIPT_MAX - 2000) // trimmed near the cap
  })

  it('removes sessions and clears a removed active id', () => {
    const store = new AgentSessionStore(fakeStorage())
    const a = store.create()
    const b = store.create()
    store.setActive(b.sessionId)
    store.remove(b.sessionId)
    expect(store.list().map((s) => s.sessionId)).toEqual([a.sessionId])
    expect(store.getActiveId()).toBeNull()
  })

  it('survives corrupt storage payloads', () => {
    const storage = fakeStorage()
    storage.setItem('workspace-os:agent-sessions:v1', '{not json')
    const store = new AgentSessionStore(storage)
    expect(store.list()).toEqual([])
    expect(store.create().name).toBe('Agent 1')
  })
})
