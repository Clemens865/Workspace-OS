import { useEffect, useState } from 'react'
import type { WorkingCell } from './cockpitModel'
import { elapsed } from './cockpitModel'
import styles from './PresenceCell.module.css'

/**
 * A LIVE presence cell — a running agent. Small, breathing, glanceable: the
 * agent's name, its latest AGENT_ACTIVITY line ("deep-reading notion.so"), and
 * REAL meters (elapsed · turns · cost). No fabricated confidence dot — the
 * breathing glyph alone signals "alive". A 5s tick keeps elapsed honest.
 */
export function LivePresenceCell({ cell }: { cell: WorkingCell }): JSX.Element {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5000)
    return () => clearInterval(id)
  }, [])

  const meters = [
    elapsed(cell.startedAt),
    cell.turns > 0 ? `${cell.turns} turns` : null,
    cell.costUsd > 0 ? `$${cell.costUsd.toFixed(2)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className={styles.cell} title={`${cell.who} · ${cell.live}`}>
      {/* Pixel-grid orbit (Beautiful UI loading-state grammar): a comet laps
          the perimeter — alive without shouting. Center pixel stays dark. */}
      <span className={styles.pixels} aria-hidden>
        <i /><i /><i /><i /><i /><i /><i /><i /><i />
      </span>
      <span className={styles.body}>
        <span className={styles.who}>{cell.who}</span>
        <span className={styles.live}>{cell.live}</span>
      </span>
      <span className={styles.meta}>
        <span className={styles.cost}>{meters}</span>
      </span>
    </div>
  )
}
