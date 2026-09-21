import { sanitizeHtml } from '../message-parser'
import type {
  FullMessage,
  ListMessagesOptions,
  MailFolder,
  MessageSummary,
  OutgoingMessage,
} from '../types'
import { DemoStore, DEMO_USER, type DemoMessage } from './demo-store'

/**
 * The demo-mailbox backend. Implements the exact operations MailService needs —
 * `listFolders` / `listMessages` / `fetchMessage` — plus a local `send`, reading
 * from an in-memory {@link DemoStore}. Provider-agnostic, pure logic, no I/O and
 * no network: unit-testable in isolation.
 *
 * The returned shapes are BYTE-FOR-BYTE the same {@link MailFolder} /
 * {@link MessageSummary} / {@link FullMessage} the IMAP client returns, so the
 * renderer needs zero changes to display the demo account.
 */
export class DemoBackend {
  constructor(private readonly store: DemoStore = new DemoStore()) {}

  /** The four seeded folders as the renderer's MailFolder shape. */
  listFolders(): MailFolder[] {
    return this.store.folders().map((f) => ({
      path: f.path,
      name: f.name,
      specialUse: f.specialUse,
      subscribed: true,
      selectable: true,
    }))
  }

  /**
   * Envelope summaries for a folder — NEWEST FIRST, paged by uid exactly like the
   * IMAP client: `beforeUid` returns messages strictly below the cursor, capped
   * to `limit`. No body is projected (snippet only), matching the real client.
   */
  listMessages(folder: string, opts: ListMessagesOptions = {}): MessageSummary[] {
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 200))
    let rows = this.store.inFolder(folder)
    if (opts.beforeUid && opts.beforeUid > 1) {
      rows = rows.filter((m) => m.uid < opts.beforeUid!)
    }
    rows = rows.slice().sort((a, b) => b.uid - a.uid).slice(0, limit)
    return rows.map(toSummary)
  }

  /** Full parsed message for the reader — html + text + attachments + flags. */
  fetchMessage(folder: string, uid: number): FullMessage | null {
    const msg = this.store.find(folder, uid)
    if (!msg) return null
    return toFull(msg)
  }

  /**
   * Local "send": append the outgoing message to Sent, and (optionally) echo a
   * copy into the Inbox so the demo user sees it "arrive". Returns the Sent
   * record so a caller can immediately re-fetch it. Purely in-memory.
   */
  send(message: OutgoingMessage, opts: { echoToInbox?: boolean } = {}): { sent: FullMessage } {
    const now = new Date().toISOString()
    const messageId = `<demo-sent-${Date.now()}-${Math.floor(Math.random() * 1e6)}@workspace-os.demo>`
    const base = {
      subject: message.subject,
      from: [{ name: message.from.name || '', address: message.from.address }],
      to: message.to.map((a) => ({ name: a.name || '', address: a.address })),
      cc: (message.cc ?? []).map((a) => ({ name: a.name || '', address: a.address })),
      date: now,
      text: message.text || '',
      html: message.html || '',
      hasBlockedRemoteContent: false,
      attachments: [],
      seen: true,
      headers: {},
      ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
    }
    const sent = this.store.append({ ...base, folder: 'Sent', messageId })
    if (opts.echoToInbox) {
      // The echo lands unread in the Inbox as if it had arrived back to you.
      this.store.append({
        ...base,
        folder: 'INBOX',
        messageId: `<demo-echo-${Date.now()}@workspace-os.demo>`,
        seen: false,
      })
    }
    return { sent: toFull(sent) }
  }
}

/** Project a stored demo message into the envelope summary shape. */
function toSummary(m: DemoMessage): MessageSummary {
  return {
    uid: m.uid,
    subject: m.subject,
    from: m.from,
    to: m.to,
    date: m.date,
    flags: m.seen ? ['\\Seen'] : [],
    seen: m.seen,
    hasAttachments: m.attachments.length > 0,
    snippet: (m.text || '').replace(/\s+/g, ' ').trim().slice(0, 140),
  }
}

/**
 * Project a stored demo message into the full-reader shape. HTML bodies are run
 * through the SAME `sanitizeHtml` as real mail so remote content is genuinely
 * blocked and `hasBlockedRemoteContent` is truthful (defence-in-depth, not a
 * weakened path). Plain-text messages carry an empty html string, as IMAP does.
 */
function toFull(m: DemoMessage): FullMessage {
  let html = ''
  let hasBlockedRemoteContent = m.hasBlockedRemoteContent
  if (m.html) {
    const s = sanitizeHtml(m.html)
    html = s.html
    hasBlockedRemoteContent = s.hadRemote || m.hasBlockedRemoteContent
  }
  return {
    uid: m.uid,
    subject: m.subject,
    from: m.from,
    to: m.to,
    cc: m.cc,
    date: m.date,
    messageId: m.messageId,
    text: m.text,
    html,
    hasBlockedRemoteContent,
    attachments: m.attachments,
    flags: m.seen ? ['\\Seen'] : [],
    seen: m.seen,
    headers: m.headers,
  }
}

export { DEMO_USER }
