import { describe, it, expect } from 'vitest'
import {
  mailCardId,
  isMailPending,
  canArmSend,
  canDraft,
  mailHeadline,
  mailResolvedLabel,
  cardFromTriage,
  fromLabel,
  compareMailCards,
  type MailCard,
  type MailCardStatus,
} from './mailReviewModel'

function card(over: Partial<MailCard> = {}): MailCard {
  return {
    id: 'a:INBOX:1',
    source: {
      accountId: 'a',
      folder: 'INBOX',
      uid: 1,
      subject: 'Can we meet?',
      fromLabel: 'Bob <bob@x.com>',
      reason: 'Unread, addressed to you · asks a question',
      score: 80,
    },
    status: 'drafted',
    draftBody: 'Sure, Tuesday works.',
    draftOpened: true,
    replyAll: false,
    error: null,
    createdAt: Date.now(),
    resolvedAt: null,
    ...over,
  }
}

describe('mailCardId', () => {
  it('is stable per account/folder/uid', () => {
    expect(mailCardId('acc', 'INBOX', 42)).toBe('acc:INBOX:42')
  })
})

describe('isMailPending', () => {
  it('sent and dismissed are resolved; everything else is pending', () => {
    const pend: MailCardStatus[] = ['needs-draft', 'drafting', 'drafted', 'draft-error', 'sending', 'send-error']
    for (const s of pend) expect(isMailPending(s)).toBe(true)
    expect(isMailPending('sent')).toBe(false)
    expect(isMailPending('dismissed')).toBe(false)
  })
})

describe('canArmSend — the draft gate', () => {
  it('is false until the draft tier is opened (draft-gated action semantics)', () => {
    expect(canArmSend(card({ draftOpened: false }))).toBe(false)
  })
  it('is false with an empty draft body', () => {
    expect(canArmSend(card({ draftOpened: true, draftBody: '   ' }))).toBe(false)
  })
  it('arms once opened with a non-empty drafted body', () => {
    expect(canArmSend(card({ status: 'drafted', draftOpened: true, draftBody: 'hi' }))).toBe(true)
  })
  it('re-arms after a send error (retry), but not while sending or before a draft', () => {
    expect(canArmSend(card({ status: 'send-error', draftOpened: true, draftBody: 'hi' }))).toBe(true)
    expect(canArmSend(card({ status: 'sending', draftOpened: true, draftBody: 'hi' }))).toBe(false)
    expect(canArmSend(card({ status: 'needs-draft', draftOpened: true, draftBody: '' }))).toBe(false)
  })
})

describe('canDraft', () => {
  it('allows drafting from needs-draft or after a draft error', () => {
    expect(canDraft('needs-draft')).toBe(true)
    expect(canDraft('draft-error')).toBe(true)
  })
  it('does not allow re-drafting mid-flight or once drafted/sent', () => {
    expect(canDraft('drafting')).toBe(false)
    expect(canDraft('drafted')).toBe(false)
    expect(canDraft('sent')).toBe(false)
  })
})

describe('mailHeadline', () => {
  it('shows the subject, capped', () => {
    expect(mailHeadline(card())).toBe('Can we meet?')
    const long = 'x'.repeat(200)
    expect(mailHeadline(card({ source: { ...card().source, subject: long } })).length).toBeLessThanOrEqual(96)
  })
  it('falls back for an empty subject', () => {
    expect(mailHeadline(card({ source: { ...card().source, subject: '' } }))).toBe('(no subject)')
  })
})

describe('mailResolvedLabel', () => {
  it('labels sent and dismissed equally', () => {
    expect(mailResolvedLabel('sent')).toBe('Sent')
    expect(mailResolvedLabel('dismissed')).toBe('Dismissed')
    expect(mailResolvedLabel('drafted')).toBe('')
  })
})

describe('fromLabel', () => {
  it('renders name+addr, bare addr, or a fallback', () => {
    expect(fromLabel({ name: 'Bob', address: 'b@x.com' })).toBe('Bob <b@x.com>')
    expect(fromLabel({ name: '', address: 'b@x.com' })).toBe('b@x.com')
    expect(fromLabel(null)).toBe('(unknown sender)')
  })
})

describe('cardFromTriage', () => {
  it('builds a needs-draft card with the source coordinates and an id', () => {
    const c = cardFromTriage(
      'acc',
      { folder: 'INBOX', uid: 9, subject: 'Q', from: { name: 'A', address: 'a@x.com' }, reason: 'r', score: 70 },
      1000,
    )
    expect(c.id).toBe('acc:INBOX:9')
    expect(c.status).toBe('needs-draft')
    expect(c.draftOpened).toBe(false)
    expect(c.source.fromLabel).toBe('A <a@x.com>')
    expect(c.createdAt).toBe(1000)
  })
})

describe('compareMailCards', () => {
  it('sorts pending before resolved, then by score, then recency', () => {
    const pendingHi = card({ id: 'p1', status: 'drafted', source: { ...card().source, score: 90 }, createdAt: 1 })
    const pendingLo = card({ id: 'p2', status: 'needs-draft', source: { ...card().source, score: 50 }, createdAt: 2 })
    const resolved = card({ id: 'r1', status: 'sent', source: { ...card().source, score: 99 }, createdAt: 3 })
    const sorted = [resolved, pendingLo, pendingHi].sort(compareMailCards)
    expect(sorted.map((c) => c.id)).toEqual(['p1', 'p2', 'r1'])
  })
})
