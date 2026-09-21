import { useCallback, useState } from 'react'
import styles from './PdfPageOps.module.css'

interface Props {
  filePath: string
  pageCount: number
  onClose: () => void
  onChanged: () => void
}

/**
 * Page operations: reorder, delete, rotate.
 *
 * These REWRITE the PDF, unlike annotation which stays in a sidecar — so the
 * panel says so plainly and the main process trashes the previous version first,
 * making every operation undoable from the Files panel. A page tool without undo
 * is how someone loses the only copy of a signed contract.
 */
export function PdfPageOps({ filePath, pageCount, onClose, onChanged }: Props): JSX.Element {
  const [order, setOrder] = useState<number[]>(() => Array.from({ length: pageCount }, (_, i) => i + 1))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const move = (from: number, dir: -1 | 1): void => {
    const to = from + dir
    if (to < 0 || to >= order.length) return
    const next = [...order]
    ;[next[from], next[to]] = [next[to], next[from]]
    setOrder(next)
  }

  const drop = (index: number): void => setOrder(order.filter((_, i) => i !== index))

  const apply = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      await window.workspace.pdf.reorderPages(filePath, order)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [filePath, order, onChanged])

  const rotate = useCallback(async (page: number, delta: number) => {
    setBusy(true); setError(null)
    try {
      await window.workspace.pdf.rotatePage(filePath, page, delta)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [filePath, onChanged])

  const changed = order.length !== pageCount || order.some((p, i) => p !== i + 1)

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <h3 className={styles.title}>Pages</h3>
        <span className={styles.warn}>Changes rewrite the file — the previous version goes to Trash</span>
        <button className={styles.close} onClick={onClose}>×</button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <ul className={styles.list}>
        {order.map((page, i) => (
          <li key={`${page}-${i}`} className={styles.item}>
            <span className={styles.num}>Page {page}</span>
            <button className={styles.mini} disabled={busy || i === 0} onClick={() => move(i, -1)} title="Move up">↑</button>
            <button className={styles.mini} disabled={busy || i === order.length - 1} onClick={() => move(i, 1)} title="Move down">↓</button>
            <button className={styles.mini} disabled={busy} onClick={() => void rotate(page, 90)} title="Rotate right">⟳</button>
            <button className={styles.mini} disabled={busy} onClick={() => void rotate(page, -90)} title="Rotate left">⟲</button>
            <button className={styles.remove} disabled={busy || order.length === 1} onClick={() => drop(i)} title="Remove page">×</button>
          </li>
        ))}
      </ul>

      <div className={styles.actions}>
        <button className={styles.secondary} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={styles.primary} onClick={() => void apply()} disabled={busy || !changed}>
          {busy ? 'Applying…' : 'Apply order'}
        </button>
      </div>
    </div>
  )
}
