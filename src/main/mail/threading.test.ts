import { describe, it, expect } from 'vitest'
import { normalizeSubject, assignThreads, type ThreadableMessage } from './threading'

/**
 * Threading is precision-first: a missed thread costs an extra row, a FALSE
 * merge hides one person's mail behind another's. The tests below are weighted
 * accordingly — the "must not merge" cases matter more than the "should merge".
 */

const msg = (over: Partial<ThreadableMessage> & { key: string }): ThreadableMessage => ({
  messageId: null,
  inReplyTo: null,
  references: [],
  subject: '',
  ...over,
})

describe('normalizeSubject', () => {
  it('strips a single reply prefix', () => {
    expect(normalizeSubject('Re: Budget')).toBe('budget')
  })

  it('strips stacked and mixed-language prefixes', () => {
    // A real European mailbox accretes these: German Aw:/Wg:, Nordic Sv:.
    expect(normalizeSubject('Re: Fwd: Re: Budget')).toBe('budget')
    expect(normalizeSubject('AW: WG: Angebot')).toBe('angebot')
    expect(normalizeSubject('SV: Fw: Tilbud')).toBe('tilbud')
  })

  it('strips the numbered form some clients emit', () => {
    expect(normalizeSubject('Re[2]: Budget')).toBe('budget')
  })

  it('collapses whitespace and case', () => {
    expect(normalizeSubject('  Q3   BUDGET  ')).toBe('q3 budget')
  })

  it('leaves a subject that merely starts with "re" alone', () => {
    // "Reminder" must not become "minder".
    expect(normalizeSubject('Reminder: standup')).toBe('reminder: standup')
    expect(normalizeSubject('Review the deck')).toBe('review the deck')
  })
})

describe('assignThreads — chain based', () => {
  it('threads a reply to its parent via In-Reply-To', () => {
    const a = msg({ key: 'a', messageId: '<1@x>', subject: 'Budget' })
    const b = msg({ key: 'b', messageId: '<2@x>', inReplyTo: '<1@x>', subject: 'Re: Budget' })
    const t = assignThreads([a, b])
    expect(t.get('a')).toBe(t.get('b'))
  })

  it('threads a deep chain through References', () => {
    const a = msg({ key: 'a', messageId: '<1@x>' })
    const b = msg({ key: 'b', messageId: '<2@x>', references: ['<1@x>'] })
    const c = msg({ key: 'c', messageId: '<3@x>', references: ['<1@x>', '<2@x>'] })
    const t = assignThreads([a, b, c])
    expect(t.get('a')).toBe(t.get('b'))
    expect(t.get('b')).toBe(t.get('c'))
  })

  it('threads even when the parent has not been indexed yet', () => {
    // Incremental sync: two replies arrive before the message they answer.
    const b = msg({ key: 'b', messageId: '<2@x>', inReplyTo: '<1@x>' })
    const c = msg({ key: 'c', messageId: '<3@x>', inReplyTo: '<1@x>' })
    const t = assignThreads([b, c])
    expect(t.get('b')).toBe(t.get('c'))
  })

  it('keeps two genuinely separate conversations apart', () => {
    const a = msg({ key: 'a', messageId: '<1@x>', subject: 'Budget' })
    const b = msg({ key: 'b', messageId: '<9@y>', subject: 'Offsite' })
    const t = assignThreads([a, b])
    expect(t.get('a')).not.toBe(t.get('b'))
  })
})

describe('assignThreads — subject fallback', () => {
  it('groups chainless messages that share a normalised subject', () => {
    const a = msg({ key: 'a', subject: 'Budget' })
    const b = msg({ key: 'b', subject: 'Re: Budget' })
    const t = assignThreads([a, b])
    expect(t.get('a')).toBe(t.get('b'))
  })

  it('does NOT merge chainless messages with empty subjects', () => {
    // An empty subject is not evidence of a relationship.
    const a = msg({ key: 'a', subject: '' })
    const b = msg({ key: 'b', subject: '   ' })
    const t = assignThreads([a, b])
    expect(t.get('a')).not.toBe(t.get('b'))
  })

  it('does NOT pull a chained message into a same-subject thread', () => {
    // The riskiest false merge: a genuine conversation about "Invoice" must not
    // swallow an unrelated automated "Invoice" mail that has no chain.
    const a = msg({ key: 'a', messageId: '<1@x>', subject: 'Invoice' })
    const b = msg({ key: 'b', messageId: '<2@x>', inReplyTo: '<1@x>', subject: 'Re: Invoice' })
    const stray = msg({ key: 'stray', subject: 'Invoice' })
    const t = assignThreads([a, b, stray])
    expect(t.get('a')).toBe(t.get('b'))
    expect(t.get('stray')).not.toBe(t.get('a'))
  })

  it('does not merge different subjects', () => {
    const a = msg({ key: 'a', subject: 'Budget' })
    const b = msg({ key: 'b', subject: 'Offsite' })
    const t = assignThreads([a, b])
    expect(t.get('a')).not.toBe(t.get('b'))
  })
})

describe('assignThreads — stability', () => {
  it('gives every message a thread id', () => {
    const ms = [msg({ key: 'a' }), msg({ key: 'b', subject: 'x' })]
    const t = assignThreads(ms)
    expect(t.get('a')).toBeTruthy()
    expect(t.get('b')).toBeTruthy()
  })

  it('is independent of input order', () => {
    const a = msg({ key: 'a', messageId: '<1@x>' })
    const b = msg({ key: 'b', messageId: '<2@x>', inReplyTo: '<1@x>' })
    const c = msg({ key: 'c', messageId: '<3@x>', references: ['<1@x>'] })
    const forward = assignThreads([a, b, c])
    const reverse = assignThreads([c, b, a])
    // The id must be reproducible, or a persisted thread_id churns on every
    // re-index and the UI regroups conversations for no reason.
    expect(forward.get('a')).toBe(reverse.get('a'))
    expect(forward.get('b')).toBe(reverse.get('b'))
    expect(forward.get('c')).toBe(reverse.get('c'))
  })

  it('handles a single message', () => {
    const t = assignThreads([msg({ key: 'solo', messageId: '<1@x>' })])
    expect(t.get('solo')).toBe('solo')
  })

  it('handles an empty input', () => {
    expect(assignThreads([]).size).toBe(0)
  })
})
