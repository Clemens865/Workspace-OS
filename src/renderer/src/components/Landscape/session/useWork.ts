import { useCallback, useEffect, useMemo, useState } from 'react'
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
  const load = useCallback(async () => {
    setCases((await window.workspace.cases.list().catch(() => [])) ?? [])
  }, [])
  const sessions = sessionStore.list()
  const kept = sessions.filter((s) => s.caseId).length
  useEffect(() => {
    void load()
    const off = window.workspace.fs.onRootChanged(() => void load())
    const onChange = (): void => void load()
    window.addEventListener('wos:work-changed', onChange)
    const t = window.setInterval(() => void load(), 20_000)
    return () => {
      off()
      window.removeEventListener('wos:work-changed', onChange)
      window.clearInterval(t)
    }
  }, [load, kept])

  return useMemo(() => {
    const items = workItems(
      sessions.filter((s) => s.turns > 0),
      cases.map((c) => ({ id: c.id, title: c.title, updated: c.updated })),
    )
    const briefs = new Map<string, CaseBrief>(cases.map((c) => [c.id, { id: c.id, status: c.status, lastNote: c.notes[c.notes.length - 1]?.text ?? '', artifacts: c.artifacts }]))
    const arc = workPresence(items.slice(0, ARC_WORK), runs, (id) => sessionStore.live(id).running, briefs)
    return { arc, total: items.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cases, runs, sessionStore.getVersion()])
}
