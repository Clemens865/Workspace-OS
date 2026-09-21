import { useEffect, useRef, useState } from 'react'
import styles from './FormatCellsDialog.module.css'

/** A conditional-format rule type and the macro `op` token it maps to. */
interface RuleType {
  id: string
  label: string
  /** How many value inputs the rule needs (1 = single threshold, 2 = between). */
  values: 1 | 2
}

const RULE_TYPES: RuleType[] = [
  { id: 'gt', label: 'Greater than', values: 1 },
  { id: 'lt', label: 'Less than', values: 1 },
  { id: 'geq', label: 'Greater or equal', values: 1 },
  { id: 'leq', label: 'Less or equal', values: 1 },
  { id: 'eq', label: 'Equal to', values: 1 },
  { id: 'between', label: 'Between', values: 2 },
]

/** The applied rule: the macro op token, its formula value(s) and fill color. */
export interface CondFormatSpec {
  op: string
  value1: string
  value2: string
  /** Fill color as a LibreOffice decimal RGB Long (R*65536 + G*256 + B). */
  colorLong: number
}

interface CondFormatDialogProps {
  onApply: (spec: CondFormatSpec) => void
  onClear: () => void
  onCancel: () => void
}

/** #rrggbb → LibreOffice decimal RGB Long. */
function hexToLong(hex: string): number {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16) || 0
  const g = parseInt(h.slice(2, 4), 16) || 0
  const b = parseInt(h.slice(4, 6), 16) || 0
  return r * 65536 + g * 256 + b
}

/** Native Conditional Formatting dialog for Calc — an operator rule (greater /
 *  less / equal / between …) plus a fill color, applied to the selected range. */
export function CondFormatDialog({ onApply, onClear, onCancel }: CondFormatDialogProps): JSX.Element {
  const [ruleId, setRuleId] = useState('gt')
  const [value1, setValue1] = useState('0')
  const [value2, setValue2] = useState('100')
  const [color, setColor] = useState('#ffeb9c')
  const modalRef = useRef<HTMLDivElement>(null)
  const rule = RULE_TYPES.find((r) => r.id === ruleId) ?? RULE_TYPES[0]

  const apply = (): void => {
    onApply({ op: ruleId, value1: value1.trim(), value2: value2.trim(), colorLong: hexToLong(color) })
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
  }, [ruleId, value1, value2, color])

  return (
    <div className={styles.backdrop} onMouseDown={onCancel}>
      <div className={styles.modal} ref={modalRef} tabIndex={-1} onMouseDown={(e) => e.stopPropagation()} style={{ width: 380 }}>
        <div className={styles.header}>
          <span className={styles.title}>Conditional formatting</span>
          <button className={styles.close} onClick={onCancel} aria-label="Close">×</button>
        </div>

        <div className={styles.options} style={{ marginBottom: 18 }}>
          <label className={styles.row}>
            <span>Format cells where value is</span>
            <select
              value={ruleId}
              onChange={(e) => setRuleId(e.target.value)}
              style={{ padding: '7px 9px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13 }}
            >
              {RULE_TYPES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>

          <label className={styles.row}>
            <span>{rule.values === 2 ? 'Lower value' : 'Value'}</span>
            <input type="text" inputMode="decimal" value={value1} onChange={(e) => setValue1(e.target.value)} />
          </label>

          {rule.values === 2 && (
            <label className={styles.row}>
              <span>Upper value</span>
              <input type="text" inputMode="decimal" value={value2} onChange={(e) => setValue2(e.target.value)} />
            </label>
          )}

          <label className={styles.row}>
            <span>Fill color</span>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 44, height: 30, padding: 2, border: '1px solid var(--color-border)', borderRadius: 7, background: 'var(--color-surface)' }} />
          </label>
        </div>

        <div className={styles.actions} style={{ justifyContent: 'space-between' }}>
          <button className={styles.btnGhost} onClick={onClear} title="Remove all conditional formatting rules from the selected cells">Clear rules from selection</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={styles.btnGhost} onClick={onCancel}>Cancel</button>
            <button className={styles.btnPrimary} onClick={apply}>Apply</button>
          </div>
        </div>
      </div>
    </div>
  )
}
