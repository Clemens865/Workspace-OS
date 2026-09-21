import { classifyFrom, type MailRule } from './classify'
import type { IndexedRow } from './mail-index'

/**
 * "You have 14 newsletters — file them?"
 *
 * Proposes, never moves. That constraint is inherited deliberately from the
 * filing plan: a pass that tidies the inbox by itself is indistinguishable
 * from mail going missing, because the person opens the inbox, their mail is
 * not there, and nothing tells them where it went. One press is a small price
 * for the difference between "the app filed my mail" and "my mail vanished".
 *
 * Three things it will not do, each for a reason that has already been paid
 * for elsewhere in this codebase:
 *
 * NOTHING BUT NEWSLETTERS. A notification is not a newsletter — a build that
 * failed, a payment that bounced. Only the category the person can always
 * catch up on later is offered, so being wrong costs a folder to look in
 * rather than a missed deadline.
 *
 * NOTHING IT WAS NOT SURE ABOUT. A message the index never deepened has no
 * signals, and no signals is not the same as "not a newsletter". Those are
 * left out and COUNTED, so the proposal can say what it could not see instead
 * of quietly proposing less than it should.
 *
 * NOTHING OLD ENOUGH TO HAVE BEEN FILED ALREADY. A window keeps the proposal
 * small enough to actually read; nobody reviews four hundred decisions.
 */

export interface SweepMessage {
  folder: string
  uid: number
  subject: string
  fromName: string
  fromAddress: string
  date: number | null
}

export interface SweepSender {
  /** Display name where there is one, else the address. */
  label: string
  address: string
  count: number
}

export interface NewsletterSweep {
  /** Where they would go. */
  folder: string
  messages: SweepMessage[]
  /** Who they are from, most-frequent first — what the person actually reads. */
  senders: SweepSender[]
  /** Messages skipped because the index never looked at them. */
  unknown: number
  /** The sentence shown above the buttons. */
  summary: string
}

/** The folder newsletters go to. One, and named for what is in it. */
export const NEWSLETTER_FOLDER = 'Newsletters'

const DAY = 86_400_000

export function buildNewsletterSweep(
  rows: IndexedRow[],
  rules: MailRule[],
  opts: { days?: number; now?: number; folder?: string } = {},
): NewsletterSweep {
  const days = opts.days ?? 30
  const now = opts.now ?? Date.now()
  const cutoff = now - days * DAY
  const folder = opts.folder ?? NEWSLETTER_FOLDER

  const messages: SweepMessage[] = []
  const bySender = new Map<string, SweepSender>()
  let unknown = 0

  for (const r of rows) {
    if (r.date !== null && r.date < cutoff) continue
    // Already where it is going.
    if (r.folder === folder) continue
    if (!r.signals) {
      unknown++
      continue
    }
    const from = [{ name: r.fromName, address: r.fromAddress }]
    if (classifyFrom(r.signals, r.subject, from, rules).category !== 'newsletter') continue

    messages.push({
      folder: r.folder,
      uid: r.uid,
      subject: r.subject,
      fromName: r.fromName,
      fromAddress: r.fromAddress,
      date: r.date,
    })
    const key = r.fromAddress.toLowerCase()
    const seen = bySender.get(key)
    if (seen) seen.count++
    else bySender.set(key, { label: r.fromName || r.fromAddress, address: r.fromAddress, count: 1 })
  }

  const senders = [...bySender.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  return { folder, messages, senders, unknown, summary: describeSweep(messages.length, senders, days, unknown) }
}

/**
 * The sentence above the buttons.
 *
 * Names the senders rather than only counting, because "14 newsletters" is a
 * number to be trusted and "Substack, TLDR and 4 others" is something the
 * person can actually check before pressing anything.
 */
export function describeSweep(count: number, senders: SweepSender[], days: number, unknown = 0): string {
  if (count === 0) {
    return unknown > 0
      ? `No newsletters yet in the last ${days} days — ${unknown} messages still to read. Press again to keep going.`
      : `No newsletters in the last ${days} days.`
  }
  const named = senders.slice(0, 3).map((s) => s.label)
  const rest = senders.length - named.length
  const who = rest > 0 ? `${named.join(', ')} and ${rest} other${rest === 1 ? '' : 's'}` : named.join(', ')
  const head = `${count} newsletter${count === 1 ? '' : 's'} from the last ${days} days — ${who}.`
  return unknown > 0 ? `${head} ${unknown} still to read — press again after filing these.` : head
}
