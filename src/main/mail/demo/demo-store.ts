import type { AttachmentMeta, MailAddress, TriageHeaders } from '../message-parser'

/**
 * A seeded, in-memory demo mailbox. NO credentials, NO network — this exists so
 * a user (and onboarding) can exercise the ENTIRE mail client (inbox, reader,
 * reply, rich compose, triage → Living Feed, agent-drafted replies) against a
 * realistic, deterministic dataset.
 *
 * SECURITY / DETERMINISM:
 *  - Timestamps are FIXED epoch values (no Date.now()) so tests are stable; the
 *    app renders them relatively at display time.
 *  - The account that owns this mailbox holds no secret and touches no server —
 *    see account-store (`authKind: 'demo'`) and mail-service's demo routing.
 */

/** The address the demo mailbox belongs to (the account `user`). */
export const DEMO_USER = 'you@workspace-os.demo'
export const DEMO_DISPLAY_NAME = 'Demo Mailbox'

/** The four seeded folders, in sidebar order. Inbox first (special-use tagged). */
export interface DemoFolder {
  path: string
  name: string
  specialUse?: string
}

export const DEMO_FOLDERS: DemoFolder[] = [
  { path: 'INBOX', name: 'Inbox', specialUse: '\\Inbox' },
  { path: 'Sent', name: 'Sent', specialUse: '\\Sent' },
  { path: 'Drafts', name: 'Drafts', specialUse: '\\Drafts' },
  { path: 'Archive', name: 'Archive', specialUse: '\\Archive' },
]

/**
 * A stored demo message. Mirrors the fields both the summary and the full-reader
 * shapes need, so the backend can project either from a single record. `text`
 * and `html` are the already-parsed bodies; `attachments` is metadata only (the
 * reader shows the chip — no bytes are needed for the demo).
 */
export interface DemoMessage {
  uid: number
  folder: string
  subject: string
  from: MailAddress[]
  to: MailAddress[]
  cc: MailAddress[]
  /** Fixed ISO timestamp — deterministic (never Date.now()). */
  date: string
  messageId: string
  text: string
  /** Sanitized-shape HTML (rendered through the SAME sandboxed reader path). */
  html: string
  hasBlockedRemoteContent: boolean
  attachments: AttachmentMeta[]
  seen: boolean
  headers: TriageHeaders
  /** Threading: the Message-ID this one replies to (for the short thread). */
  inReplyTo?: string
}

const me = (): MailAddress => ({ name: 'You', address: DEMO_USER })
const addr = (name: string, address: string): MailAddress => ({ name, address })

/** A base day so all timestamps are fixed + ordered (2024-05-06 .. onwards). */
const D = (iso: string): string => new Date(iso).toISOString()

/**
 * The seeded messages. ~10 messages across folders showing off the client:
 *  - plain-text, HTML (with blocked remote image), a 2-message thread,
 *  - a message with an attachment, a mix of read/unread,
 *  - TWO clear "needs a reply" direct questions (uid 105, 101) so triage +
 *    agent-drafted replies are demoable,
 *  - one automated/no-reply and one bulk/list message that triage must SKIP.
 */
function seedMessages(): DemoMessage[] {
  return [
    // ── INBOX ────────────────────────────────────────────────────────────────
    {
      uid: 105,
      folder: 'INBOX',
      subject: 'Quick question on the Q3 forecast',
      from: [addr('Priya Nair', 'priya@acme-partners.com')],
      to: [me()],
      cc: [],
      date: D('2024-05-13T09:12:00Z'),
      messageId: '<q3-forecast-105@acme-partners.com>',
      text:
        'Hi,\n\nCould you send me the updated Q3 revenue forecast before our call tomorrow? ' +
        'I want to sanity-check the growth assumptions against the pipeline. ' +
        'Are the numbers from the finance model, or the sales-adjusted ones?\n\nThanks,\nPriya',
      html: '',
      hasBlockedRemoteContent: false,
      attachments: [],
      seen: false,
      headers: {},
    },
    {
      uid: 104,
      folder: 'INBOX',
      subject: 'Design review — 2 files attached',
      from: [addr('Marco Reyes', 'marco@studio-north.co')],
      to: [me()],
      cc: [addr('Lena Ford', 'lena@studio-north.co')],
      date: D('2024-05-12T16:40:00Z'),
      messageId: '<design-review-104@studio-north.co>',
      text:
        'Attached are the two board exports for the landing page. ' +
        'Let me know which direction you prefer and I’ll polish it up.',
      html: '',
      hasBlockedRemoteContent: false,
      attachments: [
        { filename: 'landing-hero-v3.png', contentType: 'image/png', size: 284_113, inline: false },
        { filename: 'notes.pdf', contentType: 'application/pdf', size: 42_880, inline: false },
      ],
      seen: false,
      headers: {},
    },
    {
      uid: 103,
      folder: 'INBOX',
      subject: 'Your May statement is ready',
      from: [addr('Northbank', 'no-reply@northbank-mail.com')],
      to: [me()],
      cc: [],
      date: D('2024-05-12T06:00:00Z'),
      messageId: '<statement-103@northbank-mail.com>',
      // An HTML message with a REMOTE image → exercises the sanitized reader +
      // "remote content blocked" notice. The remote <img src> is left raw here;
      // it is sanitized through the SAME parseMessage path when fetched.
      html:
        '<div style="font-family:Arial,sans-serif">' +
        '<h2>Your statement is ready</h2>' +
        '<p>Hi there — your May account statement is now available to view online.</p>' +
        '<img src="https://tracker.northbank-mail.com/open.gif?u=demo" width="1" height="1" alt="">' +
        '<p style="color:#888;font-size:12px">This is an automated message — please do not reply.</p>' +
        '</div>',
      text: 'Your May account statement is now available to view online. This is an automated message.',
      hasBlockedRemoteContent: false,
      attachments: [],
      seen: true,
      headers: { 'auto-submitted': 'auto-generated' },
    },
    {
      uid: 102,
      folder: 'INBOX',
      subject: 'Weekly product digest',
      from: [addr('Product Weekly', 'digest@producthunt-list.com')],
      to: [me()],
      cc: [],
      date: D('2024-05-11T12:00:00Z'),
      messageId: '<digest-102@producthunt-list.com>',
      text: 'The top 10 launches this week, plus a roundup of maker interviews. Unsubscribe any time.',
      html: '',
      hasBlockedRemoteContent: false,
      attachments: [],
      seen: false,
      // Bulk / mailing-list headers → triage must SKIP this one.
      headers: {
        'list-unsubscribe': '<mailto:unsubscribe@producthunt-list.com>',
        'list-id': 'Product Weekly <digest.producthunt-list.com>',
        precedence: 'bulk',
      },
    },
    {
      uid: 101,
      folder: 'INBOX',
      subject: 'Re: Onboarding deck — can you review?',
      from: [addr('Sam Ortega', 'sam@workspace-os.demo')],
      to: [me()],
      cc: [],
      date: D('2024-05-10T15:20:00Z'),
      messageId: '<onboarding-101b@workspace-os.demo>',
      inReplyTo: '<onboarding-101a@workspace-os.demo>',
      text:
        'Thanks for the first pass! One thing — can you review slide 7 and let me know ' +
        'if the pricing tiers are right before I send it to the client? Would love your input today.',
      html: '',
      hasBlockedRemoteContent: false,
      attachments: [],
      seen: false,
      headers: {},
    },
    {
      uid: 100,
      folder: 'INBOX',
      subject: 'Onboarding deck — first draft',
      from: [addr('Sam Ortega', 'sam@workspace-os.demo')],
      to: [me()],
      cc: [],
      date: D('2024-05-09T10:05:00Z'),
      messageId: '<onboarding-101a@workspace-os.demo>',
      text:
        'Here’s the first draft of the onboarding deck. Take a look when you get a chance — ' +
        'no rush, I’ll do another pass on the visuals tomorrow.',
      html: '',
      hasBlockedRemoteContent: false,
      attachments: [],
      seen: true,
      headers: {},
    },
    {
      uid: 99,
      folder: 'INBOX',
      subject: 'Lunch Thursday?',
      from: [addr('Dana Whitfield', 'dana@friends.demo')],
      to: [me()],
      cc: [],
      date: D('2024-05-08T18:30:00Z'),
      messageId: '<lunch-99@friends.demo>',
      text: 'Great catching up last week! Already read — kept for reference. See you Thursday.',
      html: '',
      hasBlockedRemoteContent: false,
      attachments: [],
      seen: true,
      headers: {},
    },

    // ── Sent ───────────────────────────────────────────────────────────────
    {
      uid: 50,
      folder: 'Sent',
      subject: 'Re: Kickoff notes',
      from: [me()],
      to: [addr('Priya Nair', 'priya@acme-partners.com')],
      cc: [],
      date: D('2024-05-07T08:15:00Z'),
      messageId: '<sent-50@workspace-os.demo>',
      text: 'Thanks Priya — notes look good. I’ve added two action items at the bottom. Talk soon.',
      html: '',
      hasBlockedRemoteContent: false,
      attachments: [],
      seen: true,
      headers: {},
    },

    // ── Drafts ─────────────────────────────────────────────────────────────
    {
      uid: 30,
      folder: 'Drafts',
      subject: 'Proposal outline (draft)',
      from: [me()],
      to: [addr('Marco Reyes', 'marco@studio-north.co')],
      cc: [],
      date: D('2024-05-06T21:00:00Z'),
      messageId: '<draft-30@workspace-os.demo>',
      text: 'Marco — rough outline for the proposal. Still need to fill in the timeline section…',
      html: '',
      hasBlockedRemoteContent: false,
      attachments: [],
      seen: true,
      headers: {},
    },

    // ── Archive ────────────────────────────────────────────────────────────
    {
      uid: 10,
      folder: 'Archive',
      subject: 'Welcome to Workspace OS',
      from: [addr('Workspace OS', 'hello@workspace-os.demo')],
      to: [me()],
      cc: [],
      date: D('2024-05-01T09:00:00Z'),
      messageId: '<welcome-10@workspace-os.demo>',
      text: 'Welcome aboard! This archived note is here so the Archive folder isn’t empty.',
      html: '',
      hasBlockedRemoteContent: false,
      attachments: [],
      seen: true,
      headers: {},
    },
  ]
}

/**
 * A mutable in-memory mailbox instance. Kept per demo account id so a demo send
 * can append to Sent (and echo into Inbox) and be re-read within the session.
 * Everything is a plain clone of the seed on construction — no shared mutation
 * across instances, so tests are isolated.
 */
export class DemoStore {
  private messages: DemoMessage[]
  /** Monotonic uid source for appended (sent/echoed) messages. */
  private nextUid: number

  constructor() {
    this.messages = seedMessages()
    this.nextUid = 1000
  }

  folders(): DemoFolder[] {
    return DEMO_FOLDERS
  }

  /** All messages in a folder (unsorted — the backend orders/pages). */
  inFolder(folder: string): DemoMessage[] {
    return this.messages.filter((m) => m.folder === folder)
  }

  /** One message by folder + uid, or null. */
  find(folder: string, uid: number): DemoMessage | null {
    return this.messages.find((m) => m.folder === folder && m.uid === uid) ?? null
  }

  /** Appends a message to a folder with a fresh uid, returning it. */
  append(msg: Omit<DemoMessage, 'uid'>): DemoMessage {
    const full: DemoMessage = { ...msg, uid: this.nextUid++ }
    this.messages.push(full)
    return full
  }
}
