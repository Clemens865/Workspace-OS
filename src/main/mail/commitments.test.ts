import { describe, it, expect } from 'vitest'
import {
  extractCommitments, splitSentences, findWhen, summarise, commitmentId,
} from './commitments'

/**
 * This is the piece most likely to produce confident nonsense, so the tests are
 * weighted heavily toward FALSE POSITIVES. A missed commitment costs nothing —
 * the mail is still in the inbox. A fabricated one erodes trust in the whole
 * surface, and the cockpit's own rules forbid invented signals.
 */

const sent = (body: string) => ({
  accountId: 'a', folder: 'Sent', uid: 1, subject: 'Re: Deck', body, fromSelf: true,
})
const received = (body: string) => ({
  accountId: 'a', folder: 'INBOX', uid: 2, subject: 'Deck', body, fromSelf: false,
})

describe('extractCommitments — what it should find', () => {
  it('finds a first-person promise the user made', () => {
    const [c] = extractCommitments(sent("I'll send the deck on Friday."))
    expect(c.side).toBe('mine')
    expect(c.whenText?.toLowerCase()).toContain('friday')
  })

  it('finds a promise made TO the user in a received message', () => {
    const [c] = extractCommitments(received('I will get you the numbers by Monday.'))
    expect(c.side).toBe('theirs')
  })

  it('finds a German promise — this mailbox is largely German', () => {
    const [c] = extractCommitments(sent('Ich schicke dir die Unterlagen bis Freitag.'))
    expect(c.side).toBe('mine')
    expect(c.whenText?.toLowerCase()).toContain('freitag')
  })

  it('carries the FULL sentence as provenance, never just the summary', () => {
    // The rule that makes this trustworthy: the user can see the words that
    // produced the claim, and disagree with them.
    const body = "I'll send the deck on Friday."
    const [c] = extractCommitments(sent(body))
    expect(c.sentence).toBe(body)
    expect(body.slice(c.offset)).toContain("I'll send")
  })
})

describe('extractCommitments — what it must NOT find', () => {
  it('does not treat a QUESTION as a promise', () => {
    // "Can you send the deck by Friday?" is someone else's ask.
    expect(extractCommitments(received('Can you send the deck by Friday?'))).toEqual([])
    expect(extractCommitments(sent('Will I send the deck Friday?'))).toEqual([])
  })

  it('does not treat a REFUSAL as a promise', () => {
    // The nastiest false positive: recording "I will" out of "I will not".
    expect(extractCommitments(sent("I won't be able to send the deck."))).toEqual([])
    expect(extractCommitments(sent('I cannot send the deck this week.'))).toEqual([])
    expect(extractCommitments(sent('Ich kann nicht kommen.'))).toEqual([])
  })

  it('does not mine QUOTED history, which would double-report old promises', () => {
    expect(extractCommitments(sent("> I'll send the deck on Friday."))).toEqual([])
  })

  it('does not invent a commitment from ordinary prose', () => {
    expect(extractCommitments(sent('The deck is attached. Thanks for the review.'))).toEqual([])
    expect(extractCommitments(received('Please find the numbers attached.'))).toEqual([])
  })

  it('does not treat someone else’s promise as the user’s own', () => {
    // Side is decided by WHO WROTE the message, not by the words. "I owe this"
    // and "they owe me" prompt completely different actions.
    const [mine] = extractCommitments(sent("I'll send it."))
    const [theirs] = extractCommitments(received("I'll send it."))
    expect(mine.side).toBe('mine')
    expect(theirs.side).toBe('theirs')
  })

  it('finds nothing in an empty or trivial body', () => {
    expect(extractCommitments(sent(''))).toEqual([])
    expect(extractCommitments(sent('ok'))).toEqual([])
  })
})

describe('findWhen', () => {
  it('captures a date phrase AS WRITTEN, never parsed', () => {
    // Parsing "Friday" into a real date requires knowing which Friday, which we
    // do not — a wrong date on a commitment is worse than none.
    expect(findWhen("I'll send it Friday.")?.toLowerCase()).toContain('friday')
    expect(findWhen('by end of week')?.toLowerCase()).toContain('end of')
    expect(findWhen('bis 05.08.')).toContain('05.08')
  })

  it('is null when no date is mentioned', () => {
    expect(findWhen("I'll send the deck.")).toBeNull()
  })
})

describe('summarise', () => {
  it('trims the promise opener so the list reads as actions', () => {
    expect(summarise("I'll send the deck on Friday.")).toBe('send the deck on Friday.')
  })

  it('bounds the length', () => {
    expect(summarise(`I will ${'x'.repeat(400)}`).length).toBeLessThanOrEqual(120)
  })

  it('never returns empty, even for a sentence that is only an opener', () => {
    expect(summarise("I'll.").length).toBeGreaterThan(0)
  })
})

describe('splitSentences', () => {
  it('keeps offsets so the UI can highlight the source', () => {
    const body = 'First one here. Second one there.'
    const parts = splitSentences(body)
    expect(parts).toHaveLength(2)
    expect(body.slice(parts[1].offset).trim().startsWith('Second')).toBe(true)
  })

  it('skips fragments too short to be a sentence', () => {
    expect(splitSentences('ok. no.')).toEqual([])
  })
})

describe('commitmentId', () => {
  it('is stable across re-scans of the same message', () => {
    const [c] = extractCommitments(sent("I'll send the deck Friday."))
    expect(commitmentId(c)).toBe(commitmentId(extractCommitments(sent("I'll send the deck Friday."))[0]))
  })

  it('distinguishes two commitments in one message', () => {
    const two = extractCommitments(sent("I'll send the deck Friday. I will call you Monday."))
    expect(two).toHaveLength(2)
    expect(commitmentId(two[0])).not.toBe(commitmentId(two[1]))
  })
})
