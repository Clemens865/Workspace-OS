import { useEffect } from 'react'
import { reviewStore } from './reviewStore'
import { activityStore } from './activityStore'
import type { BackgroundJob } from '../../types/workspace-api'
import type { RunStatus } from './reviewModel'
import { workspaceScope } from '../../lib/workspaceScope'

/**
 * Mirrors main's background runs into the review store, so a run nobody
 * started from a tab still shows up in the feed, the cockpit, Home and Stream
 * exactly like a dock run.
 *
 * Two rules:
 *  - CATCH UP ON MOUNT. A run that finished while no window was open is read
 *    from main's persisted list and opened here with its real start time.
 *  - NEVER UNDO A DECISION. If the person already kept or reverted a run, a
 *    later mirror must not drag it back to "pending".
 */

function feedStatus(job: BackgroundJob): RunStatus {
  if (job.status === 'running') return 'running'
  if (job.status === 'pending') return 'pending'
  return 'error'
}

/** One job → the feed. Exported for tests; idempotent. */
export function mirrorJob(job: BackgroundJob): void {
  if (job.status === 'queued') return
  const lane = job.routineId ?? job.agentName ?? 'background'
  reviewStore.openRun({
    runId: job.id,
    sessionId: lane,
    sessionName: job.label,
    prompt: job.prompt,
    mode: 'safe',
    agentName: job.agentName,
    agentId: lane,
    origin: job.origin,
  })
  const existing = reviewStore.getSnapshot().runs.find((r) => r.runId === job.id)
  if (existing && (existing.status === 'kept' || existing.status === 'reverted')) return
  const status = feedStatus(job)
  reviewStore.patchRun(job.id, {
    status,
    code: job.code,
    checkpointId: job.checkpointId,
    provider: job.provider, costKnown: job.costKnown, inputTokens: job.inputTokens, outputTokens: job.outputTokens, cachedInputTokens: job.cachedInputTokens,
    costUsd: job.costUsd,
    turns: job.turns,
    artifacts: job.artifacts,
    createdAt: job.startedAt ?? job.enqueuedAt,
    origin: job.origin,
  })
  if (status !== 'running') activityStore.clear(job.id)
}

/** A job belongs to the scope whose root it ran in; no root = the "everywhere" scope. */
export function jobInScope(job: Pick<BackgroundJob, 'root'>, root: string | null): boolean {
  const a = (job.root ?? '').replace(/\/+$/, '')
  const b = (root ?? '').replace(/\/+$/, '')
  return a === b
}

export function useBackgroundRuns(): void {
  useEffect(() => {
    const known = new Set<string>()
    const seen = (job: BackgroundJob): void => {
      // The feed is per workspace now: a run for another root must not land
      // in this one's store. It will be caught up when that root is opened.
      if (!jobInScope(job, workspaceScope.root())) return
      known.add(job.id)
      mirrorJob(job)
    }
    const catchUp = (): void => {
      window.workspace.runs
        ?.list()
        .then((jobs) => jobs.slice().reverse().forEach(seen))
        .catch(() => {})
    }
    catchUp()
    // The stores switched inside this same subscription chain; re-read for the new root.
    const offScope = workspaceScope.subscribe(catchUp)
    const offUpdated = window.workspace.runs?.onUpdated(seen)
    // The dock's hooks only record activity for runs they own; background
    // runs are ours to watch.
    const offActivity = window.workspace.agent.onActivity((runId, act) => {
      if (known.has(runId)) activityStore.record(runId, act)
    })
    return () => {
      offScope()
      offUpdated?.()
      offActivity()
    }
  }, [])
}
