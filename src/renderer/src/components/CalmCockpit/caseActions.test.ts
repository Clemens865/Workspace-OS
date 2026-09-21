import { describe, expect, it } from 'vitest'
import { caseRunId } from './caseActions'

/**
 * Main rejects any run id failing this pattern (handlers/agent.ts) BEFORE the
 * agent starts. Case ids are title slugs of up to sixty characters, and
 * `case-<id>-<ts>` sailed past the cap — so on any realistically-titled case
 * every hand-off died at validation, silently. Mirrored here so the contract
 * breaking again fails a test instead of a person.
 */
const MAIN_RUN_ID = /^[a-z0-9-]{6,40}$/

describe('caseRunId', () => {
  it('fits the main-process validator even for the longest possible slug', () => {
    const longest = 'enterprise-ai-architect-alpla-and-then-some-more-words-here!'.slice(0, 60)
    expect(caseRunId(longest)).toMatch(MAIN_RUN_ID)
  })

  it('fits for the real case id that surfaced the bug', () => {
    expect(caseRunId('enterprise-ai-architect-alpla')).toMatch(MAIN_RUN_ID)
  })

  it('keeps a readable slice of the case id, for run listings', () => {
    expect(caseRunId('head-of-product-fonio')).toContain('head-of-product')
  })

  it('survives an id with nothing usable in it', () => {
    expect(caseRunId('ÄÖÜ!!')).toMatch(MAIN_RUN_ID)
  })

  it('distinguishes two runs of the same case by time', () => {
    expect(caseRunId('same-case', 1000)).not.toBe(caseRunId('same-case', 1001))
  })

  it('distinguishes simultaneous runs with the same truncated slug', () => {
    expect(caseRunId('enterprise-ai-architect-one', 1000)).not.toBe(caseRunId('enterprise-ai-architect-two', 1000))
  })
})
