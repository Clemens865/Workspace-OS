/**
 * PURE message threading — grouping messages into conversations.
 *
 * No SQLite, no IMAP, no I/O: given the identity headers of a set of messages,
 * decide which conversation each belongs to. Kept pure for the same reason
 * `triage.ts` is — the whole "which messages are one thread" decision stays
 * unit-verifiable against fixtures, without a live mailbox.
 *
 * The approach is the useful half of JWZ's algorithm, minus the parts that
 * assume a complete corpus (we index incrementally, so a parent may not have
 * arrived yet):
 *
 *   1. Union messages that share ANY Message-ID across their
 *      References / In-Reply-To chains. This is authoritative — those headers
 *      exist precisely to express reply structure.
 *   2. Fall back to a normalised subject ONLY for messages with no usable
 *      chain at all. Subject matching is a guess and is treated as one.
 *
 * Why the fallback is deliberately weak: two unrelated mails titled "Hi" are not
 * a conversation, and merging them would hide one behind the other. A missed
 * thread merely shows two rows; a false merge loses mail. Precision over recall,
 * the same trade `triage.ts` makes.
 */

/** The identity headers threading needs from one message. */
export interface ThreadableMessage {
  /** Stable local key for this message (`${accountId}:${folder}:${uid}`). */
  key: string
  /** RFC Message-ID, if the server gave us one. */
  messageId: string | null
  /** Parent Message-ID from In-Reply-To. */
  inReplyTo: string | null
  /** Full References chain, oldest first. */
  references: string[]
  subject: string
}

/** Strips the reply/forward prefixes that accrete on a subject line. */
const PREFIX_RE = /^\s*(?:(?:re|aw|fwd?|wg|sv|vs|antw|rif|ref)\s*(?:\[\d+\])?\s*:\s*)+/i

/**
 * Normalises a subject for fallback matching: strips Re:/Fwd:/Aw:/Wg: chains
 * (including the German and Nordic forms a real European mailbox is full of),
 * collapses whitespace, lowercases.
 */
export function normalizeSubject(subject: string): string {
  let s = (subject || '').trim()
  // Loop: "Re: Fwd: Re: x" needs repeated stripping, and the regex is anchored.
  for (;;) {
    const stripped = s.replace(PREFIX_RE, '')
    if (stripped === s) break
    s = stripped
  }
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Every Message-ID this message claims a relationship to, including its own. */
function idsOf(m: ThreadableMessage): string[] {
  const ids = [...m.references, m.inReplyTo, m.messageId]
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    .map((x) => x.trim())
  return [...new Set(ids)]
}

/**
 * True when the message participates in a real reply chain, so the subject
 * fallback must NOT touch it.
 *
 * Two ways to qualify, and the second is easy to miss: a message that *starts* a
 * thread has no In-Reply-To and no References of its own, yet it is unmistakably
 * chained — its replies point at it. Judging it chainless lets the subject
 * fallback merge an unrelated same-subject mail into a live conversation, which
 * is the worst failure this module has (one person's mail hidden behind
 * another's). So membership is decided against the whole corpus, not the message
 * alone.
 */
function hasChain(m: ThreadableMessage, referencedIds: Set<string>): boolean {
  const own = m.messageId?.trim()
  if (idsOf(m).some((id) => id !== own)) return true
  return Boolean(own && referencedIds.has(own))
}

/** Every Message-ID that some OTHER message points at (In-Reply-To / References). */
function collectReferenced(messages: ThreadableMessage[]): Set<string> {
  const out = new Set<string>()
  for (const m of messages) {
    const own = m.messageId?.trim()
    for (const id of [...m.references, m.inReplyTo]) {
      const v = id?.trim()
      if (v && v !== own) out.add(v)
    }
  }
  return out
}

/** Minimal union-find over string keys. */
class Unions {
  private parent = new Map<string, string>()

  find(x: string): string {
    let root = this.parent.get(x)
    if (root === undefined) {
      this.parent.set(x, x)
      return x
    }
    while (root !== this.parent.get(root)) root = this.parent.get(root)!
    // Path compression keeps repeated lookups flat on a long thread.
    let cur = x
    while (cur !== root) {
      const next = this.parent.get(cur)!
      this.parent.set(cur, root)
      cur = next
    }
    return root
  }

  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

/**
 * Assigns every message a thread id. Messages sharing a reply chain get the same
 * id; chainless messages fall back to their normalised subject.
 *
 * The returned id is stable for a given input set and is safe to persist: it is
 * derived from the earliest Message-ID in the conversation (or the normalised
 * subject), not from iteration order.
 */
export function assignThreads(messages: ThreadableMessage[]): Map<string, string> {
  const u = new Unions()

  // 1. Chain-based union — authoritative.
  for (const m of messages) {
    const ids = idsOf(m)
    // Bind the message key to its own identity space so chainless messages
    // still get a component of their own.
    u.union(`k:${m.key}`, ids.length ? `m:${ids[0]}` : `k:${m.key}`)
    for (const id of ids) u.union(`m:${ids[0]}`, `m:${id}`)
  }

  // 2. Subject fallback — ONLY for messages with no chain at all, and only
  //    joining them to each other, never to an established chain thread.
  const referencedIds = collectReferenced(messages)
  const bySubject = new Map<string, string[]>()
  for (const m of messages) {
    if (hasChain(m, referencedIds)) continue
    const norm = normalizeSubject(m.subject)
    if (!norm) continue // an empty subject is not evidence of anything
    const list = bySubject.get(norm) ?? []
    list.push(m.key)
    bySubject.set(norm, list)
  }
  for (const keys of bySubject.values()) {
    for (let i = 1; i < keys.length; i++) u.union(`k:${keys[0]}`, `k:${keys[i]}`)
  }

  // 3. Emit a stable, human-meaningless id per component: the smallest
  //    member label in the component, so it does not depend on input order.
  const membersByRoot = new Map<string, string[]>()
  for (const m of messages) {
    const root = u.find(`k:${m.key}`)
    const list = membersByRoot.get(root) ?? []
    list.push(m.key)
    membersByRoot.set(root, list)
  }

  const out = new Map<string, string>()
  for (const [, keys] of membersByRoot) {
    const id = [...keys].sort()[0]
    for (const k of keys) out.set(k, id)
  }
  return out
}
