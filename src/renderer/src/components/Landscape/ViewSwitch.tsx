import styles from './LandscapeShell.module.css'

/**
 * The header's segmented switch between the faces of one landscape view
 * (Team | Today, Waiting | History, Files | Notes | Memory).
 */
export function ViewSwitch<T extends string>({
  label,
  items,
  value,
  onChange,
  testid,
}: {
  label: string
  items: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
  testid: string
}): JSX.Element {
  return (
    <div className={styles.switch} role="tablist" aria-label={label} data-testid={testid}>
      {items.map((it) => (
        <button key={it.id} type="button" role="tab" aria-selected={value === it.id} className={value === it.id ? styles.switchOn : ''} onClick={() => onChange(it.id)} data-switch={it.id}>
          {it.label}
        </button>
      ))}
    </div>
  )
}
