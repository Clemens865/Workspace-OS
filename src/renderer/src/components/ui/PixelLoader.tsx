import { useEffect, useState } from 'react'
import styles from './PixelLoader.module.css'

/**
 * Pixel-grid loader for long-running work — a 3×3 grid with a moving
 * wavefront, a shimmering label, and a live elapsed timer in mono tabular
 * figures. Variants:
 *
 *   drive — chevron wavefront driving right (the 650ms cycle is shorter than
 *           the sweep, so two fronts are always in flight)
 *   orbit — a comet lapping the grid perimeter
 *
 * Adapted from Beautiful UI's Loading State (beautifului.dev, MIT; reference
 * in docs/design/reference) onto wos tokens. Reduced motion freezes the grid
 * to its dim state; the timer still ticks — time passing is information.
 */

const chevron = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3)
  const c = i % 3
  return (c + Math.abs(r - 1)) * 90
})

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3]
const orbit = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i)
  return k === -1 ? null : k * 110
})

const PATTERNS: Record<string, { delays: (number | null)[]; dur: number }> = {
  drive: { delays: chevron, dur: 650 },
  orbit: { delays: orbit, dur: 950 },
}

function useElapsed(): string {
  const [ds, setDs] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setDs((d) => d + 1), 100)
    return () => clearInterval(t)
  }, [])
  const total = ds / 10
  if (total < 60) return `${total.toFixed(1)}s`
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`
}

export function PixelLoader({
  label = 'Working',
  variant = 'drive',
  showElapsed = true,
}: {
  label?: string
  variant?: 'drive' | 'orbit'
  showElapsed?: boolean
}): JSX.Element {
  const elapsed = useElapsed()
  const { delays, dur } = PATTERNS[variant] ?? PATTERNS.drive
  return (
    <div role="status" className={styles.root}>
      <span aria-hidden className={styles.grid}>
        {delays.map((delay, i) => (
          <span
            key={i}
            className={styles.px}
            style={{
              opacity: delay === null ? 0.07 : undefined,
              animation: delay === null ? 'none' : `wosPxOn ${dur}ms ease-in-out ${delay}ms infinite`,
            }}
          />
        ))}
      </span>
      <span className={styles.label}>{label}</span>
      {showElapsed && <span className={styles.elapsed}>{elapsed}</span>}
    </div>
  )
}
