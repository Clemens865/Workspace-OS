import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { reviewStore } from '../../Review/reviewStore'
import { activityStore } from '../../Review/activityStore'
import { useMailReviewStore } from '../../Review/useMailReviewStore'
import { peekSession } from '../../Browser/session-restore'
import { useCreatedAssets } from '../../../hooks/useCreatedAssets'
import { useWorkspaceRoot } from '../../../hooks/useWorkspaceRoot'
import { useWorkspaceLibrary } from '../../../hooks/useWorkspaceLibrary'
import { nextMorning, parseSnoozes } from '../../Shell/home/deskModel'
import { buildToday, type TodayCase, type TodayEvent, type TodayModel } from './todayModel'

const SNOOZE_KEY = 'wos:hero-snooze' // shared with the stage's Home, so a snooze holds in both

interface Loaded {
  cases: TodayCase[]
  events: TodayEvent[]
  history: { url: string; title?: string }[]
  mailAccounts: number
}

const EMPTY: Loaded = { cases: [], events: [], history: [], mailAccounts: 0 }

export interface TodayData {
  model: TodayModel
  loading: boolean
  /** The raw lists the desk assistant grounds itself in. */
  desk: Loaded
  snooze: (caseId: string) => void
  refresh: () => void
}

/**
 * Everything the Today view shows, live: cases, calendar (48 h), browser
 * history and mail accounts from IPC (refreshed on mount and when the
 * workspace switches), runs and activity from the review stores, created
 * files from the watcher, opened files from the workspace library.
 */
export function useToday(): TodayData {
  const root = useWorkspaceRoot()
  const library = useWorkspaceLibrary(root)
  const created = useCreatedAssets()
  const review = useSyncExternalStore(reviewStore.subscribe, reviewStore.getSnapshot)
  const activity = useSyncExternalStore(activityStore.subscribe, activityStore.getSnapshot)
  const mail = useMailReviewStore()
  const [loaded, setLoaded] = useState<Loaded>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [snoozes, setSnoozes] = useState<Record<string, number>>(() => parseSnoozes(localStorage.getItem(SNOOZE_KEY)))

  const refresh = useCallback(async () => {
    const now = Date.now()
    const ws = window.workspace
    const [cases, calendar, history, accounts] = await Promise.all([
      ws.cases.list().catch(() => []),
      ws.calendar.events(now, now + 48 * 3600_000).catch(() => ({ events: [], sources: [] })),
      ws.history.recent(12).catch(() => []),
      ws.mail.accounts.list().catch(() => []),
    ])
    setLoaded({
      cases: cases.map((c) => {
        const last = c.notes[c.notes.length - 1]
        return {
          id: c.id,
          title: c.title,
          status: c.status,
          updated: c.updated,
          lastNote: last?.text ?? '',
          lastNoteAt: Date.parse(last?.at ?? '') || 0,
          lastNoteAuthor: last?.author ?? '',
        }
      }),
      events: calendar.events.map((e) => ({ uid: e.uid, summary: e.summary, start: e.start, end: e.end, allDay: e.allDay })),
      history: history as { url: string; title?: string }[],
      mailAccounts: accounts.length,
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
    return window.workspace.fs.onRootChanged(() => void refresh())
  }, [refresh])

  const snooze = useCallback((caseId: string) => {
    setSnoozes((cur) => {
      const next = { ...cur, [caseId]: nextMorning() }
      try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(next)) } catch { /* private mode: snooze for this session */ }
      return next
    })
  }, [])

  const model = useMemo(
    () =>
      buildToday({
        now: Date.now(),
        cases: loaded.cases,
        events: loaded.events,
        runs: review.runs.map((r) => ({
          runId: r.runId,
          name: r.agentName ?? r.sessionName,
          status: r.status,
          prompt: r.prompt,
          at: r.resolvedAt ?? r.createdAt,
          live: activity.byRun.get(r.runId)?.label,
        })),
        created,
        recent: library.recent,
        openTabs: peekSession().map((t) => ({ url: t.url, title: t.title })),
        history: loaded.history,
        mailAccounts: loaded.mailAccounts,
        mailWaiting: mail.cards
          .filter((c) => c.status !== 'sent' && c.status !== 'dismissed')
          .map((c) => ({ id: c.id, subject: c.source.subject || '(no subject)', from: c.source.fromLabel })),
        snoozes,
      }),
    [loaded, review.runs, activity, created, library.recent, mail.cards, snoozes],
  )

  return { model, loading, desk: loaded, snooze, refresh: () => void refresh() }
}
