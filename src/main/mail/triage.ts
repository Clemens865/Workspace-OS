import type { MailAddress, TriageHeaders } from './message-parser'
import { classify, type MailRule, type MailCategory } from './classify'

/**
 * PURE, fixture-testable triage: given fetched inbox messages + the account's
 * own address, decide which plausibly NEED A HUMAN REPLY and rank them.
 *
 * No Electron, no network, no I/O — every function here is deterministic over
 * its inputs so the whole "which mail becomes an Agent-Review card" decision is
 * unit-verifiable without a live mailbox.
 *
 * The heuristics are deliberately conservative (favouring precision over
 * recall): a false "needs reply" costs the user a dismiss; a false negative
 * merely means the mail stays in the inbox as it always did. Signals:
 *   + the message is UNREAD (already-read mail was presumably handled),
 *   + the user is a DIRECT recipient (To/Cc), not just bcc'd / on a list,
 *   − the sender is automated (noreply@, mailer-daemon, bounce, do-not-reply),
 *   − the message is BULK / a mailing list (List-Unsubscribe / List-Id /
 *     Precedence: bulk|list / Auto-Submitted),
 *   + (bonus) the body asks a question or makes a direct ask.
 * A message needs a reply iff it is unread, a direct recipient, human (not
 * automated), and not bulk. The question signal only re-ranks; it is not gating.
 */

/** The subset of a fetched message triage needs. Built from a FullMessage. */
export interface TriageMessage {
  uid: number
  folder: string
  subject: string
  from: MailAddress[]
  to: MailAddress[]
  cc: MailAddress[]
  /** Plaintext body (used only for the light question/ask bonus signal). */
  text: string
  seen: boolean
  /** Lowercased subset of raw headers; absent keys mean "signal not present". */
  headers?: TriageHeaders
  /** Sanitized HTML, when there was any — an unsubscribe link often lives only here. */
  html?: string
}

/** One message that plausibly needs a reply, with a score and a short reason. */
export interface NeedsReply {
  uid: number
  folder: string
  subject: string
  /** Best display name/address for the sender (first From entry). */
  from: MailAddress | null
  /** 0..100 — higher = more likely to genuinely need a human reply. */
  score: number
  /** Short, human-readable justification for surfacing this as a card. */
  reason: string
  /** True when the body contains a question mark or a direct-ask phrase. */
  hasQuestion: boolean
  /** What kind of mail this is — carried so the UI can say why it is here. */
  category: MailCategory
}

/** Sender local-parts / patterns that mark automated, non-repliable senders. */
const NOREPLY_RE =
  /(^|[._-])(no[._-]?reply|do[._-]?not[._-]?reply|donotreply|mailer[._-]?daemon|postmaster|bounce[s]?|notifications?|automated|auto[._-]?confirm)([._-]|$|@)/i

/** Direct-ask phrases that, with a '?', raise a message's rank a little. */
const ASK_RE =
  /\b(can you|could you|would you|please (?:let me know|confirm|review|advise|send|reply|respond)|let me know|what do you think|any (?:thoughts|update)|when (?:can|will|would)|are you able|thoughts\?|your input|need your|waiting (?:on|for) your|get back to me)\b/i

const lc = (s: string): string => s.toLowerCase()

/** True when `addr` is present in `list` (case-insensitive on the address). */
function includesAddress(list: MailAddress[], addr: string): boolean {
  const target = lc(addr)
  return list.some((a) => lc(a.address) === target)
}

/** True when the sender looks automated (noreply / daemon / postmaster / bounce). */
export function isAutomatedSender(from: MailAddress[]): boolean {
  if (from.length === 0) return true // no sender to reply to
  return from.some((a) => NOREPLY_RE.test(a.address) || NOREPLY_RE.test(a.name || ''))
}

/** True when the message is bulk / from a mailing list (header-driven). */
export function isBulkOrList(headers: TriageHeaders | undefined): boolean {
  if (!headers) return false
  if (headers['list-unsubscribe']) return true
  if (headers['list-id']) return true
  const prec = lc(headers.precedence || '')
  if (prec === 'bulk' || prec === 'list' || prec === 'junk') return true
  // RFC 3834: an auto-generated/auto-replied message must not be replied to.
  const auto = lc(headers['auto-submitted'] || '')
  if (auto && auto !== 'no') return true
  return false
}

/** True when the user is a direct To/Cc recipient (not bcc / list-only). */
export function isDirectRecipient(msg: TriageMessage, selfAddress: string): boolean {
  return includesAddress(msg.to, selfAddress) || includesAddress(msg.cc, selfAddress)
}

/** True when the body contains a question or a direct-ask phrase. */
export function hasQuestion(text: string): boolean {
  const body = text || ''
  if (body.includes('?')) return true
  return ASK_RE.test(body)
}

/**
 * Classifies a single message. Returns a NeedsReply when it passes the gates,
 * or null with the disqualifying reason discarded (callers only surface hits).
 * Exposed for unit tests that assert the gate + reason for each fixture class.
 */
export function classifyMessage(
  msg: TriageMessage,
  selfAddress: string,
  rules: MailRule[] = [],
): NeedsReply | null {
  // Gate 1: already-read mail is assumed handled.
  if (msg.seen) return null
  // Gate 2: automated senders can't be meaningfully replied to.
  if (isAutomatedSender(msg.from)) return null
  /*
   * Gate 3: only a person can be owed a reply.
   *
   * This used to be one bit off List-Unsubscribe, which got it wrong in both
   * directions at once — every GitHub notification looked like a newsletter,
   * and every campaign without the header looked like correspondence. The
   * inbox filled the cockpit with mail nobody had to answer, which is the
   * fastest way to teach someone to stop reading it. See classify.ts.
   */
  const kind = classify({ subject: msg.subject, from: msg.from, headers: msg.headers, text: msg.text, html: msg.html }, rules)
  if (kind.category !== 'personal') return null
  // Gate 4: the user must be a direct recipient (To/Cc), not bcc/list-only.
  if (!isDirectRecipient(msg, selfAddress)) return null

  const question = hasQuestion(msg.text)
  const directTo = includesAddress(msg.to, selfAddress)

  // Score: base for passing all gates, + being a primary (To) recipient,
  // + an explicit question/ask, + a sole-recipient bonus (clearly aimed at you).
  let score = 60
  const reasons: string[] = ['Unread, addressed to you']
  if (directTo) {
    score += 15
  } else {
    reasons[0] = 'Unread, you are Cc’d'
  }
  if (question) {
    score += 20
    reasons.push('asks a question')
  }
  if (msg.to.length === 1 && directTo && msg.cc.length === 0) {
    score += 5
    reasons.push('sent only to you')
  }
  score = Math.min(100, score)

  return {
    uid: msg.uid,
    folder: msg.folder,
    subject: msg.subject || '(no subject)',
    from: msg.from[0] ?? null,
    score,
    reason: reasons.join(' · '),
    hasQuestion: question,
    category: kind.category,
  }
}

/**
 * Triage a batch of messages → the ones needing a reply, ranked by score
 * (descending), ties broken by uid (newest-first, since IMAP uids rise over
 * time). Pure over its inputs.
 */
export function triageMessages(
  messages: TriageMessage[],
  selfAddress: string,
  rules: MailRule[] = [],
): NeedsReply[] {
  const hits: NeedsReply[] = []
  for (const msg of messages) {
    const hit = classifyMessage(msg, selfAddress, rules)
    if (hit) hits.push(hit)
  }
  hits.sort((a, b) => (b.score - a.score) || (b.uid - a.uid))
  return hits
}

/** Adapts a fetched FullMessage-like record into the TriageMessage triage wants. */
export function toTriageMessage(
  m: {
    uid: number
    subject: string
    from: MailAddress[]
    to: MailAddress[]
    cc: MailAddress[]
    text: string
    seen: boolean
    headers?: TriageHeaders
    html?: string
  },
  folder: string,
): TriageMessage {
  return {
    uid: m.uid,
    folder,
    subject: m.subject,
    from: m.from,
    to: m.to,
    cc: m.cc,
    text: m.text,
    seen: m.seen,
    headers: m.headers,
    ...(m.html ? { html: m.html } : {}),
  }
}
