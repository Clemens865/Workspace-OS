import { useEffect, useRef, useState } from 'react'
import {
  Square, SquareDashedBottom, Grid3x3, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, X,
} from 'lucide-react'
import styles from './BordersDialog.module.css'

export interface BorderSpec {
  preset: string
  color: number
  width: number
}

interface BordersDialogProps {
  onApply: (spec: BorderSpec) => void
  onCancel: () => void
}

const PRESETS: { id: string; label: string; icon: JSX.Element }[] = [
  { id: 'all', label: 'All', icon: <Grid3x3 size={17} strokeWidth={2} /> },
  { id: 'outer', label: 'Outside', icon: <Square size={17} strokeWidth={2} /> },
  { id: 'top', label: 'Top', icon: <ArrowUp size={17} strokeWidth={2} /> },
  { id: 'bottom', label: 'Bottom', icon: <ArrowDown size={17} strokeWidth={2} /> },
  { id: 'left', label: 'Left', icon: <ArrowLeft size={17} strokeWidth={2} /> },
  { id: 'right', label: 'Right', icon: <ArrowRight size={17} strokeWidth={2} /> },
  { id: 'inner', label: 'Inside', icon: <SquareDashedBottom size={17} strokeWidth={2} /> },
  { id: 'none', label: 'None', icon: <X size={17} strokeWidth={2} /> },
]

const WIDTHS: { label: string; value: number }[] = [
  { label: 'Hair', value: 7 },
  { label: 'Thin', value: 26 },
  { label: 'Medium', value: 53 },
  { label: 'Thick', value: 88 },
]

/** #rrggbb → LibreOffice long color. */
function hexToLong(hex: string): number {
  return parseInt(hex.slice(1), 16)
}

/** Native Borders picker — applies to the selection via the UNO model bridge. */
export function BordersDialog({ onApply, onCancel }: BordersDialogProps): JSX.Element {
  const [color, setColor] = useState('#000000')
  const [width, setWidth] = useState(26)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    modalRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const pick = (preset: string): void => {
    onApply({ preset, color: preset === 'none' ? 0 : hexToLong(color), width })
  }

  return (
    <div className={styles.backdrop} onMouseDown={onCancel}>
      <div className={styles.modal} ref={modalRef} tabIndex={-1} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Borders</span>
          <button className={styles.close} onClick={onCancel} aria-label="Close">×</button>
        </div>

        <div className={styles.options}>
          <label className={styles.opt}>
            <span>Color</span>
            <span className={styles.swatch} style={{ background: color }}>
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            </span>
          </label>
          <label className={styles.opt}>
            <span>Weight</span>
            <select value={width} onChange={(e) => setWidth(Number(e.target.value))}>
              {WIDTHS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
            </select>
          </label>
        </div>

        <div className={styles.grid}>
          {PRESETS.map((p) => (
            <button key={p.id} className={styles.preset} onClick={() => pick(p.id)} title={p.label}>
              {p.icon}
              <span>{p.label}</span>
            </button>
          ))}
        </div>

        <div className={styles.footer}>
          <span className={styles.hint}>Applies to the selected cells.</span>
          <button className={styles.btnGhost} onClick={onCancel}>Done</button>
        </div>
      </div>
    </div>
  )
}
