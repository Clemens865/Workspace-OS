/**
 * Commitment extraction — "you said you'd send the deck Friday".
 *
 * This is the differentiator and the piece most likely to produce confident
 * nonsense, so it is built the opposite way round from how these usually are.
 *
 * **Provenance is mandatory.** Every commitment carries the exact sentence it
 * came from and a link back to the message. This is the same rule the memory
 * system enforces (`remember()` throws without a source) and for the same
 * reason: an unattributable claim presented confidently is worse than no claim
 * at all. A user must be able to look at any commitment and see, in one glance,
 * the words that produced it — and disagree.
 *
 * **It is deliberately conservative and deterministic.** No model call: a
 * regex-and-heuristics pass over sentences the USER wrote, tuned for precision.
 * A missed commitment costs nothing — the mail is still in the inbox. A
 * fabricated one erodes trust in the whole surface, and the cockpit's own rules
 * forbid fabricated signals. When it is unsure, it says nothing.
 *
 * Detecting only FIRST-PERSON commitments is the core precision trick: "can you
 * send the deck by Friday" is someone else's ask, not a promise you made, and
 * conflating the two fills the list with things you never agreed to.
 */

export interface Commitment {
  /** What was promised, as a short phrase. */
  what: string
  /** The FULL sentence it came from — mandatory provenance, never trimmed away. */
  sentence: string
  /** A due date phrase as written ("Friday", "by the 5th"), or null. */
  whenText: string | null
  /** 'mine' = the user promised; 'theirs' = the user is waiting on someone. */
  side: 'mine' | 'theirs'
  /** Character offset of the sentence in the body — lets the UI highlight it. */
  offset: number
}

export interface CommitmentSource {
  accountId: string
  folder: string
  uid: number
  subject: string
  /** Plain-text body. */
  body: string
  /** True when the user WROTE this message (a Sent-folder message). */
  fromSelf: boolean
}

export interface ExtractedCommitment extends Commitment {
  accountId: string
  folder: string
  uid: number
  subject: string
}

/** First-person promise openers. Deliberately narrow. */
const MINE_RE =
  /\b(?:i(?:'| a)?m going to|i will|i'll|i shall|let me|i can (?:do|send|get|have)|i'?ve? got it|will send|will get|will have|i promise to|ich werde|ich schicke|ich sende|ich melde mich)\b/i

/** Someone else committing TO the user — "I'll send it" in a received mail. */
const THEIRS_RE = /\b(?:i will|i'll|we will|we'll|i'?ll get|we can have|ich schicke|wir schicken|wir melden uns)\b/i

/** Phrases that look like promises but are not — the main false-positive source. */
const NEGATION_RE =
  /\b(?:i (?:will not|won't|can't|cannot)|unfortunately i (?:can|will)|i am not able|ich kann nicht|ich werde nicht)\b/i

/** A question is a request, not a promise, however it is phrased. */
const QUESTION_RE = /\?\s*$/

/** Date-ish phrases, in English and German. Captured verbatim, never parsed. */
const WHEN_RE =
  /\b(?:by |before |on |until |bis |am |vor )?(?:today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|heute|morgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|next week|this week|end of (?:the )?(?:day|week|month)|eod|eow|n[äa]chste woche|\d{1,2}\.\d{1,2}\.?(?:\d{2,4})?|\d{1,2}(?:st|nd|rd|th))\b/i

/** Splits into sentences, keeping each one's offset for provenance highlighting. */
export function splitSentences(text: string): { text: string; offset: number }[] {
  const out: { text: string; offset: number }[] = []
  const re = /[^.!?\n]+[.!?]*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text || '')) !== null) {
    const trimmed = m[0].trim()
    if (trimmed.length >= 8) out.push({ text: trimmed, offset: m.index })
  }
  return out
}

/** Extracts a due-date phrase as WRITTEN. Never parsed into a real date. */
export function findWhen(sentence: string): string | null {
  const m = WHEN_RE.exec(sentence)
  return m ? m[0].trim() : null
}

/**
 * Condenses a sentence into a short "what". Trims the promise opener so the
 * list reads as actions rather than as repeated "I will …" lines.
 */
export function summarise(sentence: string): string {
  let s = sentence.replace(/^\s*(?:and|but|so|also)\b\s*/i, '').trim()
  s = s.replace(MINE_RE, '').replace(/^\s*[,:-]\s*/, '').trim()
  s = s.replace(/\s+/g, ' ')
  if (s.length > 120) s = s.slice(0, 119).trimEnd() + '…'
  return s || sentence.slice(0, 120)
}

/**
 * Finds commitments in one message.
 *
 * A message the USER sent yields 'mine' (things they promised). A received
 * message yields 'theirs' (things they are waiting on). Both are useful and
 * they are never mixed up, because "I owe this" and "they owe me" prompt
 * completely different actions.
 */
export function extractCommitments(source: CommitmentSource): ExtractedCommitment[] {
  const out: ExtractedCommitment[] = []
  const pattern = source.fromSelf ? MINE_RE : THEIRS_RE
  const side: 'mine' | 'theirs' = source.fromSelf ? 'mine' : 'theirs'

  for (const { text, offset } of splitSentences(source.body)) {
    if (QUESTION_RE.test(text)) continue // a request, not a promise
    if (NEGATION_RE.test(text)) continue // "I won't be able to" is the opposite
    if (!pattern.test(text)) continue
    // Quoted history re-states old promises; counting them double-reports.
    if (/^\s*>/.test(text)) continue

    out.push({
      what: summarise(text),
      sentence: text,
      whenText: findWhen(text),
      side,
      offset,
      accountId: source.accountId,
      folder: source.folder,
      uid: source.uid,
      subject: source.subject,
    })
  }
  return out
}

/** Stable id so the same commitment is not surfaced twice across re-scans. */
export function commitmentId(c: ExtractedCommitment): string {
  return `${c.accountId}:${c.folder}:${c.uid}:${c.offset}`
}
