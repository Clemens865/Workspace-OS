import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, PanelBottom, PanelRight, SquareTerminal, X } from 'lucide-react'
import { BackdropContext, useGlass } from '../Landscape/backdrop/useBackdrop'
import { moveRect, resizeRect, snapZone, type Handle, type Rect } from './floatModel'
import styles from './FloatingTerminal.module.css'

const HANDLES: Handle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

interface Props {
  rect: Rect
  minimized: boolean
  /** Live while dragging; `done` once the pointer is released (then persist). */
  onRect: (r: Rect, done: boolean) => void
  onDock: (place: 'right' | 'bottom') => void
  onMinimize: (min: boolean) => void
  onClose: () => void
  /** The element the terminal itself is moved into (it is never remounted). */
  bodyRef: (el: HTMLDivElement | null) => void
}

const viewport = (): { w: number; h: number } => ({ w: window.innerWidth, h: window.innerHeight })

/**
 * The terminal as a floating window (docs/landscape: the terminal overlay):
 * drag the title bar to move it anywhere, drag any edge or corner to resize,
 * drop it on the right or bottom edge to dock it there. Over the landscape its
 * rim is Liquid Glass; over the stage (documents, the browser) the rim is a
 * frosted CSS edge, because glass must never sit over a live page.
 *
 * Positioned with left/top, never a transform: xterm maps the pointer through
 * its own rectangle.
 */
export function FloatingTerminal({ rect, minimized, onRect, onDock, onMinimize, onClose, bodyRef }: Props): JSX.Element {
  const frame = useRef<HTMLDivElement>(null)
  const [snap, setSnap] = useState<'right' | 'bottom' | null>(null)
  const [moving, setMoving] = useState(false)
  useGlass(frame, { radius: 18, bezel: 12, thickness: 22, frost: 0.12 })
  // The glass is drawn behind the window: keep it following while it moves or resizes.
  const backdrop = useContext(BackdropContext)
  useEffect(() => {
    backdrop?.followGlass(400)
  }, [backdrop, rect.x, rect.y, rect.w, rect.h, minimized])

  const drag = useCallback(
    (e: React.PointerEvent, kind: 'move' | Handle) => {
      if (e.button !== 0) return
      // A button inside the title bar is a button, not a grip.
      if (kind === 'move' && (e.target as HTMLElement).closest('button')) return
      e.preventDefault()
      const start = rect
      const sx = e.clientX
      const sy = e.clientY
      let last = start
      let zone: 'right' | 'bottom' | null = null
      setMoving(true)
      const onMove = (ev: PointerEvent): void => {
        const v = viewport()
        last = kind === 'move' ? moveRect(start, ev.clientX - sx, ev.clientY - sy, v) : resizeRect(start, kind, ev.clientX - sx, ev.clientY - sy, v)
        zone = kind === 'move' ? snapZone(ev.clientX, ev.clientY, v) : null
        setSnap(zone)
        onRect(last, false)
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        setMoving(false)
        setSnap(null)
        if (zone) onDock(zone)
        else onRect(last, true)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [rect, onRect, onDock],
  )

  return (
    <>
      {snap && <div className={styles.snap} data-zone={snap} data-testid="terminal-snap" aria-hidden />}
      <div
        ref={frame}
        className={`${styles.frame} ${moving ? styles.moving : ''} ${minimized ? styles.min : ''}`}
        style={{ left: rect.x, top: rect.y, width: rect.w, height: minimized ? undefined : rect.h }}
        data-testid="terminal-float"
        role="dialog"
        aria-label="Terminal"
      >
        <div className={styles.bar} onPointerDown={(e) => drag(e, 'move')} data-testid="terminal-float-bar">
          <SquareTerminal size={14} className={styles.icon} />
          <span className={styles.name}>Terminal</span>
          <span className={styles.flex} />
          <button type="button" className={styles.btn} onClick={() => onMinimize(!minimized)} title={minimized ? 'Restore' : 'Minimise'} aria-label={minimized ? 'Restore' : 'Minimise'}>
            {minimized ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button type="button" className={styles.btn} onClick={() => onDock('right')} title="Dock on the right" aria-label="Dock on the right" data-testid="terminal-dock-right">
            <PanelRight size={14} />
          </button>
          <button type="button" className={styles.btn} onClick={() => onDock('bottom')} title="Dock at the bottom" aria-label="Dock at the bottom" data-testid="terminal-dock-bottom">
            <PanelBottom size={14} />
          </button>
          <button type="button" className={styles.btn} onClick={onClose} title="Hide (⌘J)" aria-label="Hide the terminal">
            <X size={14} />
          </button>
        </div>
        <div ref={bodyRef} className={styles.body} data-testid="terminal-float-body" />
        {!minimized && HANDLES.map((h) => <span key={h} className={styles.handle} data-handle={h} onPointerDown={(e) => drag(e, h)} aria-hidden />)}
      </div>
    </>
  )
}
