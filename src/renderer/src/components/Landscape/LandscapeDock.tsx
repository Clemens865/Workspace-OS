import { useLayoutEffect, useRef, useState } from 'react'
import { BookOpen, FolderOpen, Home, Inbox, MoreHorizontal, SquareTerminal } from 'lucide-react'
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
  /** Items waiting in the Inbox (the badge). */
  waiting?: number
  /**
   * Where the dock sits. 'float' is the glass dock at the bottom of the
   * landscape; 'bar' is the same dock in the stage's top bar, compact and
   * without glass (it sits above documents and the browser). One component,
   * so the two can never drift apart.
   */
  variant?: 'float' | 'bar'
  /** The terminal, the dock's sixth item: is it open, and the toggle. */
  terminalOpen?: boolean
  onTerminal?: () => void
}

/**
 * The dock: Overview · Inbox · Cases · Library · Menu, and the Terminal. The
 * same dock everywhere; in the landscape a white pill glides to the active
 * item (prototype: moveDockGlow).
 */
export function LandscapeDock({ active, onSelect, waiting = 0, variant = 'float', terminalOpen = false, onTerminal }: Props): JSX.Element {
  const nav = useRef<HTMLElement>(null)
  const [glow, setGlow] = useState<{ left: number; width: number } | null>(null)
  const bar = variant === 'bar'
  useGlass(nav, bar ? null : { radius: 32, bezel: 26, thickness: 46, frost: 0.1 })
  // Test hooks differ by place, so a test can tell which dock it is driving.
  const hook = (id: string): Record<string, string> =>
    bar ? { 'data-stage-dock': id, ...(id === 'overview' ? { 'data-testid': 'stage-landscape' } : {}) } : { 'data-dock': id }

  useLayoutEffect(() => {
    const btn = active ? nav.current?.querySelector<HTMLElement>(bar ? `[data-stage-dock="${active}"]` : `[data-dock="${active}"]`) : null
    setGlow(btn ? { left: btn.offsetLeft, width: btn.offsetWidth } : null)
  }, [active, bar])

  return (
    <nav ref={nav} className={bar ? styles.dockInline : styles.dock} aria-label="Landscape" data-testid={bar ? 'stage-nav' : 'landscape-dock'}>
      <span className={styles.dockGlow} style={glow ? { left: glow.left, width: glow.width } : { opacity: 0 }} aria-hidden />
      {DOCK.map((d) => {
        const Icon = ICONS[d.id]
        return (
          <button
            key={d.id}
            type="button"
            {...hook(d.id)}
            className={`${styles.dockItem} ${active === d.id ? styles.on : ''}`}
            aria-current={active === d.id ? 'page' : undefined}
            onClick={() => onSelect(d.id)}
          >
            <Icon size={bar ? 14 : 17} /> {d.label}
            {d.id === 'inbox' && waiting > 0 && (
              <span className={styles.badge} data-testid={bar ? undefined : 'inbox-badge'}>
                {waiting}
              </span>
            )}
          </button>
        )
      })}
      {onTerminal && (
        <>
          <span className={styles.dockSep} aria-hidden />
          <button
            type="button"
            {...hook('terminal')}
            className={`${styles.dockItem} ${terminalOpen ? styles.termOn : ''}`}
            aria-pressed={terminalOpen}
            onClick={onTerminal}
            title="Terminal (⌘J)"
          >
            <SquareTerminal size={bar ? 14 : 17} /> Terminal
          </button>
        </>
      )}
    </nav>
  )
}
