import { describe, it, expect } from 'vitest'
import {
  triageMessages,
  classifyMessage,
  isAutomatedSender,
  isBulkOrList,
  isDirectRecipient,
  hasQuestion,
  toTriageMessage,
  type TriageMessage,
} from './triage'
import type { MailAddress } from './message-parser'

/**
 * PURE triage tests over fixtures — no IMAP, no network. Each fixture is one
 * class of inbound mail; we assert the gate (flagged vs not), the reason and
 * the ranking.
 */

const SELF = 'me@example.com'
const addr = (address: string, name = ''): MailAddress => ({ name, address })

function msg(over: Partial<TriageMessage> = {}): TriageMessage {
  return {
    uid: 100,
    folder: 'INBOX',
    subject: 'Hi',
    from: [addr('colleague@example.com', 'Colleague')],
    to: [addr(SELF, 'Me')],
    cc: [],
    text: 'Just checking in.',
    seen: false,
    headers: {},
    ...over,
  }
}

describe('isAutomatedSender', () => {
  it('flags noreply / do-not-reply / mailer-daemon / bounce / postmaster', () => {
    expect(isAutomatedSender([addr('noreply@shop.com')])).toBe(true)
    expect(isAutomatedSender([addr('do-not-reply@bank.com')])).toBe(true)
    expect(isAutomatedSender([addr('mailer-daemon@mx.example')])).toBe(true)
    expect(isAutomatedSender([addr('bounces@mailer.example')])).toBe(true)
    expect(isAutomatedSender([addr('postmaster@example.com')])).toBe(true)
  })
  it('treats a missing sender as automated (nothing to reply to)', () => {
    expect(isAutomatedSender([])).toBe(true)
  })
  it('does not flag a normal human sender', () => {
    expect(isAutomatedSender([addr('alice@example.com', 'Alice')])).toBe(false)
  })
})

describe('isBulkOrList', () => {
  it('flags List-Unsubscribe / List-Id', () => {
    expect(isBulkOrList({ 'list-unsubscribe': '<mailto:u@x>' })).toBe(true)
    expect(isBulkOrList({ 'list-id': 'news.example.com' })).toBe(true)
  })
  it('flags Precedence: bulk / list and Auto-Submitted', () => {
    expect(isBulkOrList({ precedence: 'bulk' })).toBe(true)
    expect(isBulkOrList({ precedence: 'list' })).toBe(true)
    expect(isBulkOrList({ 'auto-submitted': 'auto-generated' })).toBe(true)
  })
  it('does not flag ordinary mail (no list headers, auto-submitted: no)', () => {
    expect(isBulkOrList({})).toBe(false)
    expect(isBulkOrList(undefined)).toBe(false)
    expect(isBulkOrList({ 'auto-submitted': 'no' })).toBe(false)
  })
})

describe('isDirectRecipient', () => {
  it('true when the user is on To or Cc (case-insensitive)', () => {
    expect(isDirectRecipient(msg({ to: [addr('ME@Example.com')] }), SELF)).toBe(true)
    expect(isDirectRecipient(msg({ to: [addr('x@y.com')], cc: [addr(SELF)] }), SELF)).toBe(true)
  })
  it('false when the user is neither To nor Cc (bcc / list-only)', () => {
    expect(isDirectRecipient(msg({ to: [addr('list@x.com')], cc: [] }), SELF)).toBe(false)
  })
})

describe('hasQuestion', () => {
  it('true for a question mark or a direct-ask phrase', () => {
    expect(hasQuestion('Are you free Tuesday?')).toBe(true)
    expect(hasQuestion('Please confirm the numbers.')).toBe(true)
    expect(hasQuestion('Could you review this')).toBe(true)
  })
  it('false for a plain statement', () => {
    expect(hasQuestion('Thanks for the update.')).toBe(false)
  })
})

describe('classifyMessage — gates', () => {
  it('FLAGS a human message that needs a reply, with a reason', () => {
    const hit = classifyMessage(
      msg({ from: [addr('alice@example.com', 'Alice')], subject: 'Can we meet?', text: 'Are you free Tuesday?' }),
      SELF,
    )
    expect(hit).not.toBeNull()
    expect(hit!.subject).toBe('Can we meet?')
    expect(hit!.from?.address).toBe('alice@example.com')
    expect(hit!.hasQuestion).toBe(true)
    expect(hit!.reason).toContain('asks a question')
    expect(hit!.score).toBeGreaterThan(60)
  })
  it('does NOT flag a no-reply / automated message', () => {
    expect(classifyMessage(msg({ from: [addr('noreply@shop.com')], text: 'Your order shipped?' }), SELF)).toBeNull()
  })
  it('does NOT flag a bulk / mailing-list message', () => {
    expect(
      classifyMessage(msg({ headers: { 'list-unsubscribe': '<mailto:u@x>' }, text: 'Weekly digest — top stories?' }), SELF),
    ).toBeNull()
  })
  it('does NOT flag when the user is not a direct recipient (bcc / list-only)', () => {
    expect(classifyMessage(msg({ to: [addr('everyone@list.com')], cc: [] }), SELF)).toBeNull()
  })
  it('does NOT flag an already-read message', () => {
    expect(classifyMessage(msg({ seen: true, text: 'Any thoughts?' }), SELF)).toBeNull()
  })
})

describe('classifyMessage — scoring & reasons', () => {
  it('a Cc-only recipient scores lower and reads "you are Cc’d"', () => {
    const to = classifyMessage(msg({ to: [addr(SELF)], cc: [] }), SELF)
    const cc = classifyMessage(msg({ to: [addr('other@x.com')], cc: [addr(SELF)] }), SELF)
    expect(to!.score).toBeGreaterThan(cc!.score)
    expect(cc!.reason).toContain('Cc')
  })
  it('a sole-recipient direct ask ranks highest', () => {
    const sole = classifyMessage(
      msg({ to: [addr(SELF)], cc: [], text: 'Please advise on the budget?' }),
      SELF,
    )
    expect(sole!.reason).toContain('sent only to you')
    expect(sole!.score).toBeGreaterThanOrEqual(90)
  })
})

describe('triageMessages — batch + ranking', () => {
  it('returns only the hits, ranked by score then uid (newest first)', () => {
    const messages: TriageMessage[] = [
      msg({ uid: 1, from: [addr('noreply@x.com')] }), // dropped: automated
      msg({ uid: 2, headers: { precedence: 'bulk' } }), // dropped: bulk
      msg({ uid: 3, seen: true }), // dropped: read
      msg({ uid: 4, to: [addr(SELF)], cc: [], text: 'Can you confirm?' }), // hit, high
      msg({ uid: 5, to: [addr('x@y.com')], cc: [addr(SELF)], text: 'FYI' }), // hit, low (cc, no q)
    ]
    const out = triageMessages(messages, SELF)
    expect(out.map((h) => h.uid)).toEqual([4, 5])
    expect(out[0].score).toBeGreaterThan(out[1].score)
  })

  it('breaks score ties by uid (newest first)', () => {
    const a = msg({ uid: 10, to: [addr(SELF)], cc: [], text: 'ping' })
    const b = msg({ uid: 20, to: [addr(SELF)], cc: [], text: 'pong' })
    const out = triageMessages([a, b], SELF)
    expect(out[0].uid).toBe(20)
    expect(out[1].uid).toBe(10)
  })

  it('yields an empty list when nothing needs a reply', () => {
    expect(triageMessages([msg({ seen: true }), msg({ from: [addr('noreply@x')] })], SELF)).toEqual([])
  })
})

describe('toTriageMessage', () => {
  it('adapts a FullMessage-like record + folder into a TriageMessage', () => {
    const t = toTriageMessage(
      {
        uid: 7,
        subject: 'S',
        from: [addr('a@x.com')],
        to: [addr(SELF)],
        cc: [],
        text: 'hi',
        seen: false,
        headers: { precedence: 'bulk' },
      },
      'INBOX',
    )
    expect(t.folder).toBe('INBOX')
    expect(t.uid).toBe(7)
    expect(t.headers?.precedence).toBe('bulk')
  })
})
