/**
 * What a focused agent screen can do. Every action goes through a path that
 * already exists (reviewStore, the checkpoint IPC, the dock's launch, the
 * stage's events), the same ones the Cockpit's NeedsYouCard uses.
 */
import { reviewStore } from '../Review/reviewStore'
import { launchAgent } from '../Agents/launch'
import type { RailId } from '../Shell/shellModel'

export function openRail(rail: RailId): void {
  window.dispatchEvent(new CustomEvent('wos:open-rail', { detail: { rail } }))
}

/** Open a document on the stage as a full tab (WorkspaceShell listens). */
export function openFile(path: string): void {
  window.dispatchEvent(new CustomEvent('wos:open-file', { detail: { path } }))
}

/** Start a session with this agent: the dock opens on the stage with its tab. */
export function startWith(name: string): void {
  launchAgent(name)
}

/** The live session for a run (its PTY approval is keyed by session). */
export function sessionOf(runId: string | null): string | null {
  if (!runId) return null
  return reviewStore.getSnapshot().runs.find((r) => r.runId === runId)?.sessionId ?? null
}

export function approve(runId: string | null, scope: 'once' | 'session' = 'once'): boolean {
  const s = sessionOf(runId)
  if (!s) return false
  reviewStore.respondHitl(s, scope === 'once' ? 'allow-once' : 'allow-session')
  return true
}

export function deny(runId: string | null): boolean {
  const s = sessionOf(runId)
  if (!s) return false
  reviewStore.respondHitl(s, 'deny')
  return true
}

export function keep(runId: string | null): void {
  if (runId) reviewStore.resolveRun(runId, 'kept')
}

/** Roll the workspace back to the run's checkpoint, then mark it reverted. */
export async function revert(runId: string | null): Promise<boolean> {
  const run = runId ? reviewStore.getSnapshot().runs.find((r) => r.runId === runId) : undefined
  if (!run?.checkpointId) return false
  await window.workspace.checkpoint.rollback(run.checkpointId)
  reviewStore.resolveRun(run.runId, 'reverted')
  return true
}

export function canRevert(runId: string | null): boolean {
  return !!(runId && reviewStore.getSnapshot().runs.find((r) => r.runId === runId)?.checkpointId)
}

/** Stop a run: a background job through the queue, a dock run through the agent. */
export async function stop(runId: string | null): Promise<void> {
  if (!runId) return
  const jobs = (await window.workspace.runs?.list?.().catch(() => [])) ?? []
  if (jobs.some((j) => j.id === runId)) await window.workspace.runs.cancel(runId)
  else await window.workspace.agent.cancel(runId)
}

/** The Agent Foundry lives on the Agents surface; open it there. */
export function createAgent(): void {
  openRail('agents')
  window.setTimeout(() => window.dispatchEvent(new CustomEvent('wos:new-agent', { detail: {} })), 350)
}

/** End a paused run for good: a background job is cancelled; a dock run is closed as kept. */
export async function stopPaused(runId: string | null): Promise<void> {
  if (!runId) return
  const jobs = (await window.workspace.runs?.list?.().catch(() => [])) ?? []
  if (jobs.some((j) => j.id === runId)) await window.workspace.runs.cancel(runId)
  else reviewStore.resolveRun(runId, 'kept')
}
