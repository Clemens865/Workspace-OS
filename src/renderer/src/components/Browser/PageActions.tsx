import { useMemo, useState } from 'react'
import { Sparkles, ChevronDown, ChevronRight } from 'lucide-react'
import { suggestedActions, everyAction, type Action, type PageSignals } from './page-actions'
import styles from './PageActions.module.css'

/**
 * "Here you can…" — the discoverability surface.
 *
 * It lives in the panel that is already open, so nothing has to be summoned and
 * no shortcut has to be known. The list is short and it CHANGES with the page,
 * which is what makes it teach: browse to a page with a table and an offer
 * appears that was not there a moment ago. That is a capability demonstrating
 * itself, rather than a menu waiting to be read.
 *
 * "Everything else" is collapsed rather than absent. Somebody hunting a feature
 * they know exists must be able to find it by looking, and hiding the long tail
 * would put them back where a command palette leaves them.
 *
 * Shortcuts appear beside the actions that have them. Nobody is asked to learn
 * ⌘F; they simply see it next to "Find something on this page" often enough
 * that one day they use it.
 */
export function PageActions({
  signals,
  onRun,
  busy,
}: {
  signals: PageSignals
  onRun: (id: Action['id']) => void
  busy?: Action['id'] | null
}): JSX.Element | null {
  const [showAll, setShowAll] = useState(false)
  const suggested = useMemo(() => suggestedActions(signals), [signals])
  const rest = useMemo(() => {
    const top = new Set(suggested.map((a) => a.id))
    return everyAction(signals).filter((a) => !top.has(a.id))
  }, [signals, suggested])

  if (!signals.hasPage) return null

  const row = (a: Action, dim = false): JSX.Element => (
    <button
      key={a.id}
      className={dim ? styles.rowDim : styles.row}
      onClick={() => onRun(a.id)}
      disabled={busy === a.id}
      title={a.label}
    >
      {a.agentic && <Sparkles className={styles.spark} size={12} />}
      <span className={styles.label}>{busy === a.id ? 'Working…' : a.label}</span>
      {/* Shown, never required — this is how the shortcut gets learned. */}
      {a.shortcut && <kbd className={styles.kbd}>{a.shortcut}</kbd>}
    </button>
  )

  return (
    <section className={styles.wrap} aria-label="What you can do here">
      <div className={styles.head}>Here you can</div>
      <div className={styles.list}>{suggested.map((a) => row(a))}</div>

      <button className={styles.more} onClick={() => setShowAll((v) => !v)}>
        {showAll ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {showAll ? 'Less' : `Everything else (${rest.length})`}
      </button>

      {showAll && <div className={styles.list}>{rest.map((a) => row(a, a.relevance === 0))}</div>}
    </section>
  )
}
