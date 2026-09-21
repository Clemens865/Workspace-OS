import { app, type IpcMain } from 'electron'
import path from 'path'
import { IPC } from '../ipc-channels'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError } from '../ipc-validator'
import { assertMainFrame } from '../security'
import { sendToWindow } from '../main-window'
import { sanitizeContextFiles } from '../agent-permissions'
import { launchRun } from '../agent/launchRun'
import { isValidModelAlias, parseModelPick } from '../agent/modelPick'
import { readAgentForRun } from './agents'
import { getDefaultAgentModel } from './agent'
import { validCapabilities } from '../agent/capabilityCatalog'
import { getWorkspaceRoot } from '../workspace-root'
import { RunQueue, type BackgroundJob, type JobInput, type JobSink } from '../runs/queue'
import { notify } from '../notify'

/**
 * The background run queue's IPC + its wiring to the real launcher.
 *
 * Runs here are UNATTENDED, so two things differ from the dock:
 *  - SAFE MODE ONLY. Nobody is watching to approve a destructive command, and
 *    per-run bridge authorization (M3) has not landed yet. In -p mode a tool
 *    outside the allowlist is denied, not prompted, so a run never hangs on a
 *    question — it finishes, and the feed shows it as pending review.
 *  - AN IDLE TIMEOUT. Fifteen minutes with no output means a hung child.
 *
 * Every event is recorded on the job (persisted) AND forwarded to the window
 * on the same agent channels the dock uses, keyed by the job id, so the
 * cockpit, Home and Stream see a background run exactly like a dock run.
 */

const IDLE_TIMEOUT_MS = 15 * 60_000
const PROMPT_MAX = 20_000

let queue: RunQueue | null = null

function getQueue(): RunQueue {
  if (!queue) {
    queue = new RunQueue(path.join(app.getPath('userData'), 'runs-queue.json'), launcher, {
      concurrency: 2,
      onEvent: (ev) => {
        if (ev.type === 'output') sendToWindow(IPC.AGENT_OUTPUT, ev.job.id, ev.text ?? '')
        else {
          sendToWindow(IPC.RUNS_UPDATED, ev.job)
          announceLanding(ev.job)
        }
      },
    })
  }
  return queue
}

async function launcher(job: BackgroundJob, sink: JobSink): Promise<{ kill: () => void }> {
  const agent = job.agentName ? readAgentForRun(job.agentName) : null
  const routinePick = parseModelPick(agent?.model && isValidModelAlias(agent.model) ? agent.model : getDefaultAgentModel())
  const { child } = await launchRun({
    runId: job.id,
    prompt: job.prompt,
    contextFiles: sanitizeContextFiles(job.contextFiles),
    activeFile: null,
    safeMode: true,
    agent,
    model: routinePick.model || undefined,
    provider: routinePick.provider,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    // Exactly what the job declares — a routine's grant is its own, never the
    // dock's 'all'. An unattended run with no declared capability reaches nothing.
    capabilities: job.capabilities,
    sink: {
      output: (t) => sink.output(t),
      meta: (m) => {
        sink.meta(m)
        sendToWindow(IPC.AGENT_RUN_META, job.id, m)
      },
      activity: (a) => sendToWindow(IPC.AGENT_ACTIVITY, job.id, a),
      artifacts: (list) => {
        sink.artifacts(list.map((a) => ({ path: a.path, name: a.name, type: a.type })))
        sendToWindow(IPC.AGENT_ARTIFACTS, job.id, list)
      },
      // A background run's deliverable does not auto-open — nobody asked to
      // look at it right now. It is on the card, one click away.
      artifact: () => {},
      done: (code, cp) => {
        sink.done(code, cp)
        sendToWindow(IPC.AGENT_DONE, job.id, code, cp)
      },
    },
  })
  return { kill: () => child.kill('SIGTERM') }
}

/**
 * A run that LANDED needing the person is worth a notification; a run that is
 * merely progressing is not. Transitions only — the queue emits many updates.
 */
const lastStatus = new Map<string, string>()
function announceLanding(job: BackgroundJob): void {
  const prev = lastStatus.get(job.id)
  lastStatus.set(job.id, job.status)
  if (prev === job.status) return
  if (job.status === 'pending') notify({ source: 'routines', key: job.id, title: job.label, body: 'ran and needs you to look it over.', rail: 'agents' })
  else if (job.status === 'error') notify({ source: 'routines', key: job.id, title: job.label, body: 'failed — see the Feed.', rail: 'agents' })
  if (job.status !== 'running' && job.status !== 'queued') lastStatus.delete(job.id)
}

/** Enqueue from anywhere in main (routines, M3). */
export function enqueueBackgroundRun(input: JobInput): BackgroundJob {
  return getQueue().enqueue({ ...input, root: input.root ?? getWorkspaceRoot() })
}

export function listBackgroundRuns(): BackgroundJob[] {
  return getQueue().list()
}

/** App quit — end what is running and mark it interrupted on disk. */
export function shutdownRunQueue(): void {
  queue?.shutdown()
}

export function registerRunsHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, IPC.RUNS_ENQUEUE, (event, input: unknown) => {
    assertMainFrame(event)
    const i = (input ?? {}) as Record<string, unknown>
    if (typeof i.prompt !== 'string' || !i.prompt.trim()) throw new IpcValidationError('Prompt must be a non-empty string')
    if (i.prompt.length > PROMPT_MAX) throw new IpcValidationError('Prompt too long')
    return getQueue().enqueue({
      prompt: i.prompt,
      label: typeof i.label === 'string' ? i.label : undefined,
      agentName: typeof i.agentName === 'string' && i.agentName ? i.agentName : null,
      origin: i.origin === 'routine' ? 'routine' : 'background',
      contextFiles: sanitizeContextFiles(i.contextFiles),
      capabilities: validCapabilities(i.capabilities),
      root: getWorkspaceRoot(),
    })
  })

  ipcHandle(ipcMain, IPC.RUNS_LIST, (event) => {
    assertMainFrame(event)
    return getQueue().list()
  })

  ipcHandle(ipcMain, IPC.RUNS_CANCEL, (event, id: unknown) => {
    assertMainFrame(event)
    if (typeof id !== 'string' || !/^bg-[a-z0-9-]{3,40}$/.test(id)) throw new IpcValidationError('Invalid run id')
    return { ok: getQueue().cancel(id) }
  })
}
