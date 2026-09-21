import { useEffect, useRef, useState } from 'react'
import styles from './InsertTableDialog.module.css'

const MAX_COLS = 10
const MAX_ROWS = 8

interface InsertTableDialogProps {
  onConfirm: (cols: number, rows: number) => void
  onCancel: () => void
}

/**
 * Native, polished replacement for LibreOffice's stock Insert-Table dialog.
 * Office-style grid picker (hover/click to size) plus precise numeric entry;
 * the chosen size is applied via the parameterized `.uno:InsertTable` command
 * so the engine's own dialog never appears.
 */
export function InsertTableDialog({ onConfirm, onCancel }: InsertTableDialogProps): JSX.Element {
  const [cols, setCols] = useState(3)
  const [rows, setRows] = useState(3)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    modalRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
      else if (e.key === 'Enter') { e.preventDefault(); onConfirm(cols, rows) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cols, rows, onConfirm, onCancel])

  const clamp = (v: number, max: number): number => Math.max(1, Math.min(max, Math.round(v) || 1))

  return (
    <div className={styles.backdrop} onMouseDown={onCancel}>
      <div
        className={styles.modal}
        ref={modalRef}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={styles.title}>Insert table</span>
          <button className={styles.close} onClick={onCancel} aria-label="Close">×</button>
        </div>

        <div className={styles.grid}>
          {Array.from({ length: MAX_ROWS }).map((_, r) => (
            <div key={r} className={styles.gridRow}>
              {Array.from({ length: MAX_COLS }).map((_, c) => (
                <div
                  key={c}
                  className={c < cols && r < rows ? `${styles.cell} ${styles.cellOn}` : styles.cell}
                  onMouseEnter={() => { setCols(c + 1); setRows(r + 1) }}
                  onClick={() => onConfirm(c + 1, r + 1)}
                />
              ))}
            </div>
          ))}
        </div>

        <div className={styles.preview}>{cols} × {rows} table</div>

        <div className={styles.fields}>
          <label className={styles.field}>
            <span>Columns</span>
            <input
              type="number" min={1} max={63} value={cols}
              onChange={(e) => setCols(clamp(+e.target.value, 63))}
            />
          </label>
          <label className={styles.field}>
            <span>Rows</span>
            <input
              type="number" min={1} max={500} value={rows}
              onChange={(e) => setRows(clamp(+e.target.value, 500))}
            />
          </label>
        </div>

        <div className={styles.actions}>
          <button className={styles.btnGhost} onClick={onCancel}>Cancel</button>
          <button className={styles.btnPrimary} onClick={() => onConfirm(cols, rows)}>Insert</button>
        </div>
      </div>
    </div>
  )
}
