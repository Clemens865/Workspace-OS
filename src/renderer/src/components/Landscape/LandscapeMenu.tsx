import { menuGroups } from './landscapeModel'
import type { RailId } from '../Shell/shellModel'
import styles from './LandscapeShell.module.css'

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
            <button
              key={i.rail}
              type="button"
              className={styles.menuItem}
              onClick={() => onOpen(i.rail)}
              data-menu={i.rail}
            >
              <span className={styles.menuLabel}>{i.label}</span>
              <span className={styles.menuHint}>{i.hint}</span>
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}
