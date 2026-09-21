import { useState } from 'react'
import type { Decision } from './mock'
import { CategoryLabel } from './CategoryLabel'
import { labelFor } from './cockpitModel'
import styles from './DecisionItem.module.css'

interface Props {
  d: Decision
  /** When acted on, the item VANISHES (parent removes it). */
  onResolve: (id: string) => void
}

/**
 * A NEEDS-YOU as a self-contained decision. The plain-language line + a
 * leaned-default primary (the SINGLE blue) + a quiet secondary + a ⌄ that
 * reveals detail on demand. Acting on it makes it vanish. This is the only
 * WARM, ELEVATED thing on the surface — visible weight = "needs you".
 */
export function DecisionItem({ d, onResolve }: Props): JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <div className={styles.item}>
      <div className={styles.top}>
        {d.category && <CategoryLabel label={labelFor(d.category)} />}
        <span className={styles.by}>{d.by}</span>
        {d.confidence && <span className={styles.conf}>{d.confidence}</span>}
        <button
          className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Hide detail' : 'Show detail'}
          aria-expanded={open}
        >
          ⌄
        </button>
      </div>

      <div className={styles.line}>{d.line}</div>

      {open && <div className={styles.detail}>{d.detail}</div>}

      <div className={styles.actions}>
        {/* The leaned default — the one blue decision action. */}
        <button className={styles.primary} onClick={() => onResolve(d.id)}>
          {d.primary}
        </button>
        {d.secondary.map((s) => (
          <button key={s} className={styles.secondary} onClick={() => onResolve(d.id)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
