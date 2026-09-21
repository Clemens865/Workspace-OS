/**
 * Pure model for MAIL cards in the Agent Review "Living Feed" — the fusion of
 * inbound mail into the same trust surface as agent runs. Additive to
 * reviewModel.ts (agent runs); it does NOT change ReviewRun semantics.
 *
 * A mail that needs a reply is exactly an `action` family item (irreversible
 * outbound send) and is therefore DRAFT-GATED: Approve & Send only arms after
 * the drafted reply (the draft tier) has been opened. Every function here is
 * unit-tested in isolation — no React, no IPC.
 */

/** Lifecycle of a mail-review card, as a small state machine. */
export type MailCardStatus =
  | 'needs-draft' // triaged, no draft requested yet
  | 'drafting' // the agent is producing a suggested reply
  | 'drafted' // a suggested reply is ready to review/edit
  | 'draft-error' // drafting failed (retryable)
  | 'sending' // Approve & Send in flight
  | 'sent' // resolved: sent
  | 'dismissed' // resolved: dismissed
  | 'send-error' // send failed (retryable)

/** The sender/subject/reason a card shows at a glance (from triage). */
export interface MailCardSource {
  accountId: string
  folder: string
  uid: number
  subject: string
  /** Display string for the sender ("Name <addr>" or bare address). */
  fromLabel: string
  /** One-line triage justification. */
  reason: string
  /** 0..100 triage score (drives ordering alongside recency). */
  score: number
}

/** One mail-review card. `draft` is filled once the agent returns a reply. */
export interface MailCard {
  /** Stable id: `${accountId}:${folder}:${uid}` — dedupes re-triage. */
  id: string
  source: MailCardSource
  status: MailCardStatus
  /** The editable reply body (initialised from the agent draft; user may edit). */
  draftBody: string
  /** True once the draft tier has been opened — the send gate. */
  draftOpened: boolean
  /** reply-all vs direct reply (chosen before drafting). */
  replyAll: boolean
  /** Non-secret error text for draft/send failures. */
  error: string | null
  createdAt: number
  resolvedAt: number | null
}

/** Composes the stable card id from its source coordinates. */
export function mailCardId(accountId: string, folder: string, uid: number): string {
  return `${accountId}:${folder}:${uid}`
}

/** True while the card still needs the human (not sent/dismissed). */
export function isMailPending(status: MailCardStatus): boolean {
  return status !== 'sent' && status !== 'dismissed'
}

/**
 * The send gate: Approve & Send may only ARM after the draft tier has been
 * opened AND a drafted body exists AND we're not mid-flight. This is the mail
 * analog of the action-family draft-gating in FeedCard/HitlCard.
 */
export function canArmSend(card: Pick<MailCard, 'status' | 'draftOpened' | 'draftBody'>): boolean {
  if (!card.draftOpened) return false
  if (card.draftBody.trim() === '') return false
  return card.status === 'drafted' || card.status === 'send-error'
}

/** True when a (re-)draft can be requested right now. */
export function canDraft(status: MailCardStatus): boolean {
  return status === 'needs-draft' || status === 'draft-error'
}

/** Glance headline: the subject, capped. */
export function mailHeadline(card: Pick<MailCard, 'source'>): string {
  const s = card.source.subject.trim() || '(no subject)'
  return s.length > 96 ? s.slice(0, 95).trimEnd() + '…' : s
}

/** Short status caption for the resolved/terminal states (equal weight). */
export function mailResolvedLabel(status: MailCardStatus): string {
  if (status === 'sent') return 'Sent'
  if (status === 'dismissed') return 'Dismissed'
  return ''
}

/** Builds a fresh card from a triage hit (status = needs-draft). */
export function cardFromTriage(
  accountId: string,
  hit: {
    folder: string
    uid: number
    subject: string
    from: { name: string; address: string } | null
    reason: string
    score: number
  },
  now: number,
): MailCard {
  return {
    id: mailCardId(accountId, hit.folder, hit.uid),
    source: {
      accountId,
      folder: hit.folder,
      uid: hit.uid,
      subject: hit.subject,
      fromLabel: fromLabel(hit.from),
      reason: hit.reason,
      score: hit.score,
    },
    status: 'needs-draft',
    draftBody: '',
    draftOpened: false,
    replyAll: false,
    error: null,
    createdAt: now,
    resolvedAt: null,
  }
}

/** "Name <addr>" or the bare address, or a fallback. */
export function fromLabel(from: { name: string; address: string } | null): string {
  if (!from) return '(unknown sender)'
  return from.name ? `${from.name} <${from.address}>` : from.address
}

/** Ordering for the feed: pending first, then by score, then recency. */
export function compareMailCards(a: MailCard, b: MailCard): number {
  const ap = isMailPending(a.status) ? 1 : 0
  const bp = isMailPending(b.status) ? 1 : 0
  if (ap !== bp) return bp - ap
  if (a.source.score !== b.source.score) return b.source.score - a.source.score
  return b.createdAt - a.createdAt
}
