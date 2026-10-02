import { useState, useEffect, useCallback } from 'react'
import type { TrashEntry } from '../../types/workspace-api'
import styles from './TrashView.module.css'

interface TrashViewProps {
  onClose: () => void
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

export function TrashView({ onClose, onChange }: TrashViewProps): JSX.Element {
  const [entries, setEntries] = useState<TrashEntry[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    setEntries(await window.workspace.trash.list())
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleRestore = useCallback(async (id: string) => {
    await window.workspace.trash.restore(id)
    await refresh()
    onChange()
  }, [refresh, onChange])

  const handleDelete = useCallback(async (id: string) => {
    await window.workspace.trash.delete(id)
    await refresh()
  }, [refresh])

  const handleEmpty = useCallback(async () => {
    if (!window.confirm('Permanently delete everything in trash? This cannot be undone.')) return
    await window.workspace.trash.empty()
    await refresh()
  }, [refresh])

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.heading}>Trash</span>
          <div className={styles.headerActions}>
            {entries.length > 0 && (
              <button className={styles.emptyBtn} onClick={handleEmpty}>Empty Trash</button>
            )}
            <button className={styles.closeBtn} onClick={onClose}>×</button>
          </div>
        </div>

        <div className={styles.body}>
          {loading ? (
            <div className={styles.state}>Loading…</div>
          ) : entries.length === 0 ? (
            <div className={styles.state}>Trash is empty</div>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className={styles.row}>
                <div className={styles.info}>
                  <span className={styles.name}>
                    {entry.isDirectory ? '📁 ' : ''}{entry.originalName}
                  </span>
                  <span className={styles.meta}>
                    {entry.op === 'delete' ? 'Deleted' : 'Overwritten'} · {relativeTime(entry.trashedAt)}
                  </span>
                  <span className={styles.path}>{entry.originalPath}</span>
                </div>
                <div className={styles.actions}>
                  <button className={styles.restoreBtn} onClick={() => handleRestore(entry.id)}>
                    Restore
                  </button>
                  <button className={styles.deleteBtn} onClick={() => handleDelete(entry.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
