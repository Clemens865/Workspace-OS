import type { WorkCase, WorkspaceApi, RunArtifact } from '../../types/workspace-api'
import { appendStep, type TraceStep } from '../AgentTerminal/runTraceModel'
import { caseRunId } from './caseActions'
import { continueUnfinishedWorkPrompt, type AgentRunFailure } from '../../../../shared/agentRun'

export interface CaseAgentRun {
  runId: string
  caseKey: string
  title: string
  label: string
  status: 'preparing' | 'starting' | 'running' | 'completed' | 'error'
  provider?: 'claude' | 'codex'
  conversationId: string
  model?: string
  launchPending: boolean
  failure: AgentRunFailure | null
  startedAt: number
  finishedAt: number | null
  steps: TraceStep[]
  output: string
  outputTruncated: boolean
  artifacts: RunArtifact[]
  requests: string[]
  error: string | null
  code: number | null
  checkpointId: string | null
}

export function caseAgentKey(c: Pick<WorkCase, 'id' | 'scope'>, root: string | null): string {
  return JSON.stringify([c.scope === 'global' ? null : root, c.scope ?? 'workspace', c.id])
}

export function caseAgentBusy(run: CaseAgentRun | null): boolean {
  return !!run && !['completed', 'error'].includes(run.status)
}

export function caseAgentCanContinue(run: CaseAgentRun | null): boolean {
  return !!run && run.status === 'error' && run.failure?.kind === 'output-limit'
    && run.failure.canResume === true && !run.launchPending && !!run.model
}

const MAX_OUTPUT = 256_000
function appendOutput(run: CaseAgentRun, chunk: string): Pick<CaseAgentRun, 'output' | 'outputTruncated'> {
  const output = run.output + chunk
  return { output: output.slice(-MAX_OUTPUT), outputTruncated: run.outputTruncated || output.length > MAX_OUTPUT }
}

type AgentApi = Pick<WorkspaceApi, 'agent' | 'codex'>
type PreparedTask = { prompt: string; mentions: string[] }

/** Owns case streams independently of either case view's lifetime. No provider
 * is launched just by observing a case. Only explicitly submitted tasks run. */
export class CaseAgentRuns {
  private runs = new Map<string, CaseAgentRun>()
  private byCase = new Map<string, string>()
  private listeners = new Set<() => void>()
  private disconnect: (() => void)[] = []

  constructor(private api: () => AgentApi) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  get = (key: string): CaseAgentRun | null => this.runs.get(this.byCase.get(key) ?? '') ?? null

  private patch(id: string, patch: Partial<CaseAgentRun>): void {
    const old = this.runs.get(id)
    if (!old) return
    const run = { ...old, ...patch }
    this.runs.set(id, run)
    for (const listener of this.listeners) listener()
  }

  private connect(): void {
    if (this.disconnect.length) return
    const { agent, codex } = this.api()
    this.disconnect = [
      agent.onOutput((id, chunk) => {
        const run = this.runs.get(id)
        if (caseAgentBusy(run ?? null)) this.patch(id, appendOutput(run!, chunk))
      }),
      agent.onActivity((id, activity) => {
        const run = this.runs.get(id)
        if (!caseAgentBusy(run ?? null)) return
        this.patch(id, { steps: appendStep(run!.steps, { ...activity, kind: activity.kind ?? 'run' }, Date.now()) })
      }),
      agent.onArtifacts((id, artifacts) => {
        const run = this.runs.get(id)
        if (run) this.patch(id, { artifacts: [...new Map([...run.artifacts, ...artifacts].map((a) => [a.path, a])).values()] })
      }),
      agent.onRunMeta((id, meta) => {
        if (meta.provider === 'codex' || meta.provider === 'claude') this.patch(id, { provider: meta.provider })
      }),
      agent.onDone((id, code, checkpointId, failure) => {
        if (!caseAgentBusy(this.runs.get(id) ?? null)) return
        this.patch(id, {
          status: code === 0 && !failure ? 'completed' : 'error', code, checkpointId, failure: failure ?? null,
          finishedAt: Date.now(), requests: [],
          error: failure?.kind === 'output-limit'
            ? 'Claude reached its response limit before finishing. Files already saved are still available, and the partial response is below.'
            : failure?.message ?? (code === 0 ? null : `The agent stopped with exit code ${code}. See its response below for details.`),
        })
      }),
      codex.onQuestion((q) => {
        const run = this.runs.get(q.runId)
        if (!caseAgentBusy(run ?? null)) return
        const requests = run!.requests.filter((id) => id !== q.requestId)
        if (!q.resolved) requests.push(q.requestId)
        this.patch(q.runId, { provider: 'codex', requests })
      }),
    ]
  }

  /** Claim the case synchronously, before context loading or IPC, so an early
   * event or a second view's Send cannot lose/duplicate the handoff. */
  async start(c: Pick<WorkCase, 'id' | 'title'>, key: string, label: string, prepare: () => Promise<PreparedTask>): Promise<boolean> {
    return this.launch(c, key, label, prepare)
  }

  async continue(key: string): Promise<boolean> {
    const previous = this.get(key)
    if (!caseAgentCanContinue(previous)) return false
    return this.launch({ id: 'continue', title: previous!.title }, key, previous!.label,
      async () => ({ prompt: continueUnfinishedWorkPrompt, mentions: [] }), previous!)
  }

  private async launch(c: Pick<WorkCase, 'id' | 'title'>, key: string, label: string, prepare: () => Promise<PreparedTask>, resume?: CaseAgentRun): Promise<boolean> {
    if (caseAgentBusy(this.get(key))) return false
    const runId = caseRunId(c.id)
    const run: CaseAgentRun = {
      runId, caseKey: key, title: c.title, label, status: 'preparing',
      conversationId: resume?.conversationId ?? runId, model: resume?.model, provider: resume?.provider,
      launchPending: true, failure: null,
      startedAt: Date.now(), finishedAt: null, steps: [], output: '', outputTruncated: false, artifacts: resume?.artifacts ?? [],
      requests: [], error: null, code: null, checkpointId: null,
    }
    if (resume) Object.assign(run, appendOutput(resume, '\n\n— Continuing unfinished work —\n\n'))
    // Retain only the latest run per case, with a bounded completed history.
    const previous = this.byCase.get(key)
    if (previous) this.runs.delete(previous)
    this.byCase.set(key, runId)
    this.runs.set(runId, run)
    for (const old of this.runs.values()) {
      if (this.runs.size <= 40) break
      if (!caseAgentBusy(old)) { this.runs.delete(old.runId); this.byCase.delete(old.caseKey) }
    }
    this.patch(runId, {})
    try {
      this.connect()
      const task = await prepare()
      this.patch(runId, { status: 'starting' })
      const result = await this.api().agent.run(runId, task.prompt, task.mentions, null, 'full', null, run.conversationId, run.model, !!resume)
      // A short run can finish before the launch reply arrives. Never resurrect it.
      const current = this.runs.get(runId)
      if (current) this.patch(runId, {
        provider: result.provider ?? current.provider,
        model: result.model ?? current.model,
        launchPending: false,
        checkpointId: current.checkpointId ?? result.checkpointId,
        ...(current.status === 'starting' ? { status: 'running' as const } : {}),
      })
      return true
    } catch (error) {
      if (caseAgentBusy(this.runs.get(runId) ?? null)) this.patch(runId, {
        status: 'error', finishedAt: Date.now(), requests: [], launchPending: false,
        error: (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, ''),
      })
      return false
    }
  }
}
