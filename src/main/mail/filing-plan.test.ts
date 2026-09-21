import { describe, it, expect } from 'vitest'
import {
  buildFilingPlan, domainOf, folderNameFor, withinWindow, planSize, describePlan,
  MIN_GROUP, type FilingCandidate,
} from './filing-plan'

const NOW = Date.UTC(2026, 7, 8)
const daysAgo = (n: number): number => NOW - n * 86_400_000

const msg = (over: Partial<FilingCandidate> & { uid: number }): FilingCandidate => ({
  accountId: 'a', folder: 'INBOX', messageId: `<${over.uid}@x>`,
  subject: 's', fromName: 'Ana', fromAddress: 'ana@acme.com',
  date: daysAgo(1), seen: true, ...over,
})

/** n messages from one sender, so a group clears MIN_GROUP. */
const group = (n: number, address: string, over: Partial<FilingCandidate> = {}) =>
  Array.from({ length: n }, (_, i) => msg({ uid: i + 1, fromAddress: address, ...over }))

describe('domainOf', () => {
  it('extracts the domain', () => {
    expect(domainOf('ana@acme.com')).toBe('acme.com')
  })

  it('collapses mail subdomains so one sender does not fragment', () => {
    // Otherwise LinkedIn alone produces three folders.
    expect(domainOf('x@mail.linkedin.com')).toBe('linkedin.com')
    expect(domainOf('x@notifications.linkedin.com')).toBe('linkedin.com')
    expect(domainOf('x@no-reply.github.com')).toBe('github.com')
  })

  it('is empty for a malformed address', () => {
    expect(domainOf('not-an-address')).toBe('')
    expect(domainOf('')).toBe('')
  })
})

describe('folderNameFor', () => {
  it('produces a human name', () => {
    expect(folderNameFor('linkedin.com')).toBe('Linkedin')
    expect(folderNameFor('acme-corp.com')).toBe('Acme Corp')
  })
})

describe('withinWindow', () => {
  it('includes recent and excludes old', () => {
    expect(withinWindow(daysAgo(3), 7, NOW)).toBe(true)
    expect(withinWindow(daysAgo(30), 7, NOW)).toBe(false)
    expect(withinWindow(daysAgo(30), 90, NOW)).toBe(true)
  })

  it('excludes an undated message rather than guessing', () => {
    expect(withinWindow(null, 90, NOW)).toBe(false)
  })
})

describe('buildFilingPlan — the safety rules', () => {
  it('NEVER files unread mail', () => {
    // The one class where being wrong is invisible: a moved unread message may
    // simply never be read.
    const plan = buildFilingPlan(group(10, 'news@acme.com', { seen: false }), 30, NOW)
    expect(plan.folders).toEqual([])
    expect(plan.skipped.reasons['unread — never filed']).toBe(10)
  })

  it('never files a message with no Message-ID, because the move could not be undone', () => {
    const plan = buildFilingPlan(group(10, 'news@acme.com', { messageId: '' }), 30, NOW)
    expect(plan.folders).toEqual([])
    expect(plan.skipped.reasons['no Message-ID, so the move could not be undone']).toBe(10)
  })

  it('respects the window rather than filing the whole mailbox', () => {
    const plan = buildFilingPlan(group(10, 'news@acme.com', { date: daysAgo(200) }), 90, NOW)
    expect(plan.folders).toEqual([])
    expect(plan.skipped.reasons['outside the last 90 days']).toBe(10)
  })

  it('leaves small groups alone instead of making a folder for two messages', () => {
    // A folder per stray sender makes the rail worse than the inbox it tidied.
    const plan = buildFilingPlan(group(MIN_GROUP - 1, 'rare@acme.com'), 30, NOW)
    expect(plan.folders).toEqual([])
  })

  it('does NOT sweep leftovers into a Misc folder', () => {
    // "Misc" is a folder nobody ever opens; the honest answer is "stays put".
    const plan = buildFilingPlan(
      [...group(6, 'news@acme.com'), ...group(2, 'rare@other.com').map((m, i) => ({ ...m, uid: 90 + i }))],
      30, NOW,
    )
    expect(plan.folders.map((f) => f.name)).toEqual(['Acme'])
    expect(plan.skipped.count).toBe(2)
  })
})

describe('buildFilingPlan — the proposal', () => {
  it('groups by sender domain and names the folder', () => {
    const plan = buildFilingPlan(group(6, 'jobs@linkedin.com'), 30, NOW)
    expect(plan.folders).toHaveLength(1)
    expect(plan.folders[0].name).toBe('Linkedin')
    expect(plan.folders[0].messages).toHaveLength(6)
  })

  it('explains each group in plain language', () => {
    const plan = buildFilingPlan(group(6, 'jobs@linkedin.com'), 30, NOW)
    expect(plan.folders[0].reason).toMatch(/6 messages from linkedin\.com in the last 30 days/)
  })

  it('puts the biggest groups first, where attention is freshest', () => {
    const plan = buildFilingPlan(
      [
        ...group(5, 'a@small.com'),
        ...group(9, 'b@big.com').map((m, i) => ({ ...m, uid: 100 + i })),
      ],
      30, NOW,
    )
    expect(plan.folders.map((f) => f.name)).toEqual(['Big', 'Small'])
  })

  it('reports the size a human is approving', () => {
    const plan = buildFilingPlan(group(6, 'a@acme.com'), 30, NOW)
    expect(planSize(plan)).toBe(6)
    expect(describePlan(plan)).toMatch(/File 6 messages into 1 folder/)
  })

  it('says so plainly when there is nothing worth filing', () => {
    expect(describePlan(buildFilingPlan([], 7, NOW))).toMatch(/Nothing worth filing/)
  })
})
