import { describe, it, expect, vi } from 'vitest'
import { DraftService, type DraftFn, type DraftFnInput } from './draft-service'
import type { FullMessage } from './types'

/**
 * DraftService tests with an INJECTED fake draftFn — no real Claude call.
 * We prove:
 *   - the ENVELOPE comes from the proven buildOutgoing (Re: subject, In-Reply-To
 *     + References threading, reply-all recipients),
 *   - suggestedBody === the drafter's output (and rides in the envelope text),
 *   - the drafter receives CONTENT ONLY (no secret),
 *   - NOTHING is sent during drafting (there is no send path here at all).
 */

const self = { name: 'Alice', address: 'alice@example.com' }

function source(over: Partial<FullMessage> = {}): FullMessage {
  return {
    uid: 1,
    subject: 'Project kickoff',
    from: [{ name: 'Bob', address: 'bob@example.com' }],
    to: [
      { name: 'Alice', address: 'alice@example.com' },
      { name: 'Dave', address: 'dave@example.com' },
    ],
    cc: [{ name: 'Carol', address: 'carol@example.com' }],
    date: '2026-07-07T10:00:00.000Z',
    messageId: '<parent-abc@example.com>',
    text: 'Can we meet next week?',
    html: '',
    hasBlockedRemoteContent: false,
    attachments: [],
    flags: [],
    seen: false,
    headers: {},
    // The send-service reads an optional `references` off the source for chaining.
    ...({ references: ['<root-000@example.com>'] } as Partial<FullMessage>),
    ...over,
  }
}

const fakeDraft = (body: string): DraftFn => vi.fn(async () => body)

describe('DraftService.draftReply — envelope from buildOutgoing', () => {
  it('produces a Re:-prefixed subject and threading headers', async () => {
    const svc = new DraftService(fakeDraft('Yes, Tuesday works for me.'))
    const drafted = await svc.draftReply(self, source())

    expect(drafted.envelope.subject).toBe('Re: Project kickoff')
    expect(drafted.envelope.inReplyTo).toBe('<parent-abc@example.com>')
    expect(drafted.envelope.references).toEqual(['<root-000@example.com>', '<parent-abc@example.com>'])
    expect(drafted.sourceMessageId).toBe('<parent-abc@example.com>')
  })

  it('addresses the reply to the original sender', async () => {
    const svc = new DraftService(fakeDraft('ok'))
    const drafted = await svc.draftReply(self, source())
    expect(drafted.envelope.to).toEqual([{ name: 'Bob', address: 'bob@example.com' }])
  })

  it('reply-all widens Cc to original To+Cc minus self and the sender', async () => {
    const svc = new DraftService(fakeDraft('ok'))
    const drafted = await svc.draftReply(self, source(), { replyAll: true })
    const ccAddrs = (drafted.envelope.cc ?? []).map((a) => a.address).sort()
    // Dave (other To) + Carol (Cc); NOT Alice (self) and NOT Bob (already primary To).
    expect(ccAddrs).toEqual(['carol@example.com', 'dave@example.com'])
    expect(ccAddrs).not.toContain('alice@example.com')
    expect(ccAddrs).not.toContain('bob@example.com')
    expect(drafted.replyAll).toBe(true)
  })

  it('a plain (non reply-all) reply does not widen Cc', async () => {
    const svc = new DraftService(fakeDraft('ok'))
    const drafted = await svc.draftReply(self, source())
    expect(drafted.envelope.cc ?? []).toEqual([])
    expect(drafted.replyAll).toBe(false)
  })
})

describe('DraftService.draftReply — body is the drafter output', () => {
  it('suggestedBody equals the injected drafter output', async () => {
    const svc = new DraftService(fakeDraft('Here is my suggested reply.'))
    const drafted = await svc.draftReply(self, source())
    expect(drafted.suggestedBody).toBe('Here is my suggested reply.')
  })

  it('the envelope body starts with the drafter output (before the quoted original)', async () => {
    const svc = new DraftService(fakeDraft('DRAFTED-BODY-MARKER'))
    const drafted = await svc.draftReply(self, source())
    expect(drafted.envelope.text.startsWith('DRAFTED-BODY-MARKER')).toBe(true)
    // buildOutgoing appends the quoted original — proving threading/quoting reuse.
    expect(drafted.envelope.text).toContain('> Can we meet next week?')
  })
})

describe('DraftService.draftReply — the drafter gets content only, and nothing is sent', () => {
  it('passes source content + self identity to the drafter, never a secret', async () => {
    let seen: DraftFnInput | null = null
    const spy: DraftFn = async (input) => {
      seen = input
      return 'ok'
    }
    const svc = new DraftService(spy)
    await svc.draftReply(self, source(), { replyAll: true, instruction: 'keep it short' })

    expect(seen).not.toBeNull()
    expect(seen!.self).toEqual(self)
    expect(seen!.source.subject).toBe('Project kickoff')
    expect(seen!.source.text).toBe('Can we meet next week?')
    expect(seen!.replyAll).toBe(true)
    expect(seen!.instruction).toBe('keep it short')
    // The whole input, serialized, must contain no password-like field.
    expect(JSON.stringify(seen)).not.toMatch(/pass|secret|token|app-pw/i)
  })

  it('has no send capability — draftReply returns a draft and performs no I/O', async () => {
    // The service is constructed with ONLY a draftFn; there is no SendService,
    // SMTP client, or account store in scope. This test documents that invariant.
    const drafter = vi.fn(async () => 'body')
    const svc = new DraftService(drafter)
    const drafted = await svc.draftReply(self, source())
    expect(drafter).toHaveBeenCalledOnce()
    expect(drafted).toHaveProperty('envelope')
    expect(drafted).toHaveProperty('suggestedBody')
    // No accepted/rejected/messageId — this is a draft, not a SendResult.
    expect(drafted).not.toHaveProperty('accepted')
  })
})
