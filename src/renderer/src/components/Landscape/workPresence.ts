/**
 * Work cards: each case or session of the work row as a screen, in the same
 * shape the agent screens use, so they get the same faces and live previews
 * (keyed by the latest run). Pure: stores in, presences out.
 */
import type { ReviewRun } from '../Review/reviewModel'
import type { WorkItem } from '../../lib/sessions/sessionModel'
import type { AgentPresence, PresenceStatus } from './presenceTypes'
import { splitName } from './agentPresence'

export interface CaseBrief {
  id: string
  status: string
  lastNote: string
  artifacts: string[]
}

export function workPresence(
  items: WorkItem[],
  runs: ReviewRun[],
  running: (sessionId: string) => boolean,
  cases: Map<string, CaseBrief>,
): AgentPresence[] {
  const runById = new Map(runs.map((r) => [r.runId, r]))
  return items.map((it) => {
    const sessions = it.kind === 'case' ? it.sessions : [it.session]
    const latest = sessions[0] ?? null
    const run = latest?.lastRunId ? runById.get(latest.lastRunId) : undefined
    const live = sessions.some((s) => running(s.id))
    let status: PresenceStatus = 'idle'
    if (live) status = 'working'
    else if (run?.status === 'pending') status = 'review'
    else if (run?.status === 'error') status = 'error'
    const agents = [...new Set(sessions.map((s) => s.agentName).filter((n): n is string => !!n).map((n) => splitName(n).name))]
    const c = it.kind === 'case' ? cases.get(it.caseId) : undefined
    const lastAsk = latest?.messages.filter((m) => m.role === 'user').pop()?.text ?? null
    return {
      id: it.id,
      name: it.title,
      provider: 'claude',
      role: agents.length ? `with ${agents.join(', ')}` : it.kind === 'case' ? 'Case' : 'Session',
      about: c?.lastNote ?? '',
      status,
      task: lastAsk,
      activity: null,
      since: it.lastAt || null,
      runId: latest?.lastRunId ?? null,
      caseId: it.kind === 'case' ? it.caseId : (latest?.caseId ?? null),
      caseTitle: it.kind === 'case' ? it.title : null,
      question: null,
      outputs: latest?.files.slice().reverse() ?? [],
      kind: 'work',
    }
  })
}
