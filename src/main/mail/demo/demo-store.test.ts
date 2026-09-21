import { describe, it, expect } from 'vitest'
import { DemoStore, DEMO_FOLDERS, DEMO_USER } from './demo-store'

/**
 * The seeded demo mailbox. We assert the shape onboarding relies on: the four
 * folders, a realistic Inbox count, a mix of read/unread, an HTML message, an
 * attachment, a short thread, and the two "needs a reply" direct questions — all
 * with FIXED (deterministic) timestamps, never Date.now().
 */
describe('DemoStore seed', () => {
  it('seeds the four folders in order', () => {
    expect(DEMO_FOLDERS.map((f) => f.path)).toEqual(['INBOX', 'Sent', 'Drafts', 'Archive'])
    expect(DEMO_FOLDERS[0].specialUse).toBe('\\Inbox')
  })

  it('populates every folder with messages', () => {
    const store = new DemoStore()
    expect(store.inFolder('INBOX').length).toBeGreaterThanOrEqual(6)
    expect(store.inFolder('Sent').length).toBeGreaterThanOrEqual(1)
    expect(store.inFolder('Drafts').length).toBeGreaterThanOrEqual(1)
    expect(store.inFolder('Archive').length).toBeGreaterThanOrEqual(1)
  })

  it('has a mix of read and unread in the Inbox', () => {
    const inbox = new DemoStore().inFolder('INBOX')
    expect(inbox.some((m) => m.seen)).toBe(true)
    expect(inbox.some((m) => !m.seen)).toBe(true)
  })

  it('includes an HTML message, an attachment, and a two-message thread', () => {
    const inbox = new DemoStore().inFolder('INBOX')
    expect(inbox.some((m) => m.html && m.html.includes('<'))).toBe(true)
    expect(inbox.some((m) => m.attachments.length > 0)).toBe(true)
    // Thread: one message replies to another by Message-ID.
    const reply = inbox.find((m) => m.inReplyTo)
    expect(reply).toBeTruthy()
    expect(inbox.some((m) => m.messageId === reply!.inReplyTo)).toBe(true)
  })

  it('contains at least two unread direct questions to the demo user', () => {
    const inbox = new DemoStore().inFolder('INBOX')
    const directQuestions = inbox.filter(
      (m) =>
        !m.seen &&
        m.to.some((a) => a.address === DEMO_USER) &&
        m.text.includes('?') &&
        !m.headers['list-unsubscribe'] &&
        !m.headers['auto-submitted'],
    )
    expect(directQuestions.length).toBeGreaterThanOrEqual(2)
  })

  it('uses fixed, deterministic timestamps (identical across instances)', () => {
    const a = new DemoStore().inFolder('INBOX').map((m) => m.date)
    const b = new DemoStore().inFolder('INBOX').map((m) => m.date)
    expect(a).toEqual(b)
    expect(a.every((d) => !Number.isNaN(new Date(d).getTime()))).toBe(true)
  })

  it('append gives a fresh monotonic uid and is isolated per instance', () => {
    const store = new DemoStore()
    const before = store.inFolder('Sent').length
    const first = store.append({
      folder: 'Sent', subject: 's', from: [], to: [], cc: [], date: new Date().toISOString(),
      messageId: '<x@demo>', text: 't', html: '', hasBlockedRemoteContent: false, attachments: [],
      seen: true, headers: {},
    })
    const second = store.append({
      folder: 'Sent', subject: 's2', from: [], to: [], cc: [], date: new Date().toISOString(),
      messageId: '<y@demo>', text: 't', html: '', hasBlockedRemoteContent: false, attachments: [],
      seen: true, headers: {},
    })
    expect(second.uid).toBeGreaterThan(first.uid)
    expect(store.inFolder('Sent').length).toBe(before + 2)
    // A second store does not see the first's appends.
    expect(new DemoStore().inFolder('Sent').length).toBe(before)
  })
})
