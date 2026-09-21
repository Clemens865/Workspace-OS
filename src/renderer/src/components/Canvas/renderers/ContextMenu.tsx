import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { placeMenu, type MenuItem } from './calcMenu'
import styles from './ContextMenu.module.css'

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onPick: (item: MenuItem) => void
  onClose: () => void
}

/**
 * A right-click menu that stays on screen and closes the way people expect.
 *
 * It measures itself before positioning: a menu opened near the right or bottom
 * edge must flip rather than run off the viewport, and the last column is
 * precisely where "insert column right" gets used.
 *
 * Dismissal covers every route out — Escape, a click anywhere outside, another
 * right-click, scrolling, or the window losing focus. A context menu that
 * survives one of those feels broken and blocks the document underneath.
 *
 * Submenus open on hover or → and stay open while the pointer crosses to them;
 * a short grace period keeps a diagonal move from snapping the child shut.
 * Arrow keys move the highlight, Enter picks, ← closes a submenu, Esc closes
 * all. Check marks come from the engine's own state, so a style or toggle
 * shows what is in force at the click point.
 */
export function ContextMenu({ x, y, items, onPick, onClose }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y, ready: false })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const p = placeMenu(x, y, { w: r.width, h: r.height }, { w: window.innerWidth, h: window.innerHeight })
    setPos({ ...p, ready: true })
  }, [x, y, items])

  useEffect(() => {
    const close = (): void => onClose()
    // A mousedown INSIDE the menu is a pick in progress, not a dismissal. The
    // capture-phase listener runs before React's own handlers, so the item's
    // stopPropagation cannot protect it — the menu would unmount on mousedown
    // and the click would land on nothing. Check the target here instead.
    const closeUnlessInside = (e: Event): void => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    // `capture` so the dismissal wins even if something underneath stops
    // propagation; `once`-style listeners would miss a second right-click.
    document.addEventListener('mousedown', closeUnlessInside, true)
    document.addEventListener('contextmenu', closeUnlessInside, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', closeUnlessInside, true)
      document.removeEventListener('contextmenu', closeUnlessInside, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      document.removeEventListener('scroll', close, true)
    }
  }, [onClose])

  const pick = useCallback((item: MenuItem) => { onPick(item); onClose() }, [onPick, onClose])

  return (
    <div
      ref={ref}
      className={styles.menu}
      data-testid="context-menu"
      style={{ left: pos.x, top: pos.y, visibility: pos.ready ? 'visible' : 'hidden' }}
      // The menu's own mousedown must not reach the dismissal listener above.
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      role="menu"
    >
      <MenuList items={items} onPick={pick} autoFocus={pos.ready} />
    </div>
  )
}

interface ListProps {
  items: MenuItem[]
  onPick: (item: MenuItem) => void
  /** Root list: takes keyboard focus on mount so arrows work at once. */
  autoFocus?: boolean
  /** Submenu: ← hands focus back to the parent row. */
  onBack?: () => void
}

function MenuList({ items, onPick, autoFocus, onBack }: ListProps): JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  /** Whether the open submenu should take focus (opened by keyboard) or not (hover). */
  const [openByKey, setOpenByKey] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const enabled = items.filter((i) => !i.separator && !i.disabled)

  const enter = (id: string, byKey = false): void => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    setOpen(id)
    setOpenByKey(byKey)
  }
  const leave = (): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(null), 160)
  }
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  const focusRow = useCallback((id: string) => { rowRefs.current.get(id)?.focus() }, [])
  useEffect(() => {
    if (autoFocus && enabled[0]) focusRow(enabled[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus])

  const onKeyDown = (e: React.KeyboardEvent, item: MenuItem): void => {
    const idx = enabled.findIndex((i) => i.id === item.id)
    const step = (d: number): void => {
      if (enabled.length === 0) return
      const next = enabled[(idx + d + enabled.length) % enabled.length]
      focusRow(next.id)
      if (open && open !== next.id) setOpen(null)
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); e.stopPropagation(); step(1); break
      case 'ArrowUp': e.preventDefault(); e.stopPropagation(); step(-1); break
      case 'Home': e.preventDefault(); e.stopPropagation(); if (enabled[0]) focusRow(enabled[0].id); break
      case 'End': e.preventDefault(); e.stopPropagation(); if (enabled.length) focusRow(enabled[enabled.length - 1].id); break
      case 'ArrowRight':
        e.preventDefault(); e.stopPropagation()
        if (item.children) enter(item.id, true)
        break
      case 'ArrowLeft':
        e.preventDefault(); e.stopPropagation()
        if (onBack) onBack()
        break
      case 'Enter':
      case ' ':
        e.preventDefault(); e.stopPropagation()
        if (item.children) enter(item.id, true)
        else if (!item.disabled) onPick(item)
        break
      default: break
    }
  }

  return (
    <>
      {items.map((item) => {
        if (item.separator) return <div key={item.id} className={styles.sep} role="separator" />
        if (item.children) {
          return (
            <div
              key={item.id}
              className={`${styles.parent} ${open === item.id ? styles.parentOpen : ''}`}
              onMouseEnter={() => enter(item.id)}
              onMouseLeave={leave}
            >
              <button
                ref={(el) => { if (el) rowRefs.current.set(item.id, el); else rowRefs.current.delete(item.id) }}
                className={styles.item} role="menuitem" aria-haspopup="menu" aria-expanded={open === item.id} data-id={item.id}
                onClick={() => enter(item.id, true)}
                onKeyDown={(e) => onKeyDown(e, item)}
              >
                <span className={styles.mark} />
                <span className={styles.label}>{item.label}</span>
                <span className={styles.chevron}>›</span>
              </button>
              {open === item.id && (
                <SubMenu items={item.children} onPick={onPick} autoFocus={openByKey} onBack={() => { setOpen(null); focusRow(item.id) }} />
              )}
            </div>
          )
        }
        return (
          <button
            key={item.id}
            ref={(el) => { if (el) rowRefs.current.set(item.id, el); else rowRefs.current.delete(item.id) }}
            className={styles.item}
            role={item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={item.checked}
            aria-disabled={item.disabled || undefined}
            disabled={item.disabled}
            data-id={item.id}
            onMouseEnter={() => { enter(''); if (!item.disabled) rowRefs.current.get(item.id)?.focus() }}
            onKeyDown={(e) => onKeyDown(e, item)}
            onClick={() => { if (!item.disabled) onPick(item) }}
          >
            <span className={styles.mark}>{item.checked ? '✓' : ''}</span>
            <span className={styles.label}>{item.label}</span>
            {item.shortcut && <span className={styles.shortcut}>{item.shortcut}</span>}
          </button>
        )
      })}
    </>
  )
}

/** A child list beside its parent row; flips to the left when the right edge is near. */
function SubMenu({ items, onPick, autoFocus, onBack }: ListProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [flip, setFlip] = useState({ left: false, up: 0, ready: false })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const left = r.right > window.innerWidth - 8
    const overflow = r.bottom - (window.innerHeight - 8)
    setFlip({ left, up: overflow > 0 ? overflow : 0, ready: true })
  }, [items])
  return (
    <div
      ref={ref}
      className={`${styles.submenu} ${flip.left ? styles.submenuLeft : ''}`}
      style={{ marginTop: -flip.up, visibility: flip.ready ? 'visible' : 'hidden' }}
      role="menu"
    >
      <MenuList items={items} onPick={onPick} autoFocus={!!autoFocus && flip.ready} onBack={onBack} />
    </div>
  )
}
