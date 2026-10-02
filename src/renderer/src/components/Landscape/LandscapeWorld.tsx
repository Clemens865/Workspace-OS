import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Carousel } from './carousel'
import { STAGE_H, STAGE_W, overviewLayout, focusLayout, awayLayout, stageScale, transformOf, type Layout } from './layoutModel'
import type { AgentPresence } from './presenceTypes'
import { AgentScreen } from './AgentScreen'
import styles from './LandscapeWorld.module.css'

export type WorldMode = 'overview' | 'focus' | 'away'

/** The "Add agent" ghost stands at the end of the last row. */
export const ADD_ID = '__add'

interface Props {
  agents: AgentPresence[]
  front: string[]
  back: string[]
  mode: WorldMode
  focusId: string | null
  onOpen: (id: string) => void
  /** ←/→ while focused: the neighbouring agent in carousel order. */
  onStep: (id: string) => void
  /** Rendered inside the focused screen. */
  renderFocus: (a: AgentPresence) => JSX.Element
  onAdd: () => void
  reduced: boolean
}

/**
 * The 3D world: a 1600 × 900 design stage, letterboxed into the window, in
 * which the agent screens stand on a shallow arc. Placement comes from
 * layoutModel; scrolling from Carousel. Screens are DOM, never live surfaces
 * (PLAN.md §3): focusing one shows its summary, and opening the real work
 * hands off to the flat stage.
 */
export function LandscapeWorld({ agents, front, back, mode, focusId, onOpen, onStep, renderFocus, onAdd, reduced }: Props): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [cur, setCur] = useState(0)
  const [scrolling, setScrolling] = useState(false)
  const frontRef = useRef(front)
  frontRef.current = front

  const carousel = useMemo(
    () => new Carousel(() => frontRef.current.length, (c, moving) => { setCur(c); setScrolling(moving) }, reduced),
    [reduced],
  )
  useEffect(() => () => carousel.dispose(), [carousel])
  useEffect(() => carousel.refit(), [carousel, front.length])

  useLayoutEffect(() => {
    const fit = (): void => setScale(stageScale(window.innerWidth, window.innerHeight))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  const all = useMemo(() => [...front, ...back], [front, back])
  const layout: Layout = useMemo(() => {
    if (mode === 'focus' && focusId) return focusLayout(back.includes(focusId) ? back : front, all, focusId)
    if (mode === 'away') return awayLayout(front, back, cur)
    return overviewLayout(front, back, cur, scrolling)
  }, [mode, focusId, front, back, all, cur, scrolling])

  // Wheel / trackpad on the overview; a horizontal swipe turns the ring when focused.
  const swipe = useRef({ acc: 0, lock: false, t: 0 })
  useEffect(() => {
    const el = host.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (mode === 'overview') {
        if (carousel.wheel(e)) e.preventDefault()
      } else if (mode === 'focus' && focusId && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
        e.preventDefault()
        const s = swipe.current
        s.acc += e.deltaX
        if (Math.abs(s.acc) > 90 && !s.lock) {
          stepFrom(focusId, Math.sign(s.acc))
          s.acc = 0
          s.lock = true
          window.setTimeout(() => (s.lock = false), 650)
        }
        window.clearTimeout(s.t)
        s.t = window.setTimeout(() => (s.acc = 0), 200)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const stepFrom = (id: string, dir: number): void => {
    const ring = back.includes(id) ? back : front
    const i = ring.indexOf(id)
    if (i < 0 || ring.length < 2) return
    onStep(ring[(i + dir + ring.length) % ring.length])
  }

  // Arrow keys: scroll the row, or turn the ring while focused. Digits open front screens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && !/^[1-9]$/.test(e.key)) return
      if (mode === 'overview') {
        if (/^[1-9]$/.test(e.key)) {
          const id = front[Number(e.key) - 1]
          if (id) onOpen(id)
          return
        }
        e.preventDefault()
        carousel.step(e.key === 'ArrowRight' ? 1 : -1)
      } else if (mode === 'focus' && focusId && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        stepFrom(focusId, e.key === 'ArrowRight' ? 1 : -1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Drag anywhere on the overview; a drag never counts as a click.
  const drag = useRef<{ x: number; t0: number; moved: boolean; v: number; lx: number; lt: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent): void => {
    if (mode !== 'overview' || e.button !== 0) return
    drag.current = { x: e.clientX, t0: carousel.target, moved: false, v: 0, lx: e.clientX, lt: performance.now() }
  }
  useEffect(() => {
    const move = (e: PointerEvent): void => {
      const d = drag.current
      if (!d) return
      const dx = e.clientX - d.x
      if (!d.moved && Math.abs(dx) > 6) d.moved = true
      if (!d.moved) return
      const now = performance.now()
      d.v = (e.clientX - d.lx) / scale / Math.max(1, now - d.lt)
      d.lx = e.clientX
      d.lt = now
      carousel.drag(d.t0, dx / scale)
    }
    const up = (): void => {
      const d = drag.current
      drag.current = null
      if (!d?.moved) return
      carousel.release(d.v)
      const swallow = (ev: Event): void => {
        ev.stopPropagation()
        ev.preventDefault()
      }
      window.addEventListener('click', swallow, { capture: true, once: true })
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 50)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [carousel, scale])

  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])

  return (
    <div ref={host} className={styles.host} onPointerDown={onPointerDown} data-testid="landscape-world" data-mode={mode}>
      <div
        className={styles.stage}
        style={{ width: STAGE_W, height: STAGE_H, transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        <div className={`${styles.world} ${scrolling ? styles.scrolling : ''}`}>
          {all.map((id, i) => {
            const a = byId.get(id)
            const p = layout[id]
            if (!p) return null
            if (id === ADD_ID) {
              return (
                <div
                  key={id}
                  className={styles.slot}
                  style={{ width: p.w, height: p.h, transform: transformOf(p), opacity: p.op, zIndex: Math.round(p.z + 1000), transitionDelay: `${p.delay}ms`, pointerEvents: p.op < 0.2 ? 'none' : undefined }}
                  data-front-index={front.indexOf(id)}
                >
                  <button type="button" className={styles.ghost} onClick={onAdd} data-testid="agent-add">
                    <span className={styles.ghostPlus}>+</span>
                    Add agent
                  </button>
                </div>
              )
            }
            if (!a) return null
            return (
              <div
                key={id}
                className={styles.slot}
                style={{
                  width: p.w,
                  height: p.h,
                  transform: transformOf(p),
                  opacity: p.op,
                  zIndex: p.zi ?? Math.round(p.z + 1000),
                  transitionDelay: `${p.delay}ms`,
                  pointerEvents: p.op < 0.2 ? 'none' : undefined,
                }}
                data-agent={id}
                data-front-index={front.indexOf(id)}
                data-i={i}
              >
                <AgentScreen
                  agent={a}
                  focused={mode === 'focus' && focusId === id}
                  side={!!p.side}
                  depth={p.glass}
                  onOpen={() => onOpen(id)}
                >
                  {mode === 'focus' && focusId === id ? renderFocus(a) : null}
                </AgentScreen>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
