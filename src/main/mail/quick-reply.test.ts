import { describe, it, expect } from 'vitest'
import {
  buildQuickReplyPrompt, canQuickReply, STANCES, MAX_CONTEXT_CHARS,
} from './quick-reply'

/**
 * The prompt IS the feature here, so the tests assert the constraints that stop
 * an AI reply being worse than no reply: never inventing specifics, never
 * running long, and never quietly softening a decline into a maybe.
 */

const base = {
  subject: 'Can you join Thursday?',
  fromName: 'Ana Meier',
  body: 'Are you free Thursday at 14:00 for the budget review?',
}

describe('STANCES', () => {
  it('offers three, and the middle one is not a weaker yes', () => {
    // Acknowledging without committing is the common case in business mail;
    // a yes/no pair forces people to fake one of them.
    expect(STANCES.map((s) => s.id)).toEqual(['positive', 'neutral', 'negative'])
    expect(STANCES[1].meaning).toMatch(/without committing/i)
  })

  it('labels by intent rather than tone', () => {
    expect(STANCES.map((s) => s.label)).toEqual(['Yes', 'Acknowledge', 'Decline'])
  })
})

describe('buildQuickReplyPrompt — stance is carried, not blurred', () => {
  it('tells the model to say yes plainly for positive', () => {
    const p = buildQuickReplyPrompt({ ...base, stance: 'positive' })
    expect(p).toMatch(/AGREES \/ ACCEPTS \/ CONFIRMS/)
    expect(p).toMatch(/without hedging/i)
  })

  it('forbids implying agreement for neutral', () => {
    const p = buildQuickReplyPrompt({ ...base, stance: 'neutral' })
    expect(p).toMatch(/NOT committing/i)
    expect(p).toMatch(/Do not imply agreement/i)
  })

  it('forbids false hope for negative', () => {
    // The failure that makes a declining reply useless: softening it into a
    // "maybe later" the user never meant.
    const p = buildQuickReplyPrompt({ ...base, stance: 'negative' })
    expect(p).toMatch(/unambiguous no/i)
    expect(p).toMatch(/Do not leave false hope/i)
  })
})

describe('buildQuickReplyPrompt — the anti-fabrication rules', () => {
  it('forbids inventing facts in every stance', () => {
    for (const s of ['positive', 'neutral', 'negative'] as const) {
      const p = buildQuickReplyPrompt({ ...base, stance: s })
      expect(p).toMatch(/[Nn]ever invent|[Dd]o not invent/)
    }
  })

  it('forbids inventing a date on a positive reply specifically', () => {
    // The dangerous one: "Yes, Thursday at 3pm works" when the user never said 3pm.
    const p = buildQuickReplyPrompt({ ...base, stance: 'positive' })
    expect(p).toMatch(/Do not invent a date, a number, a price/)
  })

  it('bounds the length', () => {
    expect(buildQuickReplyPrompt({ ...base, stance: 'positive' })).toMatch(/Two to four sentences/)
  })

  it('asks for the body only, so the draft is usable as-is', () => {
    const p = buildQuickReplyPrompt({ ...base, stance: 'neutral' })
    expect(p).toMatch(/Output ONLY the reply body/)
    expect(p).toMatch(/no quoted original/i)
  })

  it('asks it to match the original language', () => {
    // This mailbox is largely German; replying in English would be wrong.
    expect(buildQuickReplyPrompt({ ...base, stance: 'positive' })).toMatch(/Match the language/i)
  })
})

describe('buildQuickReplyPrompt — context handling', () => {
  it('includes the subject and sender', () => {
    const p = buildQuickReplyPrompt({ ...base, stance: 'positive' })
    expect(p).toContain('Can you join Thursday?')
    expect(p).toContain('Ana Meier')
  })

  it('truncates a huge original rather than sending an unbounded prompt', () => {
    const p = buildQuickReplyPrompt({ ...base, stance: 'positive', body: 'x'.repeat(50_000) })
    expect(p.length).toBeLessThan(MAX_CONTEXT_CHARS + 2000)
  })

  it('adds the sign-off and voice only when supplied', () => {
    const withName = buildQuickReplyPrompt({ ...base, stance: 'positive', selfName: 'Clemens', voice: 'warm, direct' })
    expect(withName).toMatch(/Sign off as Clemens/)
    expect(withName).toMatch(/Voice: warm, direct/)
    expect(buildQuickReplyPrompt({ ...base, stance: 'positive' })).not.toMatch(/Sign off as/)
  })

  it('survives a message with no body', () => {
    const p = buildQuickReplyPrompt({ ...base, stance: 'neutral', body: '' })
    expect(p).toContain('Can you join Thursday?')
  })
})

describe('canQuickReply', () => {
  it('needs something to reply to', () => {
    expect(canQuickReply('hello', 'subject')).toBe(true)
    expect(canQuickReply('', 'subject only')).toBe(true)
    expect(canQuickReply('body only', '')).toBe(true)
    expect(canQuickReply('', '')).toBe(false)
    expect(canQuickReply('   ', '  ')).toBe(false)
  })
})
