import { useLayoutEffect, useRef, useState } from 'react'
import { BookOpen, FolderOpen, Home, Inbox, MoreHorizontal } from 'lucide-react'
import { DOCK, type DockId } from './landscapeModel'
import { useGlass } from './backdrop/useBackdrop'
import styles from './LandscapeShell.module.css'

const ICONS: Record<DockId, typeof Home> = {
  overview: Home,
  inbox: Inbox,
  cases: FolderOpen,
  library: BookOpen,
  menu: MoreHorizontal,
}

interface Props {
  active: DockId | null
  onSelect: (id: DockId) => void
}

/** The glass dock. A white pill glides to the active item (prototype: moveDockGlow). */
export function LandscapeDock({ active, onSelect }: Props): JSX.Element {
  const nav = useRef<HTMLElement>(null)
  const [glow, setGlow] = useState<{ left: number; width: number } | null>(null)
  useGlass(nav, { radius: 32, bezel: 26, thickness: 46, frost: 0.1 })

  useLayoutEffect(() => {
    const btn = active ? nav.current?.querySelector<HTMLElement>(`[data-dock="${active}"]`) : null
    setGlow(btn ? { left: btn.offsetLeft, width: btn.offsetWidth } : null)
  }, [active])

  return (
    <nav ref={nav} className={styles.dock} aria-label="Landscape" data-testid="landscape-dock">
      <span
        className={styles.dockGlow}
        style={glow ? { left: glow.left, width: glow.width } : { opacity: 0 }}
        aria-hidden
      />
      {DOCK.map((d) => {
        const Icon = ICONS[d.id]
        return (
          <button
            key={d.id}
            type="button"
            data-dock={d.id}
            className={`${styles.dockItem} ${active === d.id ? styles.on : ''}`}
            aria-current={active === d.id ? 'page' : undefined}
            onClick={() => onSelect(d.id)}
          >
            <Icon size={17} /> {d.label}
          </button>
        )
      })}
    </nav>
  )
}
