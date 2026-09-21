import { useEffect, useRef, useState } from 'react'
import styles from './FormatCellsDialog.module.css'

/** A data-validation rule kind and its macro token. */
interface ValKind {
  id: string
  label: string
}

const VAL_KINDS: ValKind[] = [
  { id: 'list', label: 'List (dropdown)' },
  { id: 'whole', label: 'Whole number (between)' },
  { id: 'decimal', label: 'Decimal (between)' },
  { id: 'textlen', label: 'Text length (max)' },
]

/** The applied validation: macro kind token plus its formula arg(s). For `list`,
 *  arg1 is the comma-separated value list; for whole/decimal arg1=min, arg2=max;
 *  for textlen arg1=max length. */
export interface DataValidationSpec {
  kind: string
  arg1: string
  arg2: string
}

interface DataValidationDialogProps {
  onApply: (spec: DataValidationSpec) => void
  onClear: () => void
  onCancel: () => void
}

/** Native Data Validation dialog for Calc — a dropdown LIST, a whole/decimal
 *  between range, or a text-length limit, applied to the selected cell range.
 *  Persists to the .xlsx as <dataValidations><dataValidation>. */
export function DataValidationDialog({ onApply, onClear, onCancel }: DataValidationDialogProps): JSX.Element {
  const [kind, setKind] = useState('list')
  const [listValues, setListValues] = useState('Yes, No, Maybe')
  const [minVal, setMinVal] = useState('0')
  const [maxVal, setMaxVal] = useState('100')
  const [maxLen, setMaxLen] = useState('50')
  const modalRef = useRef<HTMLDivElement>(null)

  const apply = (): void => {
    if (kind === 'list') onApply({ kind, arg1: listValues.trim(), arg2: '' })
    else if (kind === 'whole' || kind === 'decimal') onApply({ kind, arg1: minVal.trim(), arg2: maxVal.trim() })
    else onApply({ kind, arg1: maxLen.trim(), arg2: '' })
  }

  useEffect(() => {
    modalRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
      else if (e.key === 'Enter') { e.preventDefault(); apply() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, listValues, minVal, maxVal, maxLen])

  return (
    <div className={styles.backdrop} onMouseDown={onCancel}>
      <div className={styles.modal} ref={modalRef} tabIndex={-1} onMouseDown={(e) => e.stopPropagation()} style={{ width: 420 }}>
        <div className={styles.header}>
          <span className={styles.title}>Data validation</span>
          <button className={styles.close} onClick={onCancel} aria-label="Close">×</button>
        </div>

        <div className={styles.options} style={{ marginBottom: 18 }}>
          <label className={styles.row}>
            <span>Allow</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              style={{ padding: '7px 9px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13 }}
            >
              {VAL_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </label>

          {kind === 'list' && (
            <label className={styles.row} style={{ alignItems: 'flex-start' }}>
              <span>Values (comma-separated)</span>
              <textarea
                value={listValues}
                onChange={(e) => setListValues(e.target.value)}
                rows={3}
                style={{ flex: 1, padding: '7px 9px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }}
              />
            </label>
          )}

          {(kind === 'whole' || kind === 'decimal') && (
            <>
              <label className={styles.row}>
                <span>Minimum</span>
                <input type="text" inputMode="decimal" value={minVal} onChange={(e) => setMinVal(e.target.value)} />
              </label>
              <label className={styles.row}>
                <span>Maximum</span>
                <input type="text" inputMode="decimal" value={maxVal} onChange={(e) => setMaxVal(e.target.value)} />
              </label>
            </>
          )}

          {kind === 'textlen' && (
            <label className={styles.row}>
              <span>Maximum length</span>
              <input type="text" inputMode="numeric" value={maxLen} onChange={(e) => setMaxLen(e.target.value)} />
            </label>
          )}
        </div>

        <div className={styles.actions} style={{ justifyContent: 'space-between' }}>
          <button className={styles.btnGhost} onClick={onClear} title="Remove data validation from the selected cells">Clear validation</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={styles.btnGhost} onClick={onCancel}>Cancel</button>
            <button className={styles.btnPrimary} onClick={apply}>Apply</button>
          </div>
        </div>
      </div>
    </div>
  )
}
