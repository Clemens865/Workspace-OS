import { useEffect, useState } from 'react'
import { parseUnifiedDiff, diffStats, type DiffFile } from '../../lib/diff'
import type { DiffStat } from './reviewModel'
import styles from './FeedCard.module.css'

interface DiffInlineProps {
  /** Checkpoint to diff the workspace against (the run's pre-run snapshot). */
  checkpointId: string
  /** Bubbles the computed stat up to the card so Glance can show "N files · +/−". */
  onStat?: (stat: DiffStat) => void
}

/**
 * Renders `checkpoint:diff` as a colored unified diff INLINE inside a card's
 * Draft tier — the ContextHub "never a separate page; it unfolds within the
 * card" rule. Reuses the shared unified-diff parser (lib/diff.ts); it does not
 * re-implement it.
 */
export function DiffInline({ checkpointId, onStat }: DiffInlineProps): JSX.Element {
  const [files, setFiles] = useState<DiffFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    window.workspace.checkpoint
      .diff(checkpointId)
      .then((d) => {
        if (stale) return
        const parsed = parseUnifiedDiff(d)
        setFiles(parsed)
        onStat?.(diffStats(parsed))
      })
      .catch((e: Error) => { if (!stale) setError(e.message) })
    return () => { stale = true }
    // onStat identity is stable enough; re-fetch only when the target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkpointId])

  if (error) return <div className={styles.diffState}>Couldn’t compute the diff: {error}</div>
  if (files === null) return <div className={styles.diffState}>Computing diff…</div>
  if (files.length === 0) return <div className={styles.diffState}>No file changes in this run.</div>

  return (
    <div className={styles.diffFiles}>
      {files.map((file) => (
        <div key={file.path} className={styles.diffFile}>
          <div className={styles.diffFileHeader}>
            <span className={styles.diffPath}>{file.path}</span>
            <span className={styles.diffFileStat}>
              <span className={styles.add}>+{file.adds}</span> <span className={styles.del}>−{file.dels}</span>
            </span>
          </div>
          {file.binary ? (
            <div className={styles.diffState}>Binary file changed</div>
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
      ))}
    </div>
  )
}
