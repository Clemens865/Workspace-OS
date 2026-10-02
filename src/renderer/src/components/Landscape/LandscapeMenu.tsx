import { useRef } from 'react'
import { MENU_EXTRAS, menuGroups, type MenuExtraId } from './landscapeModel'
import type { RailId } from '../Shell/shellModel'
import { useGlass } from './backdrop/useBackdrop'
import styles from './LandscapeShell.module.css'

function MenuItem({ label, hint, onClick, data }: { label: string; hint: string; onClick: () => void; data: Record<string, string> }): JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  useGlass(ref, { radius: 18, bezel: 14, thickness: 28, frost: 0.3 })
  return (
    <button ref={ref} type="button" className={styles.menuItem} onClick={onClick} {...data}>
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
export function LandscapeMenu({ onOpen, onExtra }: { onOpen: (rail: RailId) => void; onExtra: (id: MenuExtraId) => void }): JSX.Element {
  return (
    <div className={styles.menu} data-testid="landscape-menu-view">
      {menuGroups().map((g) => (
        <section key={g.title} className={styles.menuGroup}>
          <h2 className={styles.menuGroupTitle}>{g.title}</h2>
          {g.items.map((i) => (
            <MenuItem key={i.rail} label={i.label} hint={i.hint} onClick={() => onOpen(i.rail)} data={{ 'data-menu': i.rail }} />
          ))}
          {MENU_EXTRAS.filter((e) => e.group === g.title).map((e) => (
            <MenuItem key={e.id} label={e.label} hint={e.hint} onClick={() => onExtra(e.id)} data={{ 'data-menu-extra': e.id }} />
          ))}
        </section>
      ))}
    </div>
  )
}
