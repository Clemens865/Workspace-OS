import { MailAccountStore } from './account-store'
import { SmtpClient, type SmtpConnectConfig } from './smtp-client'
import type { MailAddress } from './message-parser'
import type {
  MailResult,
  OutgoingMessage,
  OutAddress,
  OutAttachment,
  SendResult,
  FullMessage,
} from './types'
import { err } from './types'
import type { TokenManager } from './token-manager'

/**
 * Compose / reply / forward orchestration for the SMTP send path.
 *
 * Kept separate from the read-only MailService so the two phases stay cleanly
 * bounded. Responsibilities:
 *  - Resolve an account id → live SMTP connect config by decrypting the secret
 *    through the account store ONLY at the moment of send (never cached, logged
 *    or returned). SMTP reuses the account password (for Gmail the same
 *    app-password authenticates smtp.gmail.com:465).
 *  - Turn a renderer draft (+ optional source message for reply/forward) into a
 *    fully-specified OutgoingMessage with correct threading headers, subject
 *    prefixing and a quoted original — all via PURE, unit-testable builders.
 */

/** A renderer-authored draft. Threading is derived from `context`, not crafted here. */
export interface DraftInput {
  to: OutAddress[]
  cc?: OutAddress[]
  bcc?: OutAddress[]
  subject: string
  text: string
  html?: string
  attachments?: OutAttachment[]
}

/** How the draft relates to an existing message (drives headers + quoting). */
export type ComposeContext =
  | { kind: 'new' }
  | { kind: 'reply'; source: FullMessage; replyAll?: boolean }
  | { kind: 'forward'; source: FullMessage }

export class SendService {
  constructor(
    private readonly accounts: MailAccountStore,
    private readonly smtp: SmtpClient = new SmtpClient(),
    /** Optional — required only to resolve xoauth2 access tokens at send-time. */
    private readonly tokens?: TokenManager,
  ) {}

  /**
   * Validate SMTP credentials WITHOUT persisting — the settings SMTP "Test
   * connection" button. The password is passed straight through and discarded.
   */
  async testSmtp(
    smtp: { host: string; port: number; tls: boolean },
    user: string,
    secret: string,
  ): Promise<MailResult<true>> {
    return this.smtp.verify({
      host: smtp.host,
      port: smtp.port,
      secure: smtpSecure(smtp.port, smtp.tls),
      requireTLS: smtpRequireTLS(smtp.port, smtp.tls),
      auth: { user, pass: secret },
    })
  }

  /**
   * Builds the outgoing message from a draft + context and sends it through the
   * account's SMTP server. The plaintext secret is created here, used once, and
   * never stored on `this` or returned across IPC.
   */
  async send(
    accountId: string,
    draft: DraftInput,
    context: ComposeContext = { kind: 'new' },
  ): Promise<MailResult<SendResult>> {
    const account = await this.accounts.get(accountId)
    if (!account) return err('not-found', 'Mail account not found.')
    if (!account.smtp) return err('unavailable', 'This account has no SMTP server configured.')

    // Resolve the SMTP auth: an OAuth2 access token for xoauth2 accounts,
    // otherwise the decrypted app-password. Neither is cached or logged.
    let auth: SmtpConnectConfig['auth']
    if (account.authKind === 'xoauth2') {
      if (!this.tokens) return err('unavailable', 'Google sign-in is not available.')
      const tok = await this.tokens.getAccessToken(accountId)
      if (!tok.ok) return tok
      auth = { user: account.user, accessToken: tok.value }
    } else {
      let secret: string | null
      try {
        secret = await this.accounts.getSecret(accountId)
      } catch {
        return err('unavailable', 'Secure credential storage is unavailable on this system.')
      }
      if (!secret) return err('unavailable', 'No saved password for this account.')
      auth = { user: account.user, pass: secret }
    }

    const cfg: SmtpConnectConfig = {
      host: account.smtp.host,
      port: account.smtp.port,
      secure: smtpSecure(account.smtp.port, account.smtp.tls),
      requireTLS: smtpRequireTLS(account.smtp.port, account.smtp.tls),
      auth,
    }
    const message = buildOutgoing({ name: account.displayName, address: account.user }, draft, context)
    return this.smtp.send(cfg, message)
  }
}

/**
 * Map an SMTP submission port to nodemailer's `secure` (implicit-TLS) flag.
 *
 * This is the fix that makes non-Gmail providers send:
 *  - 465 → implicit TLS on connect            → secure: true
 *  - 587 / 25 (submission) → STARTTLS upgrade  → secure: false
 *    (smtp-client then forces requireTLS so AUTH never rides a plaintext socket)
 *
 * The account's `tls` flag is a hard opt-OUT of encryption: if a user explicitly
 * unticked TLS we honour it (secure: false regardless of port). Otherwise the
 * port decides — because 465 and 587 need OPPOSITE `secure` values, a single
 * "use TLS" boolean cannot be correct for both, which is why Outlook/iCloud
 * previously failed under the old `secure: tls` mapping.
 */
export function smtpSecure(port: number, tls: boolean): boolean {
  if (!tls) return false
  return port === 465
}

/**
 * Whether the SMTP session must upgrade via STARTTLS before AUTH. True for the
 * submission ports (587/25) when TLS is on and we are NOT already on implicit
 * TLS (465) — this keeps credentials off a plaintext socket on 587. When the
 * user opted out of TLS entirely we don't force it.
 */
export function smtpRequireTLS(port: number, tls: boolean): boolean {
  return tls && !smtpSecure(port, tls)
}

/**
 * PURE builder: draft + context → a fully-specified OutgoingMessage. No I/O, no
 * secrets — exhaustively unit-tested for subject prefixing, threading headers
 * and quoting across new / reply / reply-all / forward.
 */
export function buildOutgoing(
  from: OutAddress,
  draft: DraftInput,
  context: ComposeContext,
): OutgoingMessage {
  const base: OutgoingMessage = {
    from,
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    text: draft.text,
    html: draft.html,
    attachments: draft.attachments,
  }

  if (context.kind === 'reply') {
    const src = context.source
    base.subject = ensurePrefix(draft.subject || src.subject, 'Re:')
    base.inReplyTo = src.messageId ?? undefined
    base.references = buildReferences(src)
    base.text = draft.text + quoteReply(src)
    // For reply-all, widen recipients to the original To+Cc minus ourselves.
    if (context.replyAll && (!draft.cc || draft.cc.length === 0)) {
      base.cc = replyAllCc(src, from.address)
    }
  } else if (context.kind === 'forward') {
    const src = context.source
    base.subject = ensurePrefix(draft.subject || src.subject, 'Fwd:')
    base.text = draft.text + quoteForward(src)
    // Forward carries the original attachments alongside any new ones.
    base.attachments = mergeAttachments(draft.attachments, src)
  }

  return base
}

/** Adds `prefix` unless the subject already starts with it (case-insensitive). */
function ensurePrefix(subject: string, prefix: string): string {
  const s = subject.trim()
  const p = prefix.trim()
  if (s.toLowerCase().startsWith(p.toLowerCase())) return s
  return `${p} ${s}`.trim()
}

/** References = source.References (if any) + source.Message-ID (threading). */
function buildReferences(src: FullMessage): string[] | undefined {
  const chain: string[] = []
  const prior = (src as FullMessage & { references?: string[] }).references
  if (Array.isArray(prior)) chain.push(...prior)
  if (src.messageId) chain.push(src.messageId)
  return chain.length ? chain : undefined
}

/** Recipients for reply-all: original To + Cc, de-duped, minus our own address. */
function replyAllCc(src: FullMessage, self: string): OutAddress[] {
  const seen = new Set<string>([self.toLowerCase()])
  // The sender is already the primary To on a reply; skip them in Cc too.
  for (const f of src.from) seen.add(f.address.toLowerCase())
  const out: OutAddress[] = []
  for (const a of [...src.to, ...src.cc]) {
    const key = a.address.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(a.name ? { name: a.name, address: a.address } : { address: a.address })
  }
  return out
}

/** A quoted-original block for a reply ("On <date>, <who> wrote:"). */
function quoteReply(src: FullMessage): string {
  const who = fmtFrom(src.from)
  const when = src.date ? new Date(src.date).toUTCString() : ''
  const header = when ? `On ${when}, ${who} wrote:` : `${who} wrote:`
  const body = (src.text || '').split('\n').map((l) => `> ${l}`).join('\n')
  return `\n\n${header}\n${body}`
}

/** A quoted-original block for a forward (original headers + body). */
function quoteForward(src: FullMessage): string {
  const lines = [
    '',
    '',
    '---------- Forwarded message ----------',
    `From: ${fmtFrom(src.from)}`,
    `Date: ${src.date ? new Date(src.date).toUTCString() : ''}`,
    `Subject: ${src.subject}`,
    `To: ${src.to.map(fmtAddr).join(', ')}`,
  ]
  if (src.cc.length) lines.push(`Cc: ${src.cc.map(fmtAddr).join(', ')}`)
  lines.push('', src.text || '')
  return lines.join('\n')
}

/** Note on the source's carried attachments — resolution happens at the caller. */
function mergeAttachments(
  extra: OutAttachment[] | undefined,
  _src: FullMessage,
): OutAttachment[] | undefined {
  // The source's attachment BYTES are supplied by the caller (fetched from IMAP
  // and attached to the draft); FullMessage carries metadata only. We therefore
  // pass through whatever the renderer collected into the draft.
  return extra && extra.length ? extra : undefined
}

function fmtAddr(a: MailAddress): string {
  return a.name ? `${a.name} <${a.address}>` : a.address
}
function fmtFrom(list: MailAddress[]): string {
  return list.length ? fmtAddr(list[0]) : '(unknown sender)'
}
