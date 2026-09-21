import { useEffect, useMemo, useState } from 'react'
import { FeedCard } from './FeedCard'
import { HitlCard } from './HitlCard'
import { FleetView } from './FleetView'
import { AgentRoster } from '../Agents/AgentRoster'
import { RoutinesTab } from '../Agents/RoutinesTab'
import { MailFeedCard } from './MailFeedCard'
import { useReviewStore } from './useReviewStore'
import { useMailReviewStore } from './useMailReviewStore'
import { runMatchesFilter, isPending, feedCounts, groupByAgent } from './reviewModel'
import { isMailPending, compareMailCards } from './mailReviewModel'
import styles from './ReviewFeed.module.css'

type ReviewMode = 'team' | 'feed' | 'fleet' | 'routines'

interface ReviewFeedProps {
  onOpenFile: (path: string) => void
  onWorkspaceChanged: () => void
}

/**
 * The Agent Review surface — the ContextHub "Living Feed" as the trust/review
 * layer over agent runs. Pending runs (and live outbound requests) sit at the
 * top by recency; resolved runs flow below as a scrollable record. Filters live
 * in the sidebar rail (ReviewRail); this is the wide center feed.
 *
 * The reward is queue-zero ("you're caught up"), reached identically by Keeping
 * or Reverting — never by approval volume.
 */
export function ReviewFeed({ onOpenFile, onWorkspaceChanged }: ReviewFeedProps): JSX.Element {
  const { runs, filter, hitl } = useReviewStore()
  const { cards: mailCards } = useMailReviewStore()
  const [mode, setMode] = useState<ReviewMode>('feed')

  // Default to the Team roster when the user has saved specialist agents — it's
  // the "who's on my team" surface; the Feed/Fleet are the run-review surfaces.
  useEffect(() => {
    let cancelled = false
    window.workspace.agents
      .list()
      .then((a) => {
        if (!cancelled && a.length > 0) setMode((m) => (m === 'feed' ? 'team' : m))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // The fleet toggle is only meaningful once >1 agent lane exists; below that,
  // the fleet view and the feed are identical, so we keep the toggle available
  // but default to the familiar single-agent feed.
  const laneCount = useMemo(() => groupByAgent(runs, hitl).length, [runs, hitl])

  const { pending, resolved } = useMemo(() => {
    const matching = runs.filter((r) => runMatchesFilter(r, filter))
    return {
      pending: matching.filter((r) => isPending(r.status)).sort((a, b) => b.createdAt - a.createdAt),
      resolved: matching.filter((r) => !isPending(r.status)).sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0)),
    }
  }, [runs, filter])

  // Mail cards are the ACTION family, so they appear under all/action (never
  // the edit filter). Pending on top, resolved with the resolved run stream.
  const showMail = filter === 'all' || filter === 'action' || filter === 'resolved'
  const { mailPending, mailResolved } = useMemo(() => {
    const sorted = [...mailCards].sort(compareMailCards)
    return {
      mailPending: filter === 'resolved' ? [] : sorted.filter((c) => isMailPending(c.status)),
      mailResolved: sorted.filter((c) => !isMailPending(c.status)),
    }
  }, [mailCards, filter])

  const showHitl = filter === 'all' || filter === 'action'
  const counts = feedCounts(runs, hitl)
  const pendingTotal = counts.total + (showMail ? mailPending.length : 0)
  const mins = Math.max(1, Math.round(pendingTotal * 0.5))
  const nothingPending = pendingTotal === 0 && filter !== 'resolved'

  return (
    <section className={styles.surface} data-testid="review-feed">
      <header className={styles.topBar}>
        <span className={styles.count}>
          {mode === 'team'
            ? 'Your team'
            : mode === 'routines'
              ? 'Routines'
            : pendingTotal === 0
              ? 'Nothing needs you'
              : `${pendingTotal} thing${pendingTotal === 1 ? '' : 's'} need you`}
        </span>
        {mode !== 'team' && mode !== 'routines' && pendingTotal > 0 && <span className={styles.eta}>~{mins} min to clear</span>}
        <span className={styles.spacerFlex} />
        <div className={styles.viewToggle} role="tablist" aria-label="Review view">
          <button
            className={mode === 'team' ? styles.viewOn : styles.viewOff}
            onClick={() => setMode('team')}
            data-testid="review-view-team"
          >
            Team
          </button>
          <button
            className={mode === 'feed' ? styles.viewOn : styles.viewOff}
            onClick={() => setMode('feed')}
            data-testid="review-view-feed"
          >
            Feed
          </button>
          <button
            className={mode === 'fleet' ? styles.viewOn : styles.viewOff}
            onClick={() => setMode('fleet')}
            data-testid="review-view-fleet"
          >
            Fleet{laneCount > 1 ? ` (${laneCount})` : ''}
          </button>
          <button
            className={mode === 'routines' ? styles.viewOn : styles.viewOff}
            onClick={() => setMode('routines')}
            data-testid="review-view-routines"
          >
            Routines
          </button>
        </div>
        <span className={styles.subtitle}>
          {mode === 'team'
            ? 'Your specialists. Open one to see how it thinks, or run it in a fresh agent tab.'
            : mode === 'routines'
              ? 'Agents on a clock. Each run lands in the Feed for you to look over; nothing is sent on its own.'
            : mode === 'fleet'
              ? 'One card per assistant. Keep undoable work in batches; anything that sends or can’t be undone always asks you first.'
              : 'Your assistants are working. Here’s what’s ready for you to look over — keep it or undo it, your call.'}
        </span>
      </header>

      {mode === 'team' ? (
        <AgentRoster />
      ) : mode === 'routines' ? (
        <RoutinesTab />
      ) : mode === 'fleet' ? (
        <FleetView onOpenFile={onOpenFile} onWorkspaceChanged={onWorkspaceChanged} />
      ) : (
      <div className={styles.stream}>
        {nothingPending && (
          <div className={styles.zero} data-testid="review-zero">
            <div className={styles.zeroRing}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#3FBFA3" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <div className={styles.zeroTitle}>You’re all caught up.</div>
            <p className={styles.zeroText}>
              No agent run is waiting on you. The feed goes quiet until the next run needs a decision.
            </p>
          </div>
        )}

        {showHitl && hitl.map((h) => <HitlCard key={`hitl-${h.sessionId}`} item={h} />)}

        {showMail && mailPending.map((card) => <MailFeedCard key={`mail-${card.id}`} card={card} />)}

        {pending.map((run) => (
          <FeedCard key={run.runId} run={run} onOpenFile={onOpenFile} onWorkspaceChanged={onWorkspaceChanged} />
        ))}

        {(resolved.length > 0 || (showMail && mailResolved.length > 0)) && (
          <>
            <div className={styles.divider}>
              <span>Recently resolved</span>
            </div>
            {showMail && mailResolved.map((card) => <MailFeedCard key={`mail-${card.id}`} card={card} />)}
            {resolved.map((run) => (
              <FeedCard key={run.runId} run={run} onOpenFile={onOpenFile} onWorkspaceChanged={onWorkspaceChanged} />
            ))}
          </>
        )}
      </div>
      )}
    </section>
  )
}
