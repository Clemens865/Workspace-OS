import type { MailAddress, AttachmentMeta, TriageHeaders } from './message-parser'

/**
 * Shared IMAP-facing types. Kept in one place so the client, service, IPC layer
 * and the renderer's type mirror all agree on the wire shape.
 */

/** A folder/mailbox in the account's tree. */
export interface MailFolder {
  path: string
  name: string
  /** IMAP special-use flag (\Inbox, \Sent, \Drafts, \Trash, \Junk), if known. */
  specialUse?: string
  subscribed: boolean
  /** True when the folder can hold messages (not just a container). */
  selectable: boolean
}

/** Lightweight envelope summary for a message list row (no body fetched). */
export interface MessageSummary {
  uid: number
  subject: string
  from: MailAddress[]
  to: MailAddress[]
  date: string | null
  /** IMAP flags, e.g. "\\Seen", "\\Flagged". Unread = absence of \\Seen. */
  flags: string[]
  seen: boolean
  hasAttachments: boolean
  /** Short plaintext preview when available. */
  snippet: string
}

/** Full parsed message for the reader pane. */
export interface FullMessage {
  uid: number
  subject: string
  from: MailAddress[]
  to: MailAddress[]
  cc: MailAddress[]
  date: string | null
  messageId: string | null
  text: string
  html: string
  hasBlockedRemoteContent: boolean
  attachments: AttachmentMeta[]
  flags: string[]
  seen: boolean
  /** Lowercased subset of raw headers used by triage. Optional for back-compat. */
  headers?: TriageHeaders
}

export interface ListMessagesOptions {
  /** Max messages to return (default 50). */
  limit?: number
  /** Page backwards: return messages with a sequence/uid BEFORE this uid. */
  beforeUid?: number
  /**
   * Page backwards by COUNT from the newest message. Preferred over `beforeUid`
   * because it maps directly onto contiguous sequence numbers, so a page costs
   * one page-sized fetch rather than a scan of the whole folder.
   */
  offset?: number
}

/** A discriminated result so nothing ever throws raw into IPC. */
export type MailResult<T> = { ok: true; value: T } | { ok: false; error: MailError }

export type MailErrorCode =
  | 'auth' // bad credentials
  | 'tls' // TLS/certificate failure
  | 'host' // host unreachable / DNS
  | 'timeout'
  | 'not-found' // folder/message missing
  | 'unavailable' // secret store / no secret
  | 'unknown'

export interface MailError {
  code: MailErrorCode
  /** Human-readable, ALREADY SANITIZED — must never contain the password. */
  message: string
}

export const ok = <T>(value: T): MailResult<T> => ({ ok: true, value })
export const err = (code: MailErrorCode, message: string): MailResult<never> => ({
  ok: false,
  error: { code, message },
})

// ── Outgoing mail (Phase 2: compose / reply / forward / send) ────────────────

/** One recipient/sender on an outgoing message. `name` is optional display text. */
export interface OutAddress {
  name?: string
  address: string
}

/** A single attachment to send. Content is raw bytes (base64 across IPC). */
export interface OutAttachment {
  filename: string
  contentType?: string
  /** Raw file bytes. Across IPC this is a base64 string; coerced at the boundary. */
  content: Buffer
  /**
   * Content-ID for an INLINE attachment the html references as `cid:<cid>` —
   * how a rich email's images actually render in mainstream clients (a data:
   * URI is stripped by Gmail/Outlook). Absent for ordinary file attachments.
   */
  cid?: string
}

/**
 * A fully-specified outgoing message. Threading headers (inReplyTo/references)
 * are set by the send-service for replies/forwards; the renderer never crafts
 * raw headers itself.
 */
export interface OutgoingMessage {
  from: OutAddress
  to: OutAddress[]
  cc?: OutAddress[]
  bcc?: OutAddress[]
  subject: string
  text: string
  html?: string
  attachments?: OutAttachment[]
  /** RFC Message-ID of the message being replied to (sets In-Reply-To). */
  inReplyTo?: string
  /** Thread chain: prior References + the parent Message-ID. */
  references?: string[]
}

/** Result of a successful send — the accepted Message-ID for the sent record. */
export interface SendResult {
  messageId: string
  accepted: string[]
  rejected: string[]
}
