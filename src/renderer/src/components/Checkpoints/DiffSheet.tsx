import { useState, useEffect } from 'react'
import { parseUnifiedDiff, diffStats, type DiffFile } from '../../lib/diff'
import styles from './DiffSheet.module.css'

interface DiffSheetProps {
  /** Checkpoint to diff the current workspace against. */
  checkpointId: string
  /** Heading context, e.g. the checkpoint label or "last agent run". */
  title: string
  onClose: () => void
  /** When present, shows the revert button — "preview before rollback". */
  onRevert?: () => void | Promise<void>
}

/**
 * DiffSheet — renders `checkpoint:diff` as a colored unified diff so reverts
 * are never blind: what the agent changed, line by line, before rolling back.
 */
export function DiffSheet({ checkpointId, title, onClose, onRevert }: DiffSheetProps): JSX.Element {
  const [files, setFiles] = useState<DiffFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reverting, setReverting] = useState(false)

  useEffect(() => {
    let stale = false
    window.workspace.checkpoint
      .diff(checkpointId)
      .then((d) => { if (!stale) setFiles(parseUnifiedDiff(d)) })
      .catch((e: Error) => { if (!stale) setError(e.message) })
    return () => { stale = true }
  }, [checkpointId])

  const stats = files ? diffStats(files) : null

  const handleRevert = async (): Promise<void> => {
    if (!onRevert || reverting) return
    setReverting(true)
    try {
      await onRevert()
      onClose()
    } finally {
      setReverting(false)
    }
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} data-testid="diff-sheet" onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.heading}>Changes since {title}</span>
          {stats && stats.files > 0 && (
            <span className={styles.stats}>
              {stats.files} file{stats.files === 1 ? '' : 's'}
              <span className={styles.statAdd}> +{stats.adds}</span>
              <span className={styles.statDel}> −{stats.dels}</span>
            </span>
          )}
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div className={styles.body}>
          {error ? (
            <div className={styles.state}>Couldn’t compute the diff: {error}</div>
          ) : files === null ? (
            <div className={styles.state}>Computing diff…</div>
          ) : files.length === 0 ? (
            <div className={styles.state}>No changes since this checkpoint.</div>
          ) : (
            files.map((file) => (
              <div key={file.path} className={styles.file}>
                <div className={styles.fileHeader}>
                  <span className={styles.filePath}>{file.path}</span>
                  <span className={styles.fileStats}>
                    <span className={styles.statAdd}>+{file.adds}</span>{' '}
                    <span className={styles.statDel}>−{file.dels}</span>
                  </span>
                </div>
                {file.binary ? (
                  <div className={styles.binary}>Binary file changed</div>
                ) : (
                  <pre className={styles.hunks}>
                    {file.lines.map((line, i) => (
                      <div key={i} className={`${styles.line} ${styles[line.kind]}`}>
                        <span className={styles.marker}>
                          {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
                        </span>
                        {line.text}
                      </div>
                    ))}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>

        <div className={styles.footer}>
          {onRevert && (
            <button
              className={styles.revertBtn}
              onClick={() => void handleRevert()}
              disabled={reverting || files === null}
              title="Restore every file to this checkpoint's state"
            >
              {reverting ? 'Reverting…' : '↩ Revert these changes'}
            </button>
          )}
          <button className={styles.keepBtn} onClick={onClose}>
            {onRevert ? 'Keep changes' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}
