import { useState, useCallback } from 'react'
import { DiffInline } from './DiffInline'
import {
  classifyFamily,
  runHeadline,
  deliverableLabel,
  stakeChips,
  relTime,
  isPending,
  resolvedLabel,
  type ReviewRun,
  type DiffStat,
} from './reviewModel'
import { reviewStore } from './reviewStore'
import styles from './FeedCard.module.css'

/** Green check — the "reversible / you can undo this" consequence note icon. */
export function CheckIcon(): JSX.Element {
  return (
    <svg className={styles.noteIcon} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

/** Amber caution — the "this sends / can't be undone" consequence note icon. */
export function CautionIcon(): JSX.Element {
  return (
    <svg className={styles.noteIcon} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 9v4M12 16h.01M10.3 4.3l-7 12A1 1 0 0 0 4 18h16a1 1 0 0 0 .8-1.6l-7-12a1 1 0 0 0-1.5 0z" />
    </svg>
  )
}

interface FeedCardProps {
  run: ReviewRun
  /** Open a produced artifact in the Canvas. */
  onOpenFile: (path: string) => void
  /** Refresh the tree/docs after a revert restores files. */
  onWorkspaceChanged: () => void
}

type Tier = 0 | 1 | 2

/**
 * One agent run as a Living-Feed card. Three-tier progressive disclosure:
 *   Glance (0) — the one-line "what", a minimal stakes row, the primary action(s).
 *   Draft  (1) — the actual diff of the run's changes (reused checkpoint:diff).
 *   Full   (2) — the prompt, produced artifacts, cost breakdown, checkpoint id.
 *
 * Two families (safety encoded in the interaction):
 *   edit   — reversible. Keep / Revert are EQUAL, one-tap. Revert = rollback.
 *   action — not safely revertable. The weighty Keep is DRAFT-GATED and armed
 *            (a deliberate two-step); Dismiss stays equally easy.
 */
export function FeedCard({ run, onOpenFile, onWorkspaceChanged }: FeedCardProps): JSX.Element {
  const [tier, setTier] = useState<Tier>(0)
  const [armed, setArmed] = useState<null | 'keep' | 'revert'>(null)
  const [busy, setBusy] = useState(false)
  const [diffStat, setDiffStat] = useState<DiffStat | null>(null)
  const [draftOpened, setDraftOpened] = useState(false)

  const family = classifyFamily(run)
  const pending = isPending(run.status)
  const headline = runHeadline(run)
  const deliverable = deliverableLabel(run.artifacts)
  const chips = stakeChips(run, diffStat)

  const showDraft = tier >= 1
  const showFull = tier >= 2
  const toggleDraft = useCallback(() => {
    setDraftOpened(true)
    setTier((t) => (t >= 1 ? 0 : 1))
  }, [])
  const toggleFull = useCallback(() => setTier((t) => (t >= 2 ? 1 : 2)), [])

  const keep = useCallback(() => {
    reviewStore.resolveRun(run.runId, 'kept')
  }, [run.runId])

  const revert = useCallback(async () => {
    if (busy || !run.checkpointId) return
    setBusy(true)
    try {
      await window.workspace.checkpoint.rollback(run.checkpointId)
      reviewStore.resolveRun(run.runId, 'reverted')
      onWorkspaceChanged()
    } finally {
      setBusy(false)
    }
  }, [busy, run.checkpointId, run.runId, onWorkspaceChanged])

  // Resolved cards remain in the stream as memory (equal-weight caption).
  if (!pending) {
    return (
      <article className={`${styles.card} ${styles.resolved}`} data-testid="review-card" data-resolved="true">
        <div className={styles.topAccent} />
        <div className={styles.resolvedRow}>
          <span className={styles.resolvedBadge}>
            {resolvedLabel(run)}
          </span>
          <span className={styles.resolvedText}>{headline}</span>
          <span className={styles.resolvedMeta}>
            {run.sessionName} · {run.resolvedAt ? relTime(run.resolvedAt) : relTime(run.createdAt)}
          </span>
        </div>
      </article>
    )
  }

  // action family gates its weighty action behind the draft; edit family is one-tap.
  const keepGated = family === 'action' && !draftOpened
  const keepArmed = armed === 'keep'

  const onKeepClick = (): void => {
    if (keepGated) { toggleDraft(); return }
    if (family === 'action' && !keepArmed) { setArmed('keep'); return }
    keep()
  }

  return (
    <article className={styles.card} data-testid="review-card" data-family={family}>
      <div className={styles.topAccent} />
      <div className={styles.body}>
        <div className={styles.kickerRow}>
          <span className={styles.family}>
            {family === 'action' ? 'Action' : 'Edit'}
          </span>
          <span className={styles.session}>{run.agentName || run.sessionName}</span>
          <span className={styles.time}>{relTime(run.createdAt)}</span>
        </div>

        <h3 className={styles.headline}>{headline}</h3>
        {deliverable && (
          <button className={styles.deliverable} onClick={() => onOpenFile(run.artifacts[0].path)} title="Open in canvas">
            {deliverable}
          </button>
        )}

        <div className={styles.stakes}>
          {chips.map((c) => (
            <span key={c.key} className={c.tone === 'mono' ? styles.chipMono : styles.chip}>
              {c.label}
            </span>
          ))}
          {run.status === 'error' && <span className={styles.chipError}>exited {run.code}</span>}
        </div>

        {family === 'action' ? (
          <p className={`${styles.gateNote} ${styles.willsend}`}>
            <CautionIcon />
            {run.checkpointId
              ? 'Please look this over before you keep it'
              : "This can't be undone automatically — look it over before you keep it"}
          </p>
        ) : (
          <p className={styles.gateNote}>
            <CheckIcon />
            {run.checkpointId
              ? 'Already made on your Mac — you can undo this anytime'
              : 'Already made on your Mac'}
          </p>
        )}

        {/* ── Actions: Keep and Revert/Dismiss are visually EQUAL (anti-rubber-stamp). */}
        <div className={styles.actions}>
          <button
            className={`${styles.act} ${keepArmed ? styles.actArmed : ''}`}
            onClick={onKeepClick}
            disabled={busy}
          >
            {keepGated ? 'Look it over first' : keepArmed ? 'Confirm — keep it' : 'Keep'}
          </button>
          {run.checkpointId ? (
            <button className={styles.act} onClick={() => void revert()} disabled={busy}>
              {busy ? 'Undoing…' : 'Undo'}
            </button>
          ) : (
            <button className={styles.act} onClick={keep} disabled={busy}>
              Dismiss
            </button>
          )}
        </div>

        {/* ── Disclosure toggles. */}
        <div className={styles.disclosure}>
          {run.checkpointId && (
            <button className={styles.discBtn} onClick={toggleDraft}>
              {showDraft ? 'Hide changes' : 'Show changes'}
            </button>
          )}
          <button className={styles.discBtn} onClick={toggleFull}>
            {showFull ? 'Hide context' : 'Why this?'}
          </button>
        </div>

        {/* Tier 1 — Draft: the diff. */}
        {showDraft && run.checkpointId && (
          <div className={styles.tier}>
            <div className={styles.tierKicker}>THE CHANGES THIS RUN MADE</div>
            <DiffInline checkpointId={run.checkpointId} onStat={setDiffStat} />
          </div>
        )}

        {/* Tier 2 — Full context: prompt, artifacts, cost, checkpoint id. */}
        {showFull && (
          <div className={styles.tier}>
            <div className={styles.tierKicker}>WHY THIS RUN EXISTS</div>
            <div className={styles.metaLabel}>Prompt</div>
            <pre className={styles.prompt}>{run.prompt || '(no prompt recorded)'}</pre>
            {run.artifacts.length > 0 && (
              <>
                <div className={styles.metaLabel}>Produced</div>
                <div className={styles.artifactList}>
                  {run.artifacts.map((a) => (
                    <button key={a.path} className={styles.artifactChip} onClick={() => onOpenFile(a.path)} title={a.path}>
                      {a.name}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className={styles.provRow}>
              <span>mode: {run.mode}</span>
              {run.turns > 0 && <span>{run.turns} turns</span>}
              {run.costUsd > 0 && <span>${run.costUsd.toFixed(4)}</span>}
              {run.checkpointId && <span>checkpoint {run.checkpointId.slice(0, 8)}</span>}
            </div>
          </div>
        )}
      </div>
    </article>
  )
}
