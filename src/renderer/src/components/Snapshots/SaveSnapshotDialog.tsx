import { useState } from 'react'
import styles from './SaveSnapshotDialog.module.css'

interface SaveSnapshotDialogProps {
  onClose: () => void
  /** Persists the snapshot under this name (File ▸ Snapshots ▸ Save Snapshot…). */
  onSave: (name: string) => Promise<void>
}

/** Tiny name prompt — window.prompt doesn't exist in Electron renderers. */
export function SaveSnapshotDialog({ onClose, onSave }: SaveSnapshotDialogProps): JSX.Element {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      await onSave(trimmed)
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} data-testid="save-snapshot" onClick={(e) => e.stopPropagation()}>
        <div className={styles.heading}>Save Snapshot</div>
        <div className={styles.hint}>
          Saves your current desk — open tabs, active tab, and panel layout — under a name
          you can restore from File ▸ Snapshots. Re-using a name updates that snapshot.
        </div>
        <input
          className={styles.input}
          placeholder="e.g. Monday planning desk"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
            else if (e.key === 'Escape') onClose()
          }}
        />
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button className={styles.saveBtn} onClick={() => void submit()} disabled={!name.trim() || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
