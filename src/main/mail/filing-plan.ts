/**
 * Agentic filing — analyse recent mail, propose a folder structure, then file.
 *
 * The shape of this feature is the point. It is:
 *
 *   analyse → PROPOSE → human approves → file → one-action undo
 *
 * not "the agent tidied your inbox". A filing pass that runs without approval
 * is indistinguishable from mail going missing: the user opens the inbox, their
 * mail is not there, and they have no idea what happened or where it went.
 *
 * Three constraints fall out of that, and each is enforced here rather than
 * suggested in a prompt:
 *
 * 1. **Bounded by time, never "everything".** Filing a 40,000-message inbox is
 *    both pointless and unreviewable — nobody can check 40,000 decisions. A
 *    window (7 / 30 / 90 days) keeps the proposal small enough to actually read.
 *
 * 2. **Only confident groups.** A folder proposed for two messages is noise;
 *    it makes the rail worse than the inbox it tidied. Groups below a threshold
 *    are left alone, and the leftovers are reported as "stays in the inbox"
 *    rather than swept into a "Misc" folder nobody will ever open.
 *
 * 3. **Never moves what the user has not seen.** An unread message moved into a
 *    folder is a message that may never be read. Unread mail is excluded from
 *    filing entirely — it is the one class where being wrong is invisible.
 */

export type FilingWindow = 7 | 30 | 90

export interface FilingCandidate {
  accountId: string
  folder: string
  uid: number
  messageId: string
  subject: string
  fromName: string
  fromAddress: string
  /** Epoch ms. */
  date: number | null
  seen: boolean
  /** True when the message looks like bulk/newsletter mail. */
  bulk?: boolean
}

export interface ProposedFolder {
  /** Folder name to create/use, e.g. "LinkedIn" or "acme.com". */
  name: string
  /** Why this group exists, in plain language, shown to the user. */
  reason: string
  /** The messages that would move. */
  messages: FilingCandidate[]
}

export interface FilingPlan {
  windowDays: FilingWindow
  /** Groups worth creating a folder for. */
  folders: ProposedFolder[]
  /** Considered but deliberately left where they are, with the reason. */
  skipped: { count: number; reasons: Record<string, number> }
}

/** Minimum messages before a group justifies its own folder. */
export const MIN_GROUP = 4

/** Extracts the organisation-ish part of an address for grouping. */
export function domainOf(address: string): string {
  const at = (address || '').lastIndexOf('@')
  if (at < 0) return ''
  const host = address.slice(at + 1).toLowerCase().trim()
  // Drop a leading mail-subdomain so "mail.linkedin.com" groups with
  // "linkedin.com" — otherwise one sender fragments across three folders.
  return host.replace(/^(?:mail|email|e|smtp|news|notifications?|no-?reply)\./, '')
}

/** A human-friendly folder name from a domain: "linkedin.com" → "LinkedIn". */
export function folderNameFor(domain: string): string {
  const core = domain.split('.').slice(0, -1).pop() || domain
  return core
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** True when the message is inside the window. */
export function withinWindow(date: number | null, windowDays: FilingWindow, now: number): boolean {
  if (date === null) return false
  return date >= now - windowDays * 86_400_000
}

/**
 * Builds a filing proposal. PURE — it decides nothing about IMAP and moves
 * nothing; it produces a plan a human then approves or rejects.
 */
export function buildFilingPlan(
  candidates: FilingCandidate[],
  windowDays: FilingWindow,
  now: number,
): FilingPlan {
  const reasons: Record<string, number> = {}
  const skip = (why: string): void => {
    reasons[why] = (reasons[why] ?? 0) + 1
  }

  const eligible: FilingCandidate[] = []
  for (const c of candidates) {
    if (!withinWindow(c.date, windowDays, now)) {
      skip(`outside the last ${windowDays} days`)
      continue
    }
    if (!c.seen) {
      // The one class where being wrong is invisible: a moved unread message
      // may simply never be read.
      skip('unread — never filed')
      continue
    }
    if (!c.messageId) {
      // Without a Message-ID the move could not be undone, and the action layer
      // would refuse it anyway.
      skip('no Message-ID, so the move could not be undone')
      continue
    }
    eligible.push(c)
  }

  const byDomain = new Map<string, FilingCandidate[]>()
  for (const c of eligible) {
    const d = domainOf(c.fromAddress)
    if (!d) {
      skip('no usable sender domain')
      continue
    }
    const list = byDomain.get(d) ?? []
    list.push(c)
    byDomain.set(d, list)
  }

  const folders: ProposedFolder[] = []
  for (const [domain, messages] of byDomain) {
    if (messages.length < MIN_GROUP) {
      // A folder for two messages makes the rail worse than the inbox it tidied.
      reasons[`fewer than ${MIN_GROUP} messages from one sender`] =
        (reasons[`fewer than ${MIN_GROUP} messages from one sender`] ?? 0) + messages.length
      continue
    }
    folders.push({
      name: folderNameFor(domain),
      reason: `${messages.length} messages from ${domain} in the last ${windowDays} days`,
      messages,
    })
  }

  // Biggest groups first: the most useful folders should be the ones a reviewer
  // reads while their attention is freshest.
  folders.sort((a, b) => b.messages.length - a.messages.length)

  const filed = folders.reduce((n, f) => n + f.messages.length, 0)
  return {
    windowDays,
    folders,
    skipped: { count: candidates.length - filed, reasons },
  }
}

/** Total messages a plan would move — the number a human is approving. */
export function planSize(plan: FilingPlan): number {
  return plan.folders.reduce((n, f) => n + f.messages.length, 0)
}

/** One-line summary for the approval prompt. */
export function describePlan(plan: FilingPlan): string {
  const moves = planSize(plan)
  if (moves === 0) return `Nothing worth filing in the last ${plan.windowDays} days.`
  return (
    `File ${moves} message${moves === 1 ? '' : 's'} into ${plan.folders.length} ` +
    `folder${plan.folders.length === 1 ? '' : 's'}. ` +
    `${plan.skipped.count} left where they are.`
  )
}
