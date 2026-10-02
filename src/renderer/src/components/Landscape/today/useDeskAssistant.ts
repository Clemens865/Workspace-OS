import { useCallback, useEffect, useRef, useState } from 'react'
import { reviewStore } from '../../Review/reviewStore'
import { activityStore } from '../../Review/activityStore'
import { buildDeskAsk } from '../../Shell/home/deskModel'
import type { TodayModel } from './todayModel'
import type { TodayData } from './useToday'

export type DeskMsg = { role: 'user' | 'agent'; text: string }

/**
 * The desk assistant from the old Home, for the landscape: an agent run
 * grounded in exactly what the Today view shows (buildDeskAsk), streamed into
 * a small conversation. The run is registered in the review store like any
 * other, so it also appears on the team and in the Inbox when it finishes.
 */
export function useDeskAssistant(model: TodayModel, desk: TodayData['desk'], onDone?: () => void) {
  const [msgs, setMsgs] = useState<DeskMsg[]>([])
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<string | null>(null)
  const runRef = useRef<string | null>(null)

  useEffect(() => {
    const offOut = window.workspace.agent.onOutput((runId, chunk) => {
      if (runId !== runRef.current) return
      setMsgs((prev) => {
        const last = prev[prev.length - 1]
        if (last?.role === 'agent') return [...prev.slice(0, -1), { role: 'agent', text: last.text + chunk }]
        return [...prev, { role: 'agent', text: chunk }]
      })
    })
    const offAct = window.workspace.agent.onActivity((runId, act) => {
      if (runId !== runRef.current) return
      activityStore.record(runId, act)
      setStep(act.label)
    })
    const offDone = window.workspace.agent.onDone((runId, code, checkpointId) => {
      if (runId !== runRef.current) return
      activityStore.clear(runId)
      reviewStore.patchRun(runId, { status: code === 0 ? 'pending' : 'error', code, checkpointId: checkpointId ?? null })
      runRef.current = null
      setBusy(false)
      setStep(null)
      onDone?.()
    })
    return () => {
      offOut()
      offAct()
      offDone()
    }
  }, [onDone])

  const ask = useCallback(
    (raw: string) => {
      if (busy) return
      const shown = raw.trim() || 'Brief me.'
      setMsgs((prev) => [...prev, { role: 'user', text: shown }])
      setBusy(true)
      const runId = `home-ask-${Date.now()}`
      runRef.current = runId
      const prompt = buildDeskAsk(raw, {
        cases: desk.cases.map((c) => ({ id: c.id, title: c.title, status: c.status })),
        events: desk.events.map((e) => ({ summary: e.summary, start: e.start, allDay: e.allDay })),
        running: reviewStore
          .getSnapshot()
          .runs.filter((r) => r.status === 'running')
          .map((r) => ({ name: r.agentName ?? r.sessionName, live: activityStore.getSnapshot().byRun.get(r.runId)?.label })),
        files: model.files.slice(0, 5).map((f) => f.path),
        pages: model.pages.slice(0, 5).map((p) => ({ title: p.title, url: p.url })),
      })
      reviewStore.openRun({ runId, sessionId: 'home-desk', sessionName: 'Desk assistant', prompt: shown, mode: 'full', agentName: null, agentId: 'home-desk' })
      window.workspace.agent.run(runId, prompt, [], null, 'full', null, 'home-desk-assistant').catch((err: Error) => {
        setMsgs((prev) => [...prev, { role: 'agent', text: `[error] ${err.message}` }])
        reviewStore.patchRun(runId, { status: 'error', code: null })
        runRef.current = null
        setBusy(false)
      })
    },
    [busy, desk, model],
  )

  return { msgs, busy, step, ask }
}
