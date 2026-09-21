import { useEffect, useRef, useState } from 'react'
import styles from './FormatCellsDialog.module.css'

/** A number-format category and how it maps to LibreOffice UNO commands. */
interface Category {
  id: string
  label: string
  /** UNO command that applies the category (baseline = 2 decimals, grouped). */
  cmd: string
  /** Whether a decimal-places control applies. */
  decimals: boolean
  /** Whether a thousands-separator toggle applies. */
  thousands: boolean
}

const CATEGORIES: Category[] = [
  { id: 'general', label: 'General', cmd: '.uno:NumberFormatStandard', decimals: false, thousands: false },
  { id: 'number', label: 'Number', cmd: '.uno:NumberFormatDecimal', decimals: true, thousands: true },
  { id: 'currency', label: 'Currency', cmd: '.uno:NumberFormatCurrency', decimals: true, thousands: false },
  { id: 'percent', label: 'Percentage', cmd: '.uno:NumberFormatPercent', decimals: true, thousands: false },
  { id: 'date', label: 'Date', cmd: '.uno:NumberFormatDate', decimals: false, thousands: false },
  { id: 'time', label: 'Time', cmd: '.uno:NumberFormatTime', decimals: false, thousands: false },
  { id: 'scientific', label: 'Scientific', cmd: '.uno:NumberFormatScientific', decimals: false, thousands: false },
]

export interface NumberFormatSpec {
  cmd: string
  /** Target decimal places, or null when not applicable. */
  decimals: number | null
  /** True to strip the thousands separator the category applies by default. */
  removeThousands: boolean
}

interface FormatCellsDialogProps {
  onConfirm: (spec: NumberFormatSpec) => void
  onCancel: () => void
}

/** Client-side approximation of the chosen format, for the live sample line. */
function sample(catId: string, decimals: number, thousands: boolean): string {
  const v = 1234.567
  const dp = (n: number, d: number): string => n.toFixed(d)
  const group = (s: string): string => {
    const [int, frac] = s.split('.')
    const g = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return frac ? `${g}.${frac}` : g
  }
  switch (catId) {
    case 'general': return '1234.567'
    case 'number': { const s = dp(v, decimals); return thousands ? group(s) : s }
    case 'currency': return '$' + group(dp(v, decimals))
    case 'percent': return group(dp(v * 100, decimals)) + '%'
    case 'date': return '06/22/26'
    case 'time': return '01:23:45 PM'
    case 'scientific': return dp(v, decimals).replace(/^(\d)(\d*)\.?(\d*)$/, (_m, a, b, c) => `${a}.${(b + c).padEnd(decimals, '0').slice(0, decimals)}E+03`)
    default: return ''
  }
}

/** Native replacement for LibreOffice's Format Cells → Numbers tab. */
export function FormatCellsDialog({ onConfirm, onCancel }: FormatCellsDialogProps): JSX.Element {
  const [catId, setCatId] = useState('number')
  const [decimals, setDecimals] = useState(2)
  const [thousands, setThousands] = useState(true)
  const modalRef = useRef<HTMLDivElement>(null)
  const cat = CATEGORIES.find((c) => c.id === catId) ?? CATEGORIES[0]

  useEffect(() => {
    modalRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
      else if (e.key === 'Enter') { e.preventDefault(); confirm() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catId, decimals, thousands])

  const confirm = (): void => {
    onConfirm({
      cmd: cat.cmd,
      decimals: cat.decimals ? decimals : null,
      removeThousands: cat.thousands && !thousands,
    })
  }

  return (
    <div className={styles.backdrop} onMouseDown={onCancel}>
      <div className={styles.modal} ref={modalRef} tabIndex={-1} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Format cells</span>
          <button className={styles.close} onClick={onCancel} aria-label="Close">×</button>
        </div>

        <div className={styles.body}>
          <ul className={styles.cats}>
            {CATEGORIES.map((c) => (
              <li
                key={c.id}
                className={c.id === catId ? `${styles.cat} ${styles.catOn}` : styles.cat}
                onClick={() => setCatId(c.id)}
              >
                {c.label}
              </li>
            ))}
          </ul>

          <div className={styles.options}>
            <div className={styles.sampleBox}>
              <span className={styles.sampleLabel}>Sample</span>
              <span className={styles.sampleValue}>{sample(catId, decimals, thousands)}</span>
            </div>

            {cat.decimals && (
              <label className={styles.row}>
                <span>Decimal places</span>
                <input
                  type="number" min={0} max={10} value={decimals}
                  onChange={(e) => setDecimals(Math.max(0, Math.min(10, Math.round(+e.target.value) || 0)))}
                />
              </label>
            )}

            {cat.thousands && (
              <label className={styles.checkRow}>
                <input type="checkbox" checked={thousands} onChange={(e) => setThousands(e.target.checked)} />
                <span>Use 1000 separator</span>
              </label>
            )}

            {!cat.decimals && !cat.thousands && (
              <p className={styles.note}>{cat.label} format has no further options.</p>
            )}
          </div>
        </div>

        <div className={styles.actions}>
          <button className={styles.btnGhost} onClick={onCancel}>Cancel</button>
          <button className={styles.btnPrimary} onClick={confirm}>Apply</button>
        </div>
      </div>
    </div>
  )
}
