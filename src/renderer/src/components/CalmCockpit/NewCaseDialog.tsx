import { useState, useCallback, useEffect, useRef } from 'react'
import { X, FolderPlus, Loader2, FileText } from 'lucide-react'
import type { WorkCase } from '../../types/workspace-api'
import styles from './NewCaseDialog.module.css'

/**
 * Start a case by hand — the entry point cases were missing.
 *
 * Cases used to be born ONLY from an agent hand-off (or the application flow),
 * so a person could never begin a thread of their own work. This is the shared
 * create surface behind every manual starting point (the cockpit's "New case",
 * the file panel's "Start a case from this file"). It is deliberately tiny: a
 * title, one line of description (the "what is this, and why" the case model
 * leans on), and an optional first file — everything else the case grows on its
 * own as work happens.
 */
export function NewCaseDialog({
  onClose,
  onCreated,
  /** Pre-filled title (e.g. a file's name), when started from something. */
  initialTitle = '',
  /** A file to attach as the case's first artifact, when started from a file. */
  attachFile,
}: {
  onClose: () => void
  onCreated: (c: WorkCase) => void
  initialTitle?: string
  attachFile?: string
}): JSX.Element {
  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => { titleRef.current?.focus() }, [])

  const create = useCallback(async () => {
    const t = title.trim()
    if (!t || busy) return
    setBusy(true)
    setError(null)
    try {
      const c = await window.workspace.cases.create({
        title: t,
        type: 'task', // a hand-started case is generic work, not an application
        description: description.trim(),
        ...(attachFile ? { artifacts: [attachFile] } : {}),
      })
      onCreated(c)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }, [title, description, attachFile, busy, onCreated])

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <span className={styles.title}><FolderPlus size={15} /> Start a case</span>
          <button className={styles.close} onClick={onClose} title="Close"><X size={16} /></button>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>What is it?</span>
          <input
            ref={titleRef}
            className={styles.input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void create(); if (e.key === 'Escape') onClose() }}
            placeholder="e.g. Steuer 2025"
            disabled={busy}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>One line — what this is and why it matters</span>
          <input
            className={styles.input}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void create(); if (e.key === 'Escape') onClose() }}
            placeholder="so it still means something in six weeks"
            disabled={busy}
          />
        </label>

        {attachFile && (
          <div className={styles.attach}><FileText size={12} /> {attachFile.split('/').pop()}</div>
        )}

        {error && <div className={styles.error}>Couldn’t start the case — {error}</div>}

        <div className={styles.actions}>
          <button className={styles.ghost} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={styles.primary} onClick={() => void create()} disabled={busy || !title.trim()}>
            {busy ? <Loader2 size={13} className={styles.spin} /> : <FolderPlus size={13} />} Start case
          </button>
        </div>
      </div>
    </div>
  )
}
