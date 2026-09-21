import { describe, it, expect } from 'vitest'
import { buildNewsletterSweep, NEWSLETTER_FOLDER } from './newsletter-sweep'
import type { MailRule } from './classify'
import type { IndexedRow } from './mail-index'

/**
 * The sweep proposes; it never moves. So what matters here is what it OFFERS —
 * in particular that it never offers to file something the person would then
 * go looking for in the inbox and not find.
 */

const NOW = Date.UTC(2026, 7, 18, 12, 0)
const DAY = 86_400_000

const row = (over: Partial<IndexedRow> & { uid: number }): IndexedRow => ({
  accountId: 'a',
  folder: 'INBOX',
  messageId: null,
  threadId: '',
  subject: '',
  fromName: '',
  fromAddress: 'x@example.com',
  date: NOW,
  seen: false,
  hasAttachments: false,
  snippet: '',
  ...over,
})

const NEWSLETTER = { list: true, unsubscribe: true, machine: true }
const PERSONAL = { list: false, unsubscribe: false, machine: false }
const NOTIFICATION = { list: true, unsubscribe: false, machine: true }

describe('buildNewsletterSweep', () => {
  it('offers the newsletters and nothing else', () => {
    const s = buildNewsletterSweep(
      [
        row({ uid: 1, subject: 'Weekly digest', fromName: 'TLDR', fromAddress: 'a@tldr.com', signals: NEWSLETTER }),
        row({ uid: 2, subject: 'Re: Thursday', fromName: 'Anna', fromAddress: 'anna@x.de', signals: PERSONAL }),
        row({ uid: 3, subject: 'Build failed', fromAddress: 'ci@github.com', signals: NOTIFICATION }),
      ],
      [],
      { now: NOW },
    )
    expect(s.messages.map((m) => m.uid)).toEqual([1])
    expect(s.folder).toBe(NEWSLETTER_FOLDER)
  })

  /**
   * No signals means the index never looked, which is NOT the same as "not a
   * newsletter". Counting them lets the proposal admit what it could not see.
   */
  it('never files what it could not check, and says how many', () => {
    const s = buildNewsletterSweep([row({ uid: 1 }), row({ uid: 2 })], [], { now: NOW })
    expect(s.messages).toEqual([])
    expect(s.unknown).toBe(2)
    expect(s.summary).toContain('still to read')
  })

  it('respects a rule, so a correction holds here too', () => {
    const rules: MailRule[] = [{ id: 'r', domain: 'github.com', category: 'notification' }]
    const rows = [row({ uid: 1, subject: 'Weekly digest', fromAddress: 'n@github.com', signals: NEWSLETTER })]
    expect(buildNewsletterSweep(rows, [], { now: NOW }).messages).toHaveLength(1)
    expect(buildNewsletterSweep(rows, rules, { now: NOW }).messages).toHaveLength(0)
  })

  it('leaves anything older than the window alone', () => {
    const s = buildNewsletterSweep(
      [
        row({ uid: 1, date: NOW - 5 * DAY, signals: NEWSLETTER }),
        row({ uid: 2, date: NOW - 60 * DAY, signals: NEWSLETTER }),
      ],
      [],
      { now: NOW, days: 30 },
    )
    expect(s.messages.map((m) => m.uid)).toEqual([1])
  })

  /** Proposing to move mail into the folder it is already in is noise. */
  it('does not offer to file what is already filed', () => {
    const s = buildNewsletterSweep(
      [row({ uid: 1, folder: NEWSLETTER_FOLDER, signals: NEWSLETTER })],
      [],
      { now: NOW },
    )
    expect(s.messages).toEqual([])
  })

  it('names who they are from, so the person can check before pressing', () => {
    const s = buildNewsletterSweep(
      [
        row({ uid: 1, fromName: 'TLDR', fromAddress: 'a@tldr.com', signals: NEWSLETTER }),
        row({ uid: 2, fromName: 'TLDR', fromAddress: 'a@tldr.com', signals: NEWSLETTER }),
        row({ uid: 3, fromName: 'Substack', fromAddress: 'b@substack.com', signals: NEWSLETTER }),
      ],
      [],
      { now: NOW },
    )
    expect(s.senders.map((x) => `${x.label}×${x.count}`)).toEqual(['TLDR×2', 'Substack×1'])
    expect(s.summary).toBe('3 newsletters from the last 30 days — TLDR, Substack.')
  })

  it('has a calm thing to say when there is nothing to do', () => {
    expect(buildNewsletterSweep([], [], { now: NOW }).summary).toBe('No newsletters in the last 30 days.')
  })

  it('keeps a message with no date rather than guessing it is old', () => {
    const s = buildNewsletterSweep([row({ uid: 1, date: null, signals: NEWSLETTER })], [], { now: NOW })
    expect(s.messages).toHaveLength(1)
  })
})
