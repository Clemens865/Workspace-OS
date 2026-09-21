import { useEffect, useRef, useState } from 'react'
import styles from './BordersDialog.module.css'

/** Page margins in 1/100 mm (the LibreOffice page-style unit): [top, bottom, left, right]. */
export type MarginSpec = { top: number; bottom: number; left: number; right: number }

interface MarginsDialogProps {
  onApply: (spec: MarginSpec) => void
  onCancel: () => void
}

// Word's standard presets, in 1/100 mm (1 inch = 2540; 0.75" = 1905; 0.5" = 1270).
const PRESETS: { id: string; label: string; spec: MarginSpec }[] = [
  { id: 'normal', label: 'Normal (2.54 cm)', spec: { top: 2540, bottom: 2540, left: 2540, right: 2540 } },
  { id: 'narrow', label: 'Narrow (1.27 cm)', spec: { top: 1270, bottom: 1270, left: 1270, right: 1270 } },
  { id: 'moderate', label: 'Moderate', spec: { top: 2540, bottom: 2540, left: 1905, right: 1905 } },
  { id: 'wide', label: 'Wide', spec: { top: 2540, bottom: 2540, left: 5080, right: 5080 } },
]

/** mm ↔ 1/100 mm helpers (the dialog shows mm; the engine wants 1/100 mm). */
const toMm = (v: number): number => Math.round(v / 100)
const fromMm = (v: number): number => Math.round(v * 100)

/** Page-margins picker — sets the Writer page style's four margins via the model bridge. */
export function MarginsDialog({ onApply, onCancel }: MarginsDialogProps): JSX.Element {
  const [spec, setSpec] = useState<MarginSpec>(PRESETS[0].spec)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    modalRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const side = (key: keyof MarginSpec) => (
    <label className={styles.opt}>
      <span>{key[0].toUpperCase() + key.slice(1)}</span>
      <input
        type="number" min={0} step={1} value={toMm(spec[key])}
        style={{ width: 64 }}
        onChange={(e) => setSpec((s) => ({ ...s, [key]: fromMm(Math.max(0, Number(e.target.value) || 0)) }))}
      /> mm
    </label>
  )

  return (
    <div className={styles.backdrop} onMouseDown={onCancel}>
      <div className={styles.modal} ref={modalRef} tabIndex={-1} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Page Margins</span>
          <button className={styles.close} onClick={onCancel} aria-label="Close">×</button>
        </div>

        <div className={styles.grid}>
          {PRESETS.map((p) => (
            <button key={p.id} className={styles.preset} onClick={() => setSpec(p.spec)} title={p.label}>
              <span>{p.label}</span>
            </button>
          ))}
        </div>

        <div className={styles.options}>
          {side('top')}
          {side('bottom')}
          {side('left')}
          {side('right')}
        </div>

        <div className={styles.footer}>
          <span className={styles.hint}>Applies to the whole document.</span>
          <button className={styles.btnGhost} onClick={onCancel}>Cancel</button>
          <button className={styles.btnGhost} onClick={() => onApply(spec)}>Apply</button>
        </div>
      </div>
    </div>
  )
}
