import { useMemo } from 'react'
import { useSyncExternalStore } from 'react'
import { useReviewStore } from '../Review/useReviewStore'
import { activityStore } from '../Review/activityStore'
import { useMailReviewStore } from '../Review/useMailReviewStore'
import {
  selectWorking,
  selectNeedsYou,
  selectMailNeedsYou,
  selectLanded,
  cockpitStatus,
  LABEL_ORDER,
  type CockpitData,
} from './cockpitModel'

export type { CockpitData }

/** Subscribes to the live per-run activity lines (the "deep-reading X" signal). */
function useActivity(): Map<string, { tool: string; label: string; at: number }> {
  return useSyncExternalStore(
    activityStore.subscribe,
    () => activityStore.getSnapshot().byRun,
    () => activityStore.getSnapshot().byRun,
  )
}

/**
 * The LIVE cockpit read — composes the shared reviewStore (runs + HITL) with the
 * live-activity adjunct into the three zones. Pure selectors do the mapping; this
 * hook only wires the stores. No mock, no fabricated signals.
 */
export function useCockpitData(): CockpitData {
  const { runs, hitl } = useReviewStore()
  const activity = useActivity()
  // Mail that needs a reply is the same kind of obligation as a run awaiting
  // approval, so it joins the SAME list rather than living in a box the user
  // has to remember to open.
  const mail = useMailReviewStore()

  return useMemo(() => {
    const working = selectWorking(runs, activity)
    const mailCards = mail.cards.map((c) => ({
      id: c.id,
      subject: c.source.subject,
      fromLabel: c.source.fromLabel,
      status: c.status,
      createdAt: c.createdAt,
    }))
    const needsYou = [...selectNeedsYou(runs, hitl), ...selectMailNeedsYou(mailCards)].sort(
      (a, b) => LABEL_ORDER[a.label.category] - LABEL_ORDER[b.label.category] || b.createdAt - a.createdAt,
    )
    const landed = selectLanded(runs)
    return {
      status: cockpitStatus(working.length, needsYou.length),
      working,
      needsYou,
      landed,
    }
  }, [runs, hitl, activity, mail])
}
