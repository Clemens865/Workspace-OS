import { useRef } from 'react'
import { menuGroups } from './landscapeModel'
import type { RailId } from '../Shell/shellModel'
import { useGlass } from './backdrop/useBackdrop'
import styles from './LandscapeShell.module.css'

function MenuItem({ rail, label, hint, onOpen }: { rail: RailId; label: string; hint: string; onOpen: (r: RailId) => void }): JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  useGlass(ref, { radius: 18, bezel: 14, thickness: 28, frost: 0.3 })
  return (
    <button ref={ref} type="button" className={styles.menuItem} onClick={() => onOpen(rail)} data-menu={rail}>
      <span className={styles.menuLabel}>{label}</span>
      <span className={styles.menuHint}>{hint}</span>
    </button>
  )
}

/**
 * The Menu: every surface of the workspace, one click away. Opening an item
 * brings the flat stage forward with that surface (two actions from anywhere:
 * Menu → item, the phase 1 parity rule).
 */
export function LandscapeMenu({ onOpen }: { onOpen: (rail: RailId) => void }): JSX.Element {
  return (
    <div className={styles.menu} data-testid="landscape-menu-view">
      {menuGroups().map((g) => (
        <section key={g.title} className={styles.menuGroup}>
          <h2 className={styles.menuGroupTitle}>{g.title}</h2>
          {g.items.map((i) => (
            <MenuItem key={i.rail} rail={i.rail} label={i.label} hint={i.hint} onOpen={onOpen} />
          ))}
        </section>
      ))}
    </div>
  )
}
