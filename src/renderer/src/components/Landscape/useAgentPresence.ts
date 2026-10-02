import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useReviewStore } from '../Review/useReviewStore'
import { activityStore } from '../Review/activityStore'
import { useWorkspaceRoot } from '../../hooks/useWorkspaceRoot'
import { codexAskText, derivePresence, type CodexAsk, type JobLite, type RosterAgent } from './agentPresence'
import type { AgentPresence } from './presenceTypes'

/** Pending Codex requests, kept for the landscape (CodexRequests keeps its own for answering). */
function useCodexAsks(): CodexAsk[] {
  const [asks, setAsks] = useState<CodexAsk[]>([])
  useEffect(
    () =>
      window.workspace?.codex?.onQuestion?.((q: { runId: string; requestId: string; method?: string; resolved?: boolean; params?: Parameters<typeof codexAskText>[1] }) => {
        setAsks((old) => {
          const rest = old.filter((a) => a.runId !== q.runId || a.requestId !== q.requestId)
          return q.resolved ? rest : [...rest, { runId: q.runId, requestId: q.requestId, method: q.method ?? '', text: codexAskText(q.method ?? '', q.params) }]
        })
      }),
    [],
  )
  return asks
}

/** The roster: re-read when the workspace changes or an agent is created/edited. */
function useRoster(root: string): RosterAgent[] {
  const [roster, setRoster] = useState<RosterAgent[]>([])
  useEffect(() => {
    let alive = true
    const load = (): void => {
      void window.workspace?.agents
        ?.list?.()
        .then((list) => {
          if (alive) setRoster(list.map((a) => ({ name: a.name, description: a.description, model: a.model })))
        })
        .catch(() => alive && setRoster([]))
    }
    load()
    window.addEventListener('wos:agents-changed', load)
    return () => {
      alive = false
      window.removeEventListener('wos:agents-changed', load)
    }
  }, [root])
  return roster
}

/** Background jobs from main: listed once, then kept current from updates. */
function useJobs(): JobLite[] {
  const [jobs, setJobs] = useState<JobLite[]>([])
  useEffect(() => {
    let alive = true
    void window.workspace?.runs
      ?.list?.()
      .then((list) => alive && setJobs(list))
      .catch(() => {})
    const off = window.workspace?.runs?.onUpdated?.((job) => setJobs((old) => [...old.filter((j) => j.id !== job.id), job]))
    return () => {
      alive = false
      off?.()
    }
  }, [])
  return jobs
}

/** Re-render every 30 s so "8 min ago" stays true. */
function useMinuteClock(): number {
  const [t, setT] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setT(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])
  return t
}

/** Every roster agent with its one honest state, live. */
export function useAgentPresence(): { agents: AgentPresence[]; loaded: boolean } {
  const root = useWorkspaceRoot()
  const roster = useRoster(root)
  const review = useReviewStore()
  const activity = useSyncExternalStore(activityStore.subscribe, activityStore.getSnapshot, activityStore.getSnapshot)
  const jobs = useJobs()
  const codex = useCodexAsks()
  const clock = useMinuteClock()
  const agents = useMemo(
    () => derivePresence({ roster, runs: review.runs, hitl: review.hitl, activity: activity.byRun, jobs, codex }),
    // the clock is a dependency on purpose: elapsed times are re-read
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roster, review, activity, jobs, codex, clock],
  )
  return { agents, loaded: roster.length > 0 || agents.length > 0 }
}
