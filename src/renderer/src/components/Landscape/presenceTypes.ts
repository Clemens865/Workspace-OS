/**
 * One honest state per named agent, derived from the runtime (agentPresence.ts).
 * The landscape screens only ever show these; nothing is invented (PLAN.md §5:
 * "Paused" appears only once real pause/resume exists).
 */
import type { WorkCard } from './workCardModel'

export type PresenceStatus = 'working' | 'question' | 'review' | 'error' | 'interrupted' | 'paused' | 'idle'

export type Provider = 'claude' | 'codex'

export interface AgentPresence {
  /** Stable id: the agent's name as the roster knows it. */
  id: string
  name: string
  provider: Provider
  /** Short role or description, from the agent's definition. */
  role: string
  /** The agent's own description, in full (what it is for). */
  about: string
  status: PresenceStatus
  /** What the agent is on: the run's title or prompt, shortened. */
  task: string | null
  /** The latest activity line (a tool step, an output), when there is one. */
  activity: string | null
  /** ms since epoch of the last state change, for "8 min ago". */
  since: number | null
  /** The run behind this state, for opening it on the stage. */
  runId: string | null
  /** The case the run belongs to, when it is a case run. */
  caseId: string | null
  caseTitle: string | null
  /** A pending question or approval, verbatim. */
  question: string | null
  /** Files the run produced (for review). */
  outputs: string[]
  /** A work card (a case or a session, SESSIONS.md) rather than a roster agent. */
  kind?: 'agent' | 'work'
  /** What a work card says about its case or session (workCardModel). */
  card?: WorkCard
}

/** Status words, as the design writes them. */
export const STATUS_LABEL: Record<PresenceStatus, string> = {
  working: 'Working',
  question: 'Needs your answer',
  review: 'Ready for review',
  error: 'Needs attention',
  interrupted: 'Interrupted',
  paused: 'Paused',
  idle: 'Ready',
}

export const PROVIDER_LABEL: Record<Provider, string> = { claude: 'Claude Code', codex: 'Codex' }

/** Who needs the user first: the order screens line up in, front row first. */
export const STATUS_PRIORITY: Record<PresenceStatus, number> = {
  question: 0,
  error: 1,
  review: 2,
  working: 3,
  interrupted: 4,
  paused: 5,
  idle: 6,
}
