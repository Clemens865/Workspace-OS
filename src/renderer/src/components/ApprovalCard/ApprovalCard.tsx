import { useState } from 'react'
import { Check, X } from 'lucide-react'
import styles from './ApprovalCard.module.css'

/**
 * A question the agent (or the app) needs answered before acting, as a card:
 * one-tap options, an optional free answer, a dismiss — and a small "answered"
 * badge once it fires, so the card visibly leaves instead of lingering.
 *
 * Adapted from Beautiful UI's Approval Card grammar (beautifului.dev, MIT;
 * reference in docs/design/reference), single-question form, on wos tokens.
 *
 * Deliberately NOT used for irreversible outbound actions — the Living Feed's
 * HitlCard keeps its stronger draft-gated approve there. This card is for
 * choices: which calendar, which option, which of three drafts.
 */

export interface ApprovalOption {
  id: string
  label: string
  hint?: string
}

interface Props {
  question: string
  options: ApprovalOption[]
  /** Placeholder for a free-text answer; omit to allow only the options. */
  freeAnswerPlaceholder?: string
  busy?: boolean
  onAnswer: (answer: { optionId?: string; text?: string }) => void
  onDismiss?: () => void
}

export function ApprovalCard({ question, options, freeAnswerPlaceholder, busy, onAnswer, onDismiss }: Props): JSX.Element {
  const [text, setText] = useState('')
  const [answered, setAnswered] = useState<string | null>(null)

  const pick = (id: string, label: string): void => {
    if (busy || answered) return
    setAnswered(label)
    onAnswer({ optionId: id })
  }
  const sendText = (): void => {
    const t = text.trim()
    if (!t || busy || answered) return
    setAnswered(t)
    onAnswer({ text: t })
  }

  if (answered) {
    return (
      <div className={styles.sent}>
        <span className={styles.sentBadge}>
          <span className={styles.sentCheck}><Check size={11} strokeWidth={3} /></span>
          {answered}
        </span>
      </div>
    )
  }

  return (
    <div className={styles.card} data-testid="approval-card">
      <div className={styles.head}>
        <span className={styles.question}>{question}</span>
        {onDismiss && (
          <button type="button" className={styles.dismiss} aria-label="Dismiss" onClick={onDismiss}>
            <X size={13} />
          </button>
        )}
      </div>

      <div className={styles.options}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={styles.option}
            disabled={busy}
            onClick={() => pick(o.id, o.label)}
            title={o.hint}
          >
            <span className={styles.radio} aria-hidden="true" />
            <span className={styles.optionLabel}>{o.label}</span>
            {o.hint && <span className={styles.optionHint}>{o.hint}</span>}
          </button>
        ))}
      </div>

      {freeAnswerPlaceholder && (
        <div className={styles.freeRow}>
          <input
            className={styles.free}
            value={text}
            placeholder={freeAnswerPlaceholder}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') sendText() }}
          />
          <button type="button" className={styles.freeSend} onClick={sendText} disabled={busy || !text.trim()}>
            <Check size={13} />
          </button>
        </div>
      )}
    </div>
  )
}
