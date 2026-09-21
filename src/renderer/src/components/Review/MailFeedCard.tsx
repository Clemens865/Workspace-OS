import { useState, useCallback } from 'react'
import { relTime } from './reviewModel'
import { CautionIcon } from './FeedCard'
import {
  canArmSend,
  canDraft,
  isMailPending,
  mailHeadline,
  mailResolvedLabel,
  type MailCard,
} from './mailReviewModel'
import { mailReviewStore } from './mailReviewStore'
import styles from './FeedCard.module.css'

interface MailFeedCardProps {
  card: MailCard
}

/**
 * One inbound mail that needs a reply, as a Living-Feed ACTION card — the fusion
 * the user asked for. Draft-gated exactly like the agent action family:
 *   Glance — sender + subject + one-line triage reason.
 *   Draft  — request an agent draft, then EDIT it inline (the send gate opens
 *            when this tier is opened and a non-empty draft exists).
 *   Actions — Approve & Send (Phase-2 mail:send) / Dismiss, equal weight.
 * Never auto-sends: Approve & Send arms (two-tap) only after the draft is open.
 */
export function MailFeedCard({ card }: MailFeedCardProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [armed, setArmed] = useState(false)
  const pending = isMailPending(card.status)

  const requestDraft = useCallback(async () => {
    if (!canDraft(card.status)) return
    mailReviewStore.markDrafting(card.id)
    const res = await window.workspace.mail.draftReply(card.source.accountId, {
      folder: card.source.folder,
      uid: card.source.uid,
      replyAll: card.replyAll,
    })
    if (res.ok) mailReviewStore.setDraft(card.id, res.value.suggestedBody, res.value.replyAll)
    else mailReviewStore.setDraftError(card.id, res.error.message)
  }, [card.id, card.status, card.replyAll, card.source])

  const openDraftTier = useCallback(() => {
    setOpen(true)
    mailReviewStore.openDraft(card.id)
    if (canDraft(card.status)) void requestDraft()
  }, [card.id, card.status, requestDraft])

  const approveSend = useCallback(async () => {
    if (!canArmSend(card)) { openDraftTier(); return }
    if (!armed) { setArmed(true); return }
    // The reply is sent through the PROVEN Phase-2 path. We fetch the source so
    // buildOutgoing (in main) re-derives threading; the edited body is the text.
    mailReviewStore.markSending(card.id)
    const source = await window.workspace.mail.message(
      card.source.accountId,
      card.source.folder,
      card.source.uid,
    )
    if (!source.ok) {
      mailReviewStore.setSendError(card.id, source.error.message)
      setArmed(false)
      return
    }
    const res = await window.workspace.mail.send(
      card.source.accountId,
      { to: [], subject: '', text: card.draftBody },
      { kind: 'reply', source: source.value, replyAll: card.replyAll },
    )
    if (res.ok) mailReviewStore.markSent(card.id)
    else { mailReviewStore.setSendError(card.id, res.error.message); setArmed(false) }
  }, [card, armed, openDraftTier])

  const dismiss = useCallback(() => mailReviewStore.dismiss(card.id), [card.id])

  if (!pending) {
    return (
      <article className={`${styles.card} ${styles.resolved}`} data-testid="mail-card" data-resolved="true">
        <div className={styles.topAccent} />
        <div className={styles.resolvedRow}>
          <span className={styles.resolvedBadge}>
            {mailResolvedLabel(card.status)}
          </span>
          <span className={styles.resolvedText}>{mailHeadline(card)}</span>
          <span className={styles.resolvedMeta}>
            {card.source.fromLabel} · {card.resolvedAt ? relTime(card.resolvedAt) : relTime(card.createdAt)}
          </span>
        </div>
      </article>
    )
  }

  const armEnabled = canArmSend(card)
  const drafting = card.status === 'drafting'
  const sending = card.status === 'sending'

  return (
    <article className={styles.card} data-testid="mail-card" data-family="action">
      <div className={styles.topAccent} />
      <div className={styles.body}>
        <div className={styles.kickerRow}>
          <span className={styles.family}>Reply</span>
          <span className={styles.session}>{card.source.fromLabel}</span>
          <span className={styles.time}>{relTime(card.createdAt)}</span>
        </div>

        <h3 className={styles.headline}>{mailHeadline(card)}</h3>

        <div className={styles.stakes}>
          <span className={styles.chip}>needs a reply</span>
          <span className={styles.chip}>{card.source.folder}</span>
          {card.source.reason && <span className={styles.chip}>{card.source.reason}</span>}
        </div>

        <p className={`${styles.gateNote} ${styles.willsend}`}>
          <CautionIcon />
          This sends an email — nothing goes out until you approve it
        </p>

        <div className={styles.actions}>
          <button
            className={`${styles.act} ${armed ? styles.actArmed : ''}`}
            onClick={() => void approveSend()}
            disabled={sending}
          >
            {sending ? 'Sending…' : !armEnabled ? 'Read the draft first' : armed ? 'Confirm — send it' : 'Approve & send'}
          </button>
          <button className={styles.act} onClick={dismiss} disabled={sending}>
            Dismiss
          </button>
        </div>

        <div className={styles.disclosure}>
          <button className={styles.discBtn} onClick={open ? () => setOpen(false) : openDraftTier}>
            {open ? 'Hide draft' : card.draftBody ? 'Show draft' : 'Draft a reply'}
          </button>
        </div>

        {open && (
          <div className={styles.tier}>
            <div className={styles.tierKicker}>THE DRAFTED REPLY</div>
            {!card.draftBody && (
              <label className={styles.replyToggle}>
                <input
                  type="checkbox"
                  checked={card.replyAll}
                  onChange={(e) => mailReviewStore.setReplyAll(card.id, e.target.checked)}
                  disabled={drafting}
                />
                Reply to all
              </label>
            )}
            {drafting && <p className={styles.diffState}>Drafting a reply…</p>}
            {card.status === 'draft-error' && (
              <>
                <p className={styles.diffState}>Drafting failed: {card.error}</p>
                <button className={styles.discBtn} onClick={() => void requestDraft()}>Try again</button>
              </>
            )}
            {card.status === 'send-error' && <p className={styles.diffState}>Send failed: {card.error}</p>}
            {(card.status === 'drafted' || card.status === 'send-error' || card.status === 'sending') && (
              <textarea
                className={styles.draftArea}
                value={card.draftBody}
                onChange={(e) => mailReviewStore.editDraft(card.id, e.target.value)}
                disabled={sending}
                aria-label="Drafted reply"
              />
            )}
          </div>
        )}
      </div>
    </article>
  )
}
