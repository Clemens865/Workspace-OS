import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type Done = (runId: string, code: number | null, checkpointId: string | null) => void
const done = new Set<Done>()
const output = new Set<(runId: string, chunk: string) => void>()
const quiet = (): (() => void) => () => {}
const agent = {
  run: vi.fn(),
  cancel: vi.fn(),
  forgetConversation: vi.fn(async () => {}),
  onOutput: (f: (runId: string, chunk: string) => void) => (output.add(f), () => output.delete(f)),
  onActivity: quiet,
  onRunMeta: quiet,
  onArtifacts: quiet,
  onDone: (f: Done) => (done.add(f), () => done.delete(f)),
}
const runs = { list: vi.fn(), resume: vi.fn(async () => {}), pause: vi.fn(async () => {}) }
vi.stubGlobal('window', {
  workspace: { agent, runs, fs: { getWorkspaceRoot: async () => null, onRootChanged: quiet } },
  setTimeout: (f: () => void, ms?: number) => setTimeout(f, ms),
  clearTimeout: (t: number) => clearTimeout(t),
  addEventListener: () => {},
  dispatchEvent: () => true,
})

let store: typeof import('../../lib/sessions/sessionStore')
let pr: typeof import('./pauseResume')
let review: typeof import('../Review/reviewStore')

beforeAll(async () => {
  store = await import('../../lib/sessions/sessionStore')
  pr = await import('./pauseResume')
  review = await import('../Review/reviewStore')
  store.sessionStore.subscribe(() => {})
  await new Promise((r) => setTimeout(r, 0)) // the (empty) saved sessions are read
})

beforeEach(() => {
  agent.run.mockReset().mockResolvedValue({ pid: 1, checkpointId: null, model: 'codex:gpt-5' })
  agent.cancel.mockReset().mockImplementation(async (runId: string) => done.forEach((f) => f(runId, null, null)))
  runs.list.mockReset().mockResolvedValue([])
  runs.resume.mockClear()
})

/** A session with one turn running, then paused. */
async function paused(o: { kind?: 'chat'; app?: string } = {}): Promise<{ id: string; runId: string }> {
  const s = store.sessionStore.create({ agentName: 'Elias', ...o })
  await store.sessionStore.send(s.id, 'write the report')
  const runId = store.sessionStore.get(s.id)!.lastRunId!
  await pr.pauseRun(runId)
  agent.run.mockClear()
  return { id: s.id, runId }
}
const statusOf = (runId: string): string | undefined => review.reviewStore.getSnapshot().runs.find((r) => r.runId === runId)?.status

describe('resume of a session run', () => {
  it('continues the session conversation, with resumeOnly, on the model that was running', async () => {
    const { id, runId } = await paused()
    expect(statusOf(runId)).toBe('paused')
    const next = (await pr.resumeRun(runId))!
    const args = agent.run.mock.calls[0]
    expect(args[0]).toBe(next)
    expect(args[0]).toMatch(/^[a-z0-9-]{6,40}$/)
    expect(args[6]).toBe(`session-${id}`)
    expect(args[7]).toBe('codex:gpt-5')
    expect(args[8]).toBe(true)
    expect(statusOf(runId)).toBe('kept')
  })

  it('streams into the session it continues, and lands for review', async () => {
    const { id, runId } = await paused({ kind: 'chat' })
    const next = (await pr.resumeRun(runId))!
    expect(agent.run.mock.calls[0][9]).toBe('chat')
    expect(store.sessionStore.live(id).running).toBe(true)
    expect(store.sessionStore.get(id)!.lastRunId).toBe(next)
    output.forEach((f) => f(next, 'the rest of it'))
    done.forEach((f) => f(next, 0, 'cp1'))
    expect(store.sessionStore.get(id)!.messages.at(-1)).toMatchObject({ role: 'agent', text: 'the rest of it' })
    expect(store.sessionStore.live(id).running).toBe(false)
    expect(statusOf(next)).toBe('pending')
  })

  it('keeps an app builder on the app builder profile', async () => {
    const { runId } = await paused({ kind: 'chat', app: 'notes' })
    await pr.resumeRun(runId)
    expect(agent.run.mock.calls[0].slice(9)).toEqual(['app', 'notes'])
  })

  it('can be paused and resumed again', async () => {
    const { id, runId } = await paused()
    const second = (await pr.resumeRun(runId))!
    await pr.pauseRun(second)
    expect(statusOf(second)).toBe('paused')
    agent.run.mockClear()
    await pr.resumeRun(second)
    expect(agent.run.mock.calls[0][6]).toBe(`session-${id}`)
  })

  it('stays paused-side honest when main refuses: the error reaches the person, the session is not left running', async () => {
    const { id, runId } = await paused()
    agent.run.mockRejectedValue(new Error('The original conversation is no longer available.'))
    await expect(pr.resumeRun(runId)).rejects.toThrow('no longer available')
    expect(store.sessionStore.live(id).running).toBe(false)
    expect(statusOf(runId)).toBe('paused')
  })

  it('does not start a second run in a session that is already working', async () => {
    const { id, runId } = await paused()
    await store.sessionStore.send(id, 'something else')
    agent.run.mockClear()
    await expect(pr.resumeRun(runId)).rejects.toThrow('already working')
    expect(agent.run).not.toHaveBeenCalled()
  })
})

describe('resume of a background job', () => {
  it('goes through the job queue', async () => {
    runs.list.mockResolvedValue([{ id: 'bg-abc123' }])
    expect(await pr.resumeRun('bg-abc123')).toBe('bg-abc123')
    expect(runs.resume).toHaveBeenCalledWith('bg-abc123')
    expect(agent.run).not.toHaveBeenCalled()
  })
})
