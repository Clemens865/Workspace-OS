import styles from './StatusPill.module.css'

/**
 * The one status pill — the quiet tone grammar every row shares (Beautiful UI
 * task-rows, beautifului.dev MIT; on wos tokens):
 *
 *   good     landed / accepted — green tint
 *   warn     waiting on the person — amber tint
 *   gap      failed / rejected — red tint
 *   accent   running right now — blue tint
 *   neutral  everything healthy enough to ignore
 *
 * A tone is an ANSWER ("does this need me?"), not a colour choice — which is
 * why callers map their own vocabulary to a tone here instead of styling
 * status text ad hoc per surface.
 */
export type PillTone = 'good' | 'warn' | 'gap' | 'accent' | 'neutral'

const TONE_CLASS: Record<PillTone, string> = {
  good: styles.good,
  warn: styles.warn,
  gap: styles.gap,
  accent: styles.accent,
  neutral: styles.neutral,
}

export function StatusPill({ tone, children, title }: {
  tone: PillTone
  children: React.ReactNode
  title?: string
}): JSX.Element {
  return (
    <span className={`${styles.pill} ${TONE_CLASS[tone]}`} title={title}>
      {children}
    </span>
  )
}

/** A case status → its tone: warm when it waits on the person, green when won,
 * red when lost, quiet otherwise. */
export function caseTone(status: string, needsYou: boolean): PillTone {
  if (needsYou) return 'warn'
  if (status === 'accepted') return 'good'
  if (status === 'rejected') return 'gap'
  return 'neutral'
}

/** A fleet lane status → its tone. */
export function laneTone(status: 'error' | 'awaiting-approval' | 'running' | 'done'): PillTone {
  switch (status) {
    case 'error': return 'gap'
    case 'awaiting-approval': return 'warn'
    case 'running': return 'accent'
    default: return 'neutral'
  }
}
