import type { Presence } from './mock'
import styles from './PresenceCell.module.css'

/**
 * A LIVE-ACTIVITY presence cell — NOT a card. A small breathing glyph, the
 * agent's name, one live line, a confidence dot (colour-temperature = health)
 * and a tiny running cost. ~15 of these sit in a pale, recessed band: calm
 * because each is small, quiet and receding. This is "life is felt" — the
 * glyph breathes; you don't read it line-by-line, you glance.
 */
export function PresenceCell({ p }: { p: Presence }): JSX.Element {
  // Dot temperature bends warm as confidence drops — never a loud badge.
  const dotClass =
    p.health === 'watch' ? styles.dotWatch : p.health === 'blocked' ? styles.dotBlocked : styles.dotOk

  return (
    <div className={styles.cell} title={`${p.who} · ${p.live}`}>
      {/* The breathing glyph — three staggered dots, the presence "pulse". */}
      <span className={styles.glyph} aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <span className={styles.body}>
        <span className={styles.who}>{p.who}</span>
        <span className={styles.live}>{p.live}</span>
      </span>
      <span className={styles.meta}>
        <span className={`${styles.dot} ${dotClass}`} title={`confidence ${p.confidence.toFixed(2)}`} />
        <span className={styles.cost}>{p.cost}</span>
      </span>
    </div>
  )
}
