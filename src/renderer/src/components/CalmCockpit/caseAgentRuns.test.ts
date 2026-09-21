import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceApi } from '../../types/workspace-api'
import { CaseAgentRuns, caseAgentBusy, caseAgentKey, caseAgentCanContinue } from './caseAgentRuns'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const c = { id: 'enterprise-ai-architect-alpla', title: 'Enterprise AI architect' }
const key = caseAgentKey(c, '/work/a')
const prepare = async () => ({ prompt: 'Whole case context', mentions: ['/work/a/cv.md'] })

function harness(provider: 'claude' | 'codex' = 'claude') {
  const handlers: Record<string, (...args: any[]) => void> = {}
  const listen = (name: string) => vi.fn((cb: (...args: any[]) => void) => {
    handlers[name] = cb
    return () => { delete handlers[name] }
  })
  const run = vi.fn().mockResolvedValue({ provider, model: `${provider}:sonnet`, pid: 1, checkpointId: 'checkpoint' })
  const api = {
    agent: { run, onOutput: listen('output'), onActivity: listen('activity'), onDone: listen('done'), onArtifacts: listen('artifacts'), onRunMeta: listen('meta') },
    codex: { onQuestion: listen('question') },
  } as unknown as WorkspaceApi
  const store = new CaseAgentRuns(() => api)
  return { store, run, emit: (event: string, ...args: any[]) => handlers[event](...args) }
}

describe('case handoff lifecycle', () => {
  it('shows preparation immediately and prevents duplicate sends from another view', async () => {
    const h = harness()
    const context = deferred<Awaited<ReturnType<typeof prepare>>>()
    const start = h.store.start(c, key, 'Prepare me', () => context.promise)
    expect(h.store.get(key)?.status).toBe('preparing')
    expect(caseAgentBusy(h.store.get(key))).toBe(true)
    expect(await h.store.start(c, key, 'Duplicate', prepare)).toBe(false)
    expect(h.run).not.toHaveBeenCalled()
    context.resolve(await prepare())
    expect(await start).toBe(true)
    expect(h.run).toHaveBeenCalledExactlyOnceWith(h.store.get(key)?.runId, 'Whole case context', ['/work/a/cv.md'], null, 'full', null, h.store.get(key)?.conversationId, undefined, false)
  })

  it.each(['claude', 'codex'] as const)('tracks %s activity, streamed responses, artifacts and completion', async (provider) => {
    const h = harness(provider)
    await h.store.start(c, key, 'Prepare me', prepare)
    const id = h.store.get(key)!.runId
    expect(h.store.get(key)).toMatchObject({ provider, status: 'running' })
    h.emit('activity', id, { tool: 'Read', label: 'Reading a file', kind: 'read', chip: 'cv.md' })
    h.emit('output', id, 'I found ')
    h.emit('output', id, 'three useful points.')
    const artifacts = [{ name: 'prep.md', path: '/work/a/prep.md', type: 'document' }]
    h.emit('artifacts', id, artifacts)
    h.emit('done', id, 0, 'checkpoint')
    expect(h.store.get(key)).toMatchObject({ status: 'completed', output: 'I found three useful points.', artifacts, code: 0, checkpointId: 'checkpoint', steps: [{ label: 'Reading a file', chip: 'cv.md' }] })
    expect(caseAgentBusy(h.store.get(key))).toBe(false)
    expect(h.store.get(key)?.finishedAt).toBeTypeOf('number')
  })

  it('captures events before the launch reply and never resurrects a completed run', async () => {
    const h = harness('codex')
    const reply = deferred<{ provider: 'codex'; pid: number; checkpointId: string }>()
    h.run.mockImplementationOnce((id) => {
      h.emit('output', id, 'Already finished')
      h.emit('done', id, 0, 'done-checkpoint')
      return reply.promise
    })
    const start = h.store.start(c, key, 'Quick task', prepare)
    await vi.waitFor(() => expect(h.store.get(key)?.status).toBe('completed'))
    reply.resolve({ provider: 'codex', pid: 1, checkpointId: 'launch-checkpoint' })
    await start
    expect(h.store.get(key)).toMatchObject({ status: 'completed', provider: 'codex', output: 'Already finished', checkpointId: 'done-checkpoint' })
  })

  it('reports context and startup errors, then permits a clean retry', async () => {
    const h = harness()
    await h.store.start(c, key, 'First', async () => { throw new Error('Case unavailable') })
    expect(h.run).not.toHaveBeenCalled()
    expect(h.store.get(key)).toMatchObject({ status: 'error', error: 'Case unavailable' })
    h.run.mockRejectedValueOnce(new Error("Error invoking remote method 'agent:run': Error: Sign in to Claude"))
    await h.store.start(c, key, 'Second', prepare)
    expect(h.store.get(key)).toMatchObject({ status: 'error', error: 'Sign in to Claude' })
    await h.store.start(c, key, 'Third', prepare)
    expect(h.store.get(key)).toMatchObject({ status: 'running', error: null, steps: [], output: '' })
  })

  it('keeps tracking after the view unsubscribes, and retains failure details on reopening', async () => {
    const h = harness()
    const view = vi.fn()
    const close = h.store.subscribe(view)
    await h.store.start(c, key, 'Run', prepare)
    close()
    view.mockClear()
    const id = h.store.get(key)!.runId
    h.emit('output', id, 'Authentication expired')
    h.emit('done', id, 1, null)
    expect(view).not.toHaveBeenCalled()
    expect(h.store.get(key)).toMatchObject({ status: 'error', output: 'Authentication expired', code: 1 })
    expect(h.store.get(key)?.error).toContain('exit code 1')
  })

  it('isolates cases and workspaces, including matching slug prefixes in the same millisecond', async () => {
    const h = harness()
    const other = { ...c, id: 'enterprise-ai-architect-other' }
    const otherKey = caseAgentKey(other, '/work/a')
    const secondWorkspace = caseAgentKey(c, '/work/b')
    await Promise.all([h.store.start(c, key, 'One', prepare), h.store.start(other, otherKey, 'Two', prepare), h.store.start(c, secondWorkspace, 'Three', prepare)])
    const ids = [key, otherKey, secondWorkspace].map((k) => h.store.get(k)!.runId)
    expect(new Set(ids).size).toBe(3)
    h.emit('done', ids[0], 0, null)
    expect(h.store.get(otherKey)?.status).toBe('running')
    expect(h.store.get(secondWorkspace)?.status).toBe('running')
    expect(caseAgentKey({ ...c, scope: 'global' }, '/work/a')).toBe(caseAgentKey({ ...c, scope: 'global' }, '/work/b'))
  })

  it('shows waiting while any Codex request is outstanding, then clears on completion', async () => {
    const h = harness('codex')
    await h.store.start(c, key, 'Run', prepare)
    const id = h.store.get(key)!.runId
    h.emit('question', { runId: id, requestId: 'permission' })
    h.emit('question', { runId: id, requestId: 'input' })
    h.emit('question', { runId: id, requestId: 'permission', resolved: true })
    expect(h.store.get(key)?.requests).toEqual(['input'])
    h.emit('done', id, 0, null)
    expect(h.store.get(key)?.requests).toEqual([])
  })

  it('ignores unrelated or late stream events and keeps stable, bounded snapshots', async () => {
    const h = harness()
    await h.store.start(c, key, 'Run', prepare)
    const first = h.store.get(key)!
    h.emit('output', 'unrelated', 'Do not show this')
    expect(h.store.get(key)).toBe(first)
    h.emit('output', first.runId, 'a'.repeat(300_000))
    for (let i = 0; i < 80; i++) h.emit('activity', first.runId, { tool: 'Read', label: `Reading ${i}` })
    expect(first.output).toBe('')
    expect(first.steps).toEqual([])
    expect(h.store.get(key)?.output).toHaveLength(256_000)
    expect(h.store.get(key)?.outputTruncated).toBe(true)
    expect(h.store.get(key)?.steps).toHaveLength(60)
    h.emit('done', first.runId, 0, null)
    await h.store.start(c, key, 'New run', prepare)
    h.emit('output', first.runId, 'Old run')
    expect(h.store.get(key)?.output).toBe('')
  })

  it('continues only on request, preserving the original conversation, model, partial output and files', async () => {
    const h = harness()
    await h.store.start(c, key, 'Write a long document', prepare)
    const first = h.store.get(key)!
    h.emit('output', first.runId, 'Section one saved.')
    const artifact = { path: '/work/a/draft.md', name: 'draft.md', type: 'document' }
    h.emit('artifacts', first.runId, [artifact])
    h.emit('done', first.runId, 0, 'checkpoint', { kind: 'output-limit', message: 'Limit reached', canResume: true })
    expect(h.store.get(key)?.status).toBe('error')
    expect(caseAgentCanContinue(h.store.get(key))).toBe(true)
    expect(h.run).toHaveBeenCalledTimes(1)
    const continued = h.store.continue(key)
    expect(await h.store.continue(key)).toBe(false)
    expect(await continued).toBe(true)
    const next = h.store.get(key)!
    expect(next.runId).not.toBe(first.runId)
    expect(next).toMatchObject({ conversationId: first.conversationId, model: 'claude:sonnet', artifacts: [artifact] })
    expect(next.output).toContain('Section one saved.')
    const args = h.run.mock.calls[1]
    expect(args[1]).toContain('First inspect the existing files')
    expect(args[1]).not.toContain('Whole case context')
    expect(args.slice(6)).toEqual([first.conversationId, 'claude:sonnet', true])
    h.emit('artifacts', next.runId, [{ ...artifact, name: 'updated.md' }])
    expect(h.store.get(key)?.artifacts).toHaveLength(1)
    h.emit('done', next.runId, 0, null)
    expect(h.store.get(key)?.status).toBe('completed')
    expect(caseAgentCanContinue(h.store.get(key))).toBe(false)
  })

  it('waits for the launch reply before offering continuation after an early failure', async () => {
    const h = harness()
    const reply = deferred<{ provider: 'claude'; model: string; pid: number; checkpointId: null }>()
    h.run.mockImplementationOnce((id) => {
      h.emit('done', id, 1, null, { kind: 'output-limit', message: 'Limit', canResume: true })
      return reply.promise
    })
    const started = h.store.start(c, key, 'Write', prepare)
    await vi.waitFor(() => expect(h.store.get(key)?.status).toBe('error'))
    expect(await h.store.continue(key)).toBe(false)
    reply.resolve({ provider: 'claude', model: 'claude:opus', pid: 1, checkpointId: null })
    await started
    expect(caseAgentCanContinue(h.store.get(key))).toBe(true)
    expect(h.store.get(key)?.status).toBe('error')
  })

  it('does not offer continuation without a session, or for unrelated failures', async () => {
    const h = harness()
    for (const failure of [{ kind: 'output-limit', canResume: false }, { kind: 'provider-error', canResume: true }]) {
      await h.store.start(c, key, 'Write', prepare)
      h.emit('done', h.store.get(key)!.runId, 1, null, { ...failure, message: 'Failed' })
      expect(await h.store.continue(key)).toBe(false)
    }
    expect(h.run).toHaveBeenCalledTimes(2)
  })

  it('preserves prior output if continuation cannot launch', async () => {
    const h = harness()
    await h.store.start(c, key, 'Write', prepare)
    h.emit('output', h.store.get(key)!.runId, 'Saved the first section')
    h.emit('done', h.store.get(key)!.runId, 1, null, { kind: 'output-limit', message: 'Limit', canResume: true })
    h.run.mockRejectedValueOnce(new Error('The original conversation is no longer available.'))
    expect(await h.store.continue(key)).toBe(false)
    expect(h.store.get(key)).toMatchObject({ status: 'error', error: 'The original conversation is no longer available.' })
    expect(h.store.get(key)?.output).toContain('Saved the first section')
  })
})
