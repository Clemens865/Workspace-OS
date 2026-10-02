import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkCase } from '../../../types/workspace-api'
import type { ReviewRun } from '../../Review/reviewModel'
import { sessionStore } from '../../../lib/sessions/sessionStore'
import { ARC_WORK, workItems } from '../../../lib/sessions/sessionModel'
import { workPresence, type CaseBrief } from '../workPresence'
import type { AgentPresence } from '../presenceTypes'
import { useSessions } from './SessionPane'

/**
 * The work row (SESSIONS.md): every case and every session that is not a case,
 * newest first, as screens. The arc shows the latest ARC_WORK; `total` says how
 * many there are in all (the rest are in the list).
 */
export function useWork(runs: ReviewRun[]): { arc: AgentPresence[]; total: number } {
  useSessions()
  const [cases, setCases] = useState<WorkCase[]>([])
  // Each case type's stages and the statuses that end a case, for "Interview · 3 of 4".
  const [flows, setFlows] = useState<Map<string, string[]>>(new Map())
  const [terminal, setTerminal] = useState<ReadonlySet<string>>(new Set())
  // Re-reads that find nothing new change no state: the row (and the glass behind it) stays still.
  const seen = useRef('')
  const load = useCallback(async () => {
    const list = (await window.workspace.cases.list().catch(() => [])) ?? []
    const types = [...new Set(list.map((c) => c.type))]
    const got = await Promise.all(types.map(async (t) => [t, await window.workspace.cases.statuses(t).catch(() => [])] as const))
    const ends = await window.workspace.cases.terminalStatuses().catch(() => [])
    const key = JSON.stringify([list, got, ends])
    if (key === seen.current) return
    seen.current = key
    setCases(list)
    setFlows(new Map(got))
    setTerminal(new Set(ends))
  }, [])
  const sessions = sessionStore.list()
  const kept = sessions.filter((s) => s.caseId).length
  useEffect(() => {
    void load()
    const off = window.workspace.fs.onRootChanged(() => void load())
    const onChange = (): void => void load()
    window.addEventListener('wos:work-changed', onChange)
    // A case written elsewhere (an agent's wos-case, another window) shows at once, not on the next poll.
    let soon = 0
    const offWatch = window.workspace.fs.onWatchEvent?.((e) => {
      if (!/[/\\]Cases[/\\][^/\\]+\.md$/.test(e.path)) return
      window.clearTimeout(soon)
      soon = window.setTimeout(() => void load(), 250)
    })
    const t = window.setInterval(() => void load(), 20_000)
    return () => {
      off()
      offWatch?.()
      window.clearTimeout(soon)
      window.removeEventListener('wos:work-changed', onChange)
      window.clearInterval(t)
    }
  }, [load, kept])

  return useMemo(() => {
    const items = workItems(
      sessions.filter((s) => s.turns > 0),
      cases.map((c) => ({ id: c.id, title: c.title, updated: c.updated })),
    )
    const briefs = new Map<string, CaseBrief>(cases.map((c) => [c.id, { ...c, type: c.type }]))
    const arc = workPresence(items.slice(0, ARC_WORK), runs, (id) => sessionStore.live(id).running, briefs, { flows, terminal, suggests: (id) => sessionStore.suggests(id) })
    return { arc, total: items.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cases, runs, flows, terminal, sessionStore.getVersion()])
}
