import { useCallback, useState } from 'react'
import type { NeedsYouItem } from './cockpitModel'
import { reviewStore } from '../Review/reviewStore'
import { CategoryLabel } from './CategoryLabel'
import styles from './NeedsYouCard.module.css'
import { ArtifactThumb } from './ArtifactThumb'

interface Props {
  item: NeedsYouItem
  /** Opens an artifact in the Canvas (the real office.openFile path). */
  onOpenFile?: (path: string) => void
  /** Called after a revert so the caller can refresh the workspace view. */
  onWorkspaceChanged?: () => void
}

/**
 * A LIVE needs-you item — the only warm, forward thing on the surface. It carries
 * the categorical LABEL (what's needed), a plain-language line, and ONE leaned
 * blue primary that calls the REAL action:
 *   - a checkpointed REVIEW run  → Keep (resolveRun 'kept') / Revert (rollback)
 *   - a SEND / DECISION run       → Keep, plus Open the diff/artifact
 *   - a HITL request              → Approve / Deny via respondHitl
 *   - an ERROR run                → Dismiss (resolveRun 'kept', it's already done)
 * All actions go through the existing reviewStore / checkpoint IPC — no new path.
 */
export function NeedsYouCard({ item, onOpenFile, onWorkspaceChanged }: Props): JSX.Element {
  const [busy, setBusy] = useState(false)

  const keep = useCallback(() => {
    if (item.runId) reviewStore.resolveRun(item.runId, 'kept')
  }, [item.runId])

  const revert = useCallback(async () => {
    if (busy || !item.checkpointId || !item.runId) return
    setBusy(true)
    try {
      await window.workspace.checkpoint.rollback(item.checkpointId)
      reviewStore.resolveRun(item.runId, 'reverted')
      onWorkspaceChanged?.()
    } finally {
      setBusy(false)
    }
  }, [busy, item.checkpointId, item.runId, onWorkspaceChanged])

  const approve = useCallback(() => {
    if (item.sessionId) reviewStore.respondHitl(item.sessionId, 'allow-once')
  }, [item.sessionId])

  const deny = useCallback(() => {
    if (item.sessionId) reviewStore.respondHitl(item.sessionId, 'deny')
  }, [item.sessionId])

  const open = useCallback(() => {
    if (item.artifactPath) onOpenFile?.(item.artifactPath)
  }, [item.artifactPath, onOpenFile])

  const isError = item.label.category === 'ERROR'

  return (
    <div className={styles.item} data-testid="cockpit-needs-you">
      <div className={styles.top}>
        <CategoryLabel label={item.label} />
        <span className={styles.by}>{item.who}</span>
        <span className={styles.spacer} />
        {item.turns > 0 && <span className={styles.meter}>{item.turns} turns</span>}
        {item.costUsd > 0 && <span className={styles.meter}>${item.costUsd.toFixed(2)}</span>}
      </div>

      <div className={styles.line}>{item.line}</div>

      {/* The RESULT, shown rather than described. A finished run's deliverable
          is the thing the human is actually deciding about, so it belongs on the
          card — a real preview for a web page, clickable straight into the
          canvas. Without it the card said work had happened and made you go
          hunting for what. */}
      {item.artifactPath && (
        <button className={styles.artifactPreview} onClick={open} title={`Open ${item.artifactName ?? 'the result'}`}>
          <ArtifactThumb path={item.artifactPath} name={item.artifactName ?? 'result'} />
          <span className={styles.artifactCaption}>{item.artifactName ?? 'Open result'}</span>
        </button>
      )}

      <div className={styles.actions}>
        {item.kind === 'hitl' ? (
          <>
            <button className={styles.primary} onClick={approve}>Approve</button>
            <button className={styles.secondary} onClick={deny}>Deny</button>
          </>
        ) : isError ? (
          <button className={styles.primary} onClick={keep}>Dismiss</button>
        ) : (
          <>
            <button className={styles.primary} onClick={keep}>Keep</button>
            {item.reversible && (
              <button className={styles.secondary} onClick={revert} disabled={busy}>
                {busy ? 'Reverting…' : 'Revert'}
              </button>
            )}
            {item.artifactPath && (
              <button className={styles.secondary} onClick={open}>Open</button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
