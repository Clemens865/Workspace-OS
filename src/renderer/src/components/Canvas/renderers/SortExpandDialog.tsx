import { useEffect, useRef } from 'react'
import styles from './SortExpandDialog.module.css'

interface Props {
  /** 'asc' | 'desc' */
  direction: 'asc' | 'desc'
  /** The picked column letter(s), e.g. "B". */
  column: string
  /** The data block that would be sorted when expanding, e.g. "A1:C4". */
  region: string
  /** The selection as resolved (for tests / debugging). */
  selection?: string
  onExpand: () => void
  onCurrent: () => void
  onCancel: () => void
}

/**
 * Excel's "Sort Warning": the picked column sits inside a wider data block, so
 * ask whether the neighbouring columns should move with it (the usual intent)
 * or only the selected column should be sorted.
 */
export function SortExpandDialog({ direction, column, region, selection, onExpand, onCurrent, onCancel }: Props): JSX.Element {
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => { first.current?.focus() }, [])
  return (
    <div className={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" data-testid="sort-expand" data-selection={selection}>
        <div className={styles.title}>Sort {direction === 'asc' ? 'A → Z' : 'Z → A'} by column {column}</div>
        <p className={styles.text}>There is data next to your selection ({region}). Sorting only column {column} would separate its values from the rows they belong to.</p>
        <div className={styles.actions}>
          <button ref={first} className={styles.primary} data-testid="sort-expand-yes" onClick={onExpand}>Expand the selection</button>
          <button className={styles.secondary} data-testid="sort-expand-no" onClick={onCurrent}>Continue with the current selection</button>
          <button className={styles.secondary} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
