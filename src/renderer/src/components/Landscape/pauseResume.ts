/**
 * Pause and resume (PLAN.md §5, P2 item 9).
 *
 * Background jobs pause in main's queue, which keeps their provider session.
 * Dock runs pause here: the run is stopped through `agent.cancel` (main keeps
 * the conversation → session mapping), then marked paused once its exit has
 * landed (the dock pane would otherwise record the exit as an error). Resume
 * continues the SAME conversation with `resumeOnly`, so main refuses rather
 * than silently starting over if the session is gone.
 */
import { reviewStore } from '../Review/reviewStore'
import { activityStore } from '../Review/activityStore'
import { sessionStore } from '../AgentTerminal/sessionStore'
import { pausedResumePrompt } from '../../../../shared/agentRun'
import { outputStore } from './previewStore'

/** The conversation a dock run belongs to: the fleet session's own id, or the dock pane's. */
export function conversationFor(sessionId: string): string {
  return sessionStore.get(sessionId)?.conversationId ?? `dock-convo-${sessionId}`
}

async function isJob(runId: string): Promise<boolean> {
  if (!runId.startsWith('bg-')) return false
  const jobs = (await window.workspace.runs?.list?.().catch(() => [])) ?? []
  return jobs.some((j) => j.id === runId)
}

export async function pauseRun(runId: string | null): Promise<void> {
  if (!runId) return
  if (await isJob(runId)) {
    await window.workspace.runs.pause(runId)
    return
  }
  await new Promise<void>((resolve) => {
    let settled = false
    const mark = (): void => {
      if (settled) return
      settled = true
      off?.()
      // After the dock's own done-handler has run (listeners fire in order).
      window.setTimeout(() => {
        reviewStore.patchRun(runId, { status: 'paused', resolvedAt: Date.now() })
        activityStore.clear(runId)
        resolve()
      }, 0)
    }
    const off = window.workspace.agent.onDone((id) => {
      if (id === runId) mark()
    })
    void window.workspace.agent.cancel(runId).catch(() => mark())
    // A run that had already ended still becomes paused, never stuck.
    window.setTimeout(mark, 4000)
  })
}

/** Follow a resumed run in the feed: activity, files, and how it lands. */
function track(runId: string): void {
  const offs: (() => void)[] = []
  offs.push(window.workspace.agent.onActivity((id, a) => id === runId && activityStore.record(runId, { tool: a.tool, label: a.label })))
  offs.push(window.workspace.agent.onArtifacts((id, list) => id === runId && reviewStore.patchRun(runId, { artifacts: list.map((f) => ({ path: f.path, name: f.name, type: f.type })) })))
  offs.push(
    window.workspace.agent.onDone((id, code, checkpointId) => {
      if (id !== runId) return
      offs.forEach((o) => o())
      activityStore.clear(runId)
      // A run paused again keeps that state.
      if (reviewStore.getSnapshot().runs.find((r) => r.runId === runId)?.status === 'paused') return
      reviewStore.patchRun(runId, { status: code === 0 ? 'pending' : 'error', code, checkpointId, resolvedAt: Date.now() })
    }),
  )
}

export async function resumeRun(runId: string | null): Promise<string | null> {
  if (!runId) return null
  if (await isJob(runId)) {
    await window.workspace.runs.resume(runId)
    return runId
  }
  const run = reviewStore.getSnapshot().runs.find((r) => r.runId === runId)
  if (!run) throw new Error('That run is no longer in the feed.')
  const next = `resume-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  reviewStore.openRun({
    runId: next,
    sessionId: run.sessionId,
    sessionName: run.sessionName,
    agentId: run.agentId,
    agentName: run.agentName,
    prompt: `Continue: ${run.prompt}`,
    mode: run.mode,
  })
  track(next)
  try {
    await window.workspace.agent.run(next, pausedResumePrompt(outputStore.get(run.runId)?.text), [], null, run.mode, run.agentName, conversationFor(run.sessionId), undefined, true)
  } catch (e) {
    reviewStore.patchRun(next, { status: 'error', code: null, resolvedAt: Date.now() })
    throw e
  }
  // The paused run is now continued by the new one; it no longer waits on anyone.
  reviewStore.resolveRun(run.runId, 'kept')
  return next
}
