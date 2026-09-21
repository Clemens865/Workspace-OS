import type { CockpitLabel } from './cockpitModel'
import styles from './CategoryLabel.module.css'

/**
 * A categorical LABEL — the "A+D blend": a hairline-outlined chip carrying a 5px
 * category-colored dot + HUMAN sentence-case wording ("To review", "Failed") that
 * tells the human WHAT a needs-you item is asking for, and lets the list group by
 * it. Quiet micro-type, one accent per category, all from --wos-* so it stays
 * on-brand in light. The blue stays reserved for the single primary action —
 * this label never competes with it.
 */
export function CategoryLabel({ label }: { label: CockpitLabel }): JSX.Element {
  return (
    <span
      className={styles.tag}
      data-category={label.category}
      title={label.text}
    >
      <span className={styles.dot} aria-hidden />
      {label.text}
    </span>
  )
}
