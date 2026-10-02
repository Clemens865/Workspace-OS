import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Carousel } from './carousel'
import { STAGE_H, STAGE_W, overviewLayout, focusLayout, awayLayout, stageScale, transformOf, type Layout } from './layoutModel'
import type { AgentPresence } from './presenceTypes'
import { AgentScreen } from './AgentScreen'
import { BackdropContext } from './backdrop/useBackdrop'
import type { SheetFootprint } from './backdrop/Backdrop'
import styles from './LandscapeWorld.module.css'

export type WorldMode = 'overview' | 'focus' | 'away'

/** The "Add agent" ghost stands at the end of the last row. */
export const ADD_ID = '__add'
/** "All work" closes the work row: the cases and sessions beyond the arc. */
export const ALL_WORK_ID = '__all-work'

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
  /** The work row's closing card: how much work there is, and the list. */
  allWork?: { total: number; onOpen: () => void }
  reduced: boolean
}

/**
 * The 3D world: a 1600 × 900 design stage, letterboxed into the window, in
 * which the agent screens stand on a shallow arc. Placement comes from
 * layoutModel; scrolling from Carousel. Screens are DOM, never live surfaces
 * (PLAN.md §3): focusing one shows its summary, and opening the real work
 * hands off to the flat stage.
 */
const PROVIDER_RGB = { codex: [0.18, 0.62, 0.56], claude: [0.85, 0.47, 0.34] } as const

/** Footprints of the screens standing over the lake, nearest first (for reflections and contact shadows). */
function footprints(host: HTMLElement | null, byId: Map<string, AgentPresence>): SheetFootprint[] {
  if (!host) return []
  const horizon = window.innerHeight * (1 - 0.505)
  const out: (SheetFootprint & { z: number })[] = []
  host.querySelectorAll<HTMLElement>('[data-agent]').forEach((slot) => {
    const op = Number(slot.style.opacity || 1)
    const a = byId.get(slot.dataset.agent ?? '')
    const face = slot.querySelector<HTMLElement>('[data-testid="agent-face"]')
    if (op < 0.25 || !a || !face) return
    const r = face.getBoundingClientRect()
    if (r.bottom < horizon || r.width < 20) return
    const glass = slot.querySelector<HTMLElement>('[data-depth="1"]')
    out.push({ left: r.left, right: r.right, bottom: r.bottom, alpha: op * (glass ? 0.55 : 1), color: [...PROVIDER_RGB[a.provider]] as [number, number, number], z: r.width })
  })
  return out.sort((a, b) => b.z - a.z).slice(0, 8)
}

export function LandscapeWorld({ agents, front, back, mode, focusId, onOpen, onStep, renderFocus, onAdd, allWork, reduced }: Props): JSX.Element {
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

  // The input handlers bind once and read the current props from here, so a
  // scrolling row (one render per frame) does not re-subscribe every frame.
  const live = useRef({ mode, focusId, front, back, onOpen, onStep })
  live.current = { mode, focusId, front, back, onOpen, onStep }
  const stepFrom = (id: string, dir: number): void => {
    const { front: f, back: b, onStep: step } = live.current
    // Step between screens only: the Add agent / All work cards are not places to focus.
    const ring = (b.includes(id) ? b : f).filter((x) => x !== ADD_ID && x !== ALL_WORK_ID)
    const i = ring.indexOf(id)
    if (i < 0 || ring.length < 2) return
    step(ring[(i + dir + ring.length) % ring.length])
  }
  const stepRef = useRef(stepFrom)
  stepRef.current = stepFrom

  // Wheel / trackpad on the overview; a horizontal swipe turns the ring when focused.
  const swipe = useRef({ acc: 0, lock: false, t: 0 })
  useEffect(() => {
    const el = host.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      const { mode: m, focusId: f } = live.current
      if (m === 'overview') {
        if (carousel.wheel(e)) e.preventDefault()
      } else if (m === 'focus' && f && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
        e.preventDefault()
        const s = swipe.current
        s.acc += e.deltaX
        if (Math.abs(s.acc) > 90 && !s.lock) {
          stepRef.current(f, Math.sign(s.acc))
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
  }, [carousel])

  // Arrow keys: scroll the row, or turn the ring while focused. Digits open front screens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && !/^[1-9]$/.test(e.key)) return
      const { mode: m, focusId: f, front: fr, onOpen: open } = live.current
      if (m === 'overview') {
        if (/^[1-9]$/.test(e.key)) {
          const id = fr[Number(e.key) - 1]
          if (id && id !== ADD_ID && id !== ALL_WORK_ID) open(id)
          return
        }
        e.preventDefault()
        carousel.step(e.key === 'ArrowRight' ? 1 : -1)
      } else if (m === 'focus' && f && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        stepRef.current(f, e.key === 'ArrowRight' ? 1 : -1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [carousel])

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

  // The lake reflects the standing screens; their glass follows them while they move.
  const backdrop = useContext(BackdropContext)
  const byIdRef = useRef(byId)
  byIdRef.current = byId
  // Wake the backdrop only when placements really change: the presence model
  // refreshes every 30 s with new objects, which must not cost a single frame.
  const layoutKey = useMemo(
    () => all.map((id) => { const p = layout[id]; return p ? `${id}:${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)},${Math.round(p.w)},${p.op.toFixed(2)}` : id }).join('|'),
    [all, layout],
  )
  useEffect(() => {
    if (!backdrop) return
    const source = (): SheetFootprint[] => footprints(host.current, byIdRef.current)
    backdrop.trackSheets(source, scrolling ? 250 : 1500)
  }, [backdrop, layoutKey, scrolling])

  return (
    <div
      ref={host}
      className={`${styles.host} ${backdrop ? styles.glassOn : ''}`}
      onPointerDown={onPointerDown}
      onPointerOver={() => backdrop?.followGlass(700)}
      data-testid="landscape-world"
      data-mode={mode}
    >
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
            if (id === ALL_WORK_ID) {
              return (
                <div
                  key={id}
                  className={styles.slot}
                  style={{ width: p.w, height: p.h, transform: transformOf(p), opacity: p.op, zIndex: Math.round(p.z + 1000), transitionDelay: `${p.delay}ms`, pointerEvents: p.op < 0.2 ? 'none' : undefined }}
                  data-front-index={front.indexOf(id)}
                >
                  <button type="button" className={styles.ghost} onClick={allWork?.onOpen} data-testid="all-work">
                    <span className={styles.ghostPlus}>{allWork?.total ?? 0}</span>
                    All work
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
