import type { MailAddress, TriageHeaders } from './message-parser'

/**
 * What KIND of mail this is.
 *
 * The inbox already had one bit — "bulk or not", read off List-Unsubscribe —
 * and one bit is not enough, in both directions at once:
 *
 *   - GitHub sends List-Unsubscribe AND List-Id on every notification, so the
 *     bit calls "someone replied to your issue" a newsletter.
 *   - Plenty of marketing mail carries neither header and puts the unsubscribe
 *     link in the body, so the bit calls it personal correspondence.
 *
 * Those are the same mistake seen from both ends, and no amount of tuning one
 * header fixes it. What actually separates these is not the mechanism used to
 * send the mail but WHO WROTE IT and WHY, which needs several signals and,
 * where the signals genuinely cannot know, a rule the person writes once.
 *
 * Deliberately three categories and not ten. Every extra category is another
 * folder that is sometimes wrong, and a wrong folder is worse than a full
 * inbox: the inbox is at least where people look.
 */

export type MailCategory =
  /** A person wrote it, to you. The only kind that can need a reply. */
  | 'personal'
  /** A machine wrote it about something you did or own — a build, a receipt, a
   *  reply on an issue. Not a reply-to, but worth seeing. */
  | 'notification'
  /** Something you subscribed to and could stop subscribing to. */
  | 'newsletter'

export interface Classified {
  category: MailCategory
  /** Why, in words a person can check and disagree with. */
  reason: string
  /** The rule that decided it, when one did. */
  ruleId?: string
}

/** The fields classification looks at. A subset of a fetched message. */
export interface ClassifiableMessage {
  subject: string
  from: MailAddress[]
  headers?: TriageHeaders
  /** Plaintext body — only used to find an unsubscribe link. */
  text?: string
  /** Sanitized HTML, when the message had it. */
  html?: string
}

/* ── rules ───────────────────────────────────────────────────────────────── */

/**
 * A rule the person wrote.
 *
 * It ASSIGNS a category rather than forbidding one. "Do not file GitHub as a
 * newsletter" and "GitHub is a notification" are the same instruction, and the
 * positive form says where the mail goes instead — a rule that only says where
 * something must NOT go leaves the app to guess again, which is what produced
 * the wrong answer in the first place.
 */
export interface MailRule {
  id: string
  /** Substring of the sender address or display name, case-insensitive. */
  from?: string
  /** Sender domain, matched on the exact domain or any subdomain of it. */
  domain?: string
  /** Substring of the subject, case-insensitive. */
  subject?: string
  category: MailCategory
  enabled?: boolean
}

const lc = (s: string): string => (s ?? '').toLowerCase()

function domainOf(address: string): string {
  const at = address.lastIndexOf('@')
  return at < 0 ? '' : lc(address.slice(at + 1))
}

/** True when `host` is the rule's domain or a subdomain of it. */
export function domainMatches(host: string, ruleDomain: string): boolean {
  const h = lc(host)
  const d = lc(ruleDomain).replace(/^\.+/, '')
  if (!h || !d) return false
  return h === d || h.endsWith(`.${d}`)
}

/** The first enabled rule that matches, or null. Order is the person's. */
export function matchRule(msg: ClassifiableMessage, rules: MailRule[]): MailRule | null {
  for (const r of rules) {
    if (r.enabled === false) continue
    if (r.from) {
      const needle = lc(r.from)
      if (!msg.from.some((a) => lc(a.address).includes(needle) || lc(a.name || '').includes(needle))) continue
    }
    if (r.domain) {
      if (!msg.from.some((a) => domainMatches(domainOf(a.address), r.domain!))) continue
    }
    if (r.subject && !lc(msg.subject).includes(lc(r.subject))) continue
    // A rule with no conditions would match everything — almost certainly a
    // half-finished rule rather than an intent to reclassify the whole inbox.
    if (!r.from && !r.domain && !r.subject) continue
    return r
  }
  return null
}

/* ── signals ─────────────────────────────────────────────────────────────── */

/** Senders that cannot be replied to, whatever else the mail looks like. */
const NOREPLY_RE =
  /(^|[._-])(no[._-]?reply|do[._-]?not[._-]?reply|donotreply|mailer[._-]?daemon|postmaster|bounce[s]?|notifications?|automated|auto[._-]?confirm)([._-]|$|@)/i

/**
 * An unsubscribe link in the BODY.
 *
 * The signal the header misses, and the one the person actually described. Kept
 * narrow — the word near a link, not the word anywhere — because "unsubscribe"
 * appears in plenty of legitimate mail ABOUT subscriptions.
 */
export function hasUnsubscribeLink(msg: ClassifiableMessage): boolean {
  const body = `${msg.html ?? ''}\n${msg.text ?? ''}`
  if (!body) return false
  // German senders link "abmelden"/"austragen" where English mail says
  // unsubscribe — same mechanism, same meaning, so the same signal.
  if (/href=["'][^"']*(unsubscribe|abmelden|austragen)/i.test(body)) return true
  if (/https?:\/\/\S*(unsubscribe|abmelden|austragen)\S*/i.test(body)) return true
  // "click here to unsubscribe" / "abmelden" with a url on the same line.
  return /(unsubscribe|abmelden|opt[- ]?out)[^\n]{0,60}https?:\/\//i.test(body)
}

/** Mail sent to a list, per its headers. */
export function isListMail(headers: TriageHeaders | undefined): boolean {
  if (!headers) return false
  if (headers['list-unsubscribe'] || headers['list-id']) return true
  const prec = lc(headers.precedence || '')
  return prec === 'bulk' || prec === 'list' || prec === 'junk'
}

/** Mail a machine generated, per RFC 3834 and the sender's own address. */
export function isMachineSent(msg: ClassifiableMessage): boolean {
  const auto = lc(msg.headers?.['auto-submitted'] || '')
  if (auto && auto !== 'no') return true
  if (msg.from.length === 0) return true
  return msg.from.some((a) => NOREPLY_RE.test(a.address) || NOREPLY_RE.test(a.name || ''))
}

/**
 * Words that mark editorial or marketing mail rather than a service telling you
 * something happened. Weak on their own — used only to break the tie below.
 */
/*
 * English AND German — this inbox lives in DACH. The German stems are
 * deliberately NOT wrapped in \b: German marketing words compound
 * ("Sonderangebot", "Frühbucherrabatt", "Rabattaktion") and \b is ASCII-blind
 * around umlauts, so anchored stems would miss most real campaigns. The stems
 * chosen are distinctive enough that substring matching stays safe; generic
 * fragments like "aktion" are excluded ("Transaktion" would match).
 */
const CAMPAIGN_RE =
  /\b(newsletter|digest|weekly|monthly|roundup|issue #?\d+|deals?|sale|% off|webinar|announcement|new arrivals|this week in|top \d+ )\b|angebot|rabatt|gutschein|sonderpreis|schlussverkauf|gewinnspiel|sparaktion|aktionswoche|frühbucher|jetzt sichern|nur (heute|jetzt|noch)|kostenlos testen|exklusiv für/i

/**
 * What kind of mail this is.
 *
 * Rules first, always: the person has looked at the mail and the app has not.
 * After that the order is by how much each signal actually knows — a machine
 * that says "reply-to: nobody" and offers a way to stop receiving this is a
 * newsletter; a machine that offers no way out is telling you something.
 */
export function classify(msg: ClassifiableMessage, rules: MailRule[] = []): Classified {
  return classifyFrom(signalsOf(msg), msg.subject, msg.from, rules)
}

/** The three facts, read off a whole message. */
export function signalsOf(msg: ClassifiableMessage): MailSignals {
  return {
    list: isListMail(msg.headers),
    unsubscribe: hasUnsubscribeLink(msg),
    machine: isMachineSent(msg),
  }
}

/** What was true of a message, stored so it can be sorted later without refetching. */
export interface MailSignals {
  list: boolean
  unsubscribe: boolean
  machine: boolean
}

/**
 * The decision, from the facts.
 *
 * Split out so the mail reader (which has the whole message) and the inbox
 * sweep (which has only what the index kept) reach the same verdict through
 * the same code. Two classifiers would drift, and the drift would show up as
 * the reader saying one thing while the sweep files another.
 */
export function classifyFrom(
  signals: MailSignals,
  subject: string,
  from: MailAddress[],
  rules: MailRule[] = [],
): Classified {
  const rule = matchRule({ subject, from }, rules)
  if (rule) {
    return {
      category: rule.category,
      reason: `your rule: ${describeRule(rule)}`,
      ruleId: rule.id,
    }
  }

  const { list, unsubscribe: unsub, machine } = signals
  const msg = { subject }

  /*
   * A way to stop receiving it is the strongest single signal — you can only
   * unsubscribe from something you subscribed to. But GitHub, Jira and every
   * other service sends List-Unsubscribe on notifications too, so the header
   * alone decides nothing: what separates them is whether the mail is about
   * something that happened to YOUR account, and the honest proxy for that is
   * whether it reads like a campaign.
   */
  if (list || unsub) {
    if (CAMPAIGN_RE.test(msg.subject)) {
      return { category: 'newsletter', reason: 'offers an unsubscribe, and reads like a campaign' }
    }
    if (machine && !unsub) {
      // Listed and machine-sent, with no way out offered in the body: far more
      // likely a service notification than something subscribed to.
      return { category: 'notification', reason: 'sent by a service, with a list header' }
    }
    return { category: 'newsletter', reason: unsub ? 'has an unsubscribe link' : 'sent to a mailing list' }
  }

  if (machine) return { category: 'notification', reason: 'sent by a machine, no reply address' }

  return { category: 'personal', reason: 'a person wrote it' }
}

/** The rule in words, for the reason line and the settings list. */
export function describeRule(r: MailRule): string {
  const parts: string[] = []
  if (r.domain) parts.push(`from ${r.domain}`)
  if (r.from) parts.push(`sender contains "${r.from}"`)
  if (r.subject) parts.push(`subject contains "${r.subject}"`)
  return `${parts.join(', ')} → ${r.category}`
}
