import { describe, it, expect } from 'vitest'
import { DemoBackend } from './demo-backend'
import { DemoStore, DEMO_USER } from './demo-store'
import type { OutgoingMessage } from '../types'

/**
 * The demo backend projects the SAME MailFolder / MessageSummary / FullMessage
 * shapes as the IMAP client, from the in-memory store. We prove newest-first +
 * paging + unread flags, a parsed full message (html + text + attachment) that
 * genuinely blocks remote content through the shared sanitizer, and a local send
 * round-trip (Sent append + Inbox echo, then re-fetchable).
 */
describe('DemoBackend.listFolders', () => {
  it('returns the four selectable folders', () => {
    const folders = new DemoBackend().listFolders()
    expect(folders.map((f) => f.path)).toEqual(['INBOX', 'Sent', 'Drafts', 'Archive'])
    expect(folders.every((f) => f.selectable && f.subscribed)).toBe(true)
  })
})

describe('DemoBackend.listMessages', () => {
  it('is newest-first by uid', () => {
    const rows = new DemoBackend().listMessages('INBOX')
    const uids = rows.map((r) => r.uid)
    expect(uids).toEqual([...uids].sort((a, b) => b - a))
    expect(uids[0]).toBeGreaterThan(uids[uids.length - 1])
  })

  it('projects the summary shape with unread flags + attachment marker', () => {
    const rows = new DemoBackend().listMessages('INBOX')
    const withAttach = rows.find((r) => r.hasAttachments)
    expect(withAttach).toBeTruthy()
    const unread = rows.find((r) => !r.seen)
    expect(unread).toBeTruthy()
    expect(unread!.flags).not.toContain('\\Seen')
    const read = rows.find((r) => r.seen)
    expect(read!.flags).toContain('\\Seen')
  })

  it('pages by beforeUid and honours the limit', () => {
    const backend = new DemoBackend()
    const all = backend.listMessages('INBOX', { limit: 100 })
    const firstPage = backend.listMessages('INBOX', { limit: 2 })
    expect(firstPage).toHaveLength(2)
    const cursor = firstPage[firstPage.length - 1].uid
    const nextPage = backend.listMessages('INBOX', { limit: 100, beforeUid: cursor })
    expect(nextPage.every((m) => m.uid < cursor)).toBe(true)
    expect(firstPage.length + nextPage.length).toBe(all.length)
  })
})

describe('DemoBackend.fetchMessage', () => {
  it('returns null for a missing message', () => {
    expect(new DemoBackend().fetchMessage('INBOX', 999999)).toBeNull()
  })

  it('returns a full parsed plain-text message', () => {
    const backend = new DemoBackend()
    const summary = backend.listMessages('INBOX').find((m) => !m.hasAttachments)!
    const full = backend.fetchMessage('INBOX', summary.uid)!
    expect(full.uid).toBe(summary.uid)
    expect(typeof full.text).toBe('string')
    expect(full.text.length).toBeGreaterThan(0)
    expect(Array.isArray(full.attachments)).toBe(true)
    expect(Array.isArray(full.cc)).toBe(true)
    expect('messageId' in full).toBe(true)
  })

  it('blocks remote content in the HTML message through the shared sanitizer', () => {
    const backend = new DemoBackend()
    const htmlMsg = backend
      .listMessages('INBOX', { limit: 100 })
      .map((s) => backend.fetchMessage('INBOX', s.uid)!)
      .find((f) => f.html && f.html.length > 0)!
    expect(htmlMsg.hasBlockedRemoteContent).toBe(true)
    // The tracker must not LOAD. Its URL is now retained inertly in a
    // data-blocked-* attribute so the reader can offer opt-in "load images";
    // what must never survive is a live src the browser would fetch on render.
    expect(htmlMsg.html).not.toMatch(/\ssrc\s*=\s*["']https?:/)
    expect(htmlMsg.html).not.toMatch(/<script/i)
  })

  it('surfaces the attachment metadata on the reader shape', () => {
    const backend = new DemoBackend()
    const summary = backend.listMessages('INBOX').find((m) => m.hasAttachments)!
    const full = backend.fetchMessage('INBOX', summary.uid)!
    expect(full.attachments.length).toBeGreaterThan(0)
    expect(full.attachments[0].filename).toBeTruthy()
  })
})

describe('DemoBackend.send', () => {
  const out: OutgoingMessage = {
    from: { name: 'You', address: DEMO_USER },
    to: [{ address: 'priya@acme-partners.com' }],
    subject: 'Re: Quick question on the Q3 forecast',
    text: 'Here are the finance-model numbers. Talk at the call.',
  }

  it('appends to Sent and echoes into the Inbox, both re-fetchable', () => {
    const backend = new DemoBackend(new DemoStore())
    const sentBefore = backend.listMessages('Sent', { limit: 100 }).length
    const inboxBefore = backend.listMessages('INBOX', { limit: 100 }).length

    const { sent } = backend.send(out, { echoToInbox: true })
    expect(sent.subject).toBe(out.subject)
    expect(sent.from[0].address).toBe(DEMO_USER)

    const sentAfter = backend.listMessages('Sent', { limit: 100 })
    const inboxAfter = backend.listMessages('INBOX', { limit: 100 })
    expect(sentAfter.length).toBe(sentBefore + 1)
    expect(inboxAfter.length).toBe(inboxBefore + 1)

    // The Sent record is retrievable in full.
    const refetched = backend.fetchMessage('Sent', sent.uid)!
    expect(refetched.text).toBe(out.text)
    // The Inbox echo is unread.
    const echo = inboxAfter.find((m) => m.subject === out.subject && !m.seen)
    expect(echo).toBeTruthy()
  })

  it('does not echo into the Inbox when not asked', () => {
    const backend = new DemoBackend(new DemoStore())
    const inboxBefore = backend.listMessages('INBOX', { limit: 100 }).length
    backend.send(out)
    expect(backend.listMessages('INBOX', { limit: 100 }).length).toBe(inboxBefore)
  })
})
