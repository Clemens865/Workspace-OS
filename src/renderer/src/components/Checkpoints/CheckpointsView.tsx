import { useState, useEffect, useCallback } from 'react'
import type { Checkpoint } from '../../types/workspace-api'
import { DiffSheet } from './DiffSheet'
import styles from './CheckpointsView.module.css'

interface CheckpointsViewProps {
  onClose: () => void
  /** Called after a restore so the file tree and open docs refresh. */
  onChange: () => void
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * Checkpoint timeline (Agent ▸ Checkpoints…): every shadow-git snapshot taken
 * before an agent run, with per-checkpoint diff preview and restore. The trust
 * surface for agent edits — see what changed, when, and roll back safely.
 */
export function CheckpointsView({ onClose, onChange }: CheckpointsViewProps): JSX.Element {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<Checkpoint | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setCheckpoints(await window.workspace.checkpoint.list())
    } catch {
      setCheckpoints([]) // no workspace open / git unavailable
    }
    setLoading(false)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // Restore = rollback (itself checkpointed, so it's undoable from this list).
  const restore = useCallback(async (cp: Checkpoint) => {
    await window.workspace.checkpoint.rollback(cp.id)
    await refresh()
    onChange()
  }, [refresh, onChange])

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} data-testid="checkpoints-view" onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.heading}>Checkpoints</span>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div className={styles.body}>
          {loading ? (
            <div className={styles.state}>Loading…</div>
          ) : checkpoints.length === 0 ? (
            <div className={styles.state}>
              No checkpoints yet — one is taken before every agent run.
            </div>
          ) : (
            checkpoints.map((cp) => (
              <div key={cp.id} className={styles.row}>
                <div className={styles.info}>
                  <span className={styles.label}>{cp.label || 'checkpoint'}</span>
                  <span className={styles.meta}>
                    {relativeTime(cp.createdAt)} · {cp.id.slice(0, 8)}
                  </span>
                </div>
                <div className={styles.actions}>
                  <button className={styles.diffBtn} onClick={() => setPreview(cp)}>
                    Changes
                  </button>
                  <button className={styles.restoreBtn} onClick={() => void restore(cp)}>
                    Restore
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {preview && (
        <DiffSheet
          checkpointId={preview.id}
          title={`“${preview.label || 'checkpoint'}” (${relativeTime(preview.createdAt)})`}
          onClose={() => setPreview(null)}
          onRevert={async () => {
            await restore(preview)
            setPreview(null)
          }}
        />
      )}
    </div>
  )
}
