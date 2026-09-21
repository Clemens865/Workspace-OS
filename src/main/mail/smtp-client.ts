import nodemailer from 'nodemailer'
import type { MailResult, MailErrorCode, OutgoingMessage, SendResult } from './types'
import { ok, err } from './types'

/**
 * Thin, typed wrapper over nodemailer.
 *
 * Design rules (mirror imap-client.ts):
 *  - Nothing throws raw into IPC: every public method returns a MailResult and
 *    connect/send errors are classified (auth / TLS / host / timeout) into a
 *    typed, SANITIZED MailError. The password is never placed in a log or error.
 *  - The transport factory is injectable (`makeTransport`) so unit tests drive a
 *    fake transport and assert we call sendMail/verify with the right args — no
 *    socket is opened in unit tests.
 *  - Transports are short-lived: create → verify/send → close. Verbose logging
 *    is disabled so the SMTP conversation (incl. AUTH) can never surface.
 */

/**
 * SMTP auth is EITHER an app-password (`pass`) OR an OAuth2 access token
 * (`accessToken`). xoauth2 accounts resolve a fresh access token at send-time
 * and never carry a password.
 */
export interface SmtpConnectConfig {
  host: string
  port: number
  secure: boolean // true = implicit TLS (465)
  /**
   * When true (and `secure` is false), MANDATE a STARTTLS upgrade before AUTH —
   * so credentials never ride a plaintext socket on port 587/25. Set by the
   * send path for real submission ports; omitted for a plaintext test server.
   */
  requireTLS?: boolean
  auth: { user: string; pass?: string; accessToken?: string }
}

/** The subset of a nodemailer transporter we depend on (keeps the fake small). */
export interface TransportLike {
  verify(): Promise<true>
  sendMail(message: object): Promise<{ messageId?: string; accepted?: unknown[]; rejected?: unknown[] }>
  close(): void
}

/** Factory type — production uses `nodemailer.createTransport`; tests inject a fake. */
export type TransportFactory = (config: SmtpConnectConfig) => TransportLike

/**
 * The nodemailer transport options we compute for an SMTP connect. Exported so a
 * unit test can assert the 465-vs-587 mapping WITHOUT opening a socket.
 *
 * The mapping is the correctness core of multi-provider send:
 *  - `secure: true`  → implicit TLS on connect (SMTP 465; Gmail/Yahoo/Fastmail).
 *  - `secure: false` + `requireTLS` → plaintext connect that MUST upgrade via
 *    STARTTLS before AUTH (SMTP 587; iCloud/Outlook). Without requireTLS,
 *    nodemailer would send AUTH in the clear on 587 — so the send path sets it
 *    for real submission ports. (A plaintext test server leaves it unset.)
 */
export interface SmtpTransportOptions {
  host: string
  port: number
  secure: boolean
  requireTLS?: boolean
}

/**
 * Derive the nodemailer transport options from the connect config. `secure` is
 * honoured as given (the caller sets it from the port: 465 ⇒ true). `requireTLS`
 * is forwarded only when the caller asked for it AND we're not already on
 * implicit TLS — mandating the STARTTLS upgrade for 587. Pure + exported for the
 * secure-mapping unit test.
 */
export function toTransportOptions(config: SmtpConnectConfig): SmtpTransportOptions {
  const opts: SmtpTransportOptions = { host: config.host, port: config.port, secure: config.secure }
  if (!config.secure && config.requireTLS) opts.requireTLS = true
  return opts
}

const defaultFactory: TransportFactory = (config) =>
  nodemailer.createTransport({
    ...toTransportOptions(config),
    // nodemailer performs XOAUTH2 when given { type:'OAuth2', user, accessToken }.
    // Otherwise it's plain LOGIN with the app-password. Exactly one is set.
    auth: config.auth.accessToken
      ? { type: 'OAuth2', user: config.auth.user, accessToken: config.auth.accessToken }
      : { user: config.auth.user, pass: config.auth.pass ?? '' },
    // Silence nodemailer's own logging — its debug stream echoes the full SMTP
    // conversation (incl. the AUTH command) and must never surface.
    logger: false,
    debug: false,
    // Bound the handshake so an unreachable host fails fast into a typed error.
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 30_000,
  }) as unknown as TransportLike

export class SmtpClient {
  constructor(private readonly makeTransport: TransportFactory = defaultFactory) {}

  /** Runs `fn` against a fresh transport, guaranteeing close(). */
  private async withTransport<T>(
    config: SmtpConnectConfig,
    fn: (t: TransportLike) => Promise<T>,
  ): Promise<MailResult<T>> {
    let transport: TransportLike
    try {
      transport = this.makeTransport(config)
    } catch (e) {
      return err(classify(e), sanitize(e))
    }
    try {
      const value = await fn(transport)
      return ok(value)
    } catch (e) {
      return err(classify(e), sanitize(e))
    } finally {
      try {
        transport.close()
      } catch {
        /* best-effort teardown */
      }
    }
  }

  /** Connect + auth check — the settings "Test connection" probe for SMTP. */
  async verify(config: SmtpConnectConfig): Promise<MailResult<true>> {
    return this.withTransport(config, async (t) => {
      await t.verify()
      return true as const
    })
  }

  /** Builds a nodemailer envelope from an OutgoingMessage and sends it. */
  async send(config: SmtpConnectConfig, message: OutgoingMessage): Promise<MailResult<SendResult>> {
    return this.withTransport(config, async (t) => {
      const info = await t.sendMail(toNodemailer(message))
      return {
        messageId: String(info.messageId ?? ''),
        accepted: (info.accepted ?? []).map(String),
        rejected: (info.rejected ?? []).map(String),
      }
    })
  }
}

/** Maps our OutgoingMessage into the nodemailer sendMail options shape. */
function toNodemailer(m: OutgoingMessage): Record<string, unknown> {
  const addr = (a: { name?: string; address: string }): { name?: string; address: string } =>
    a.name ? { name: a.name, address: a.address } : { address: a.address }
  const opts: Record<string, unknown> = {
    from: addr(m.from),
    to: m.to.map(addr),
    subject: m.subject,
    text: m.text,
  }
  if (m.cc && m.cc.length) opts.cc = m.cc.map(addr)
  if (m.bcc && m.bcc.length) opts.bcc = m.bcc.map(addr)
  if (m.html) opts.html = m.html
  if (m.inReplyTo) opts.inReplyTo = m.inReplyTo
  if (m.references && m.references.length) opts.references = m.references
  if (m.attachments && m.attachments.length) {
    opts.attachments = m.attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      ...(a.contentType ? { contentType: a.contentType } : {}),
      // A cid makes nodemailer emit an inline Content-ID part the html's
      // `cid:` image references resolve to.
      ...(a.cid ? { cid: a.cid } : {}),
    }))
  }
  return opts
}

/** Maps a thrown error to a typed code WITHOUT leaking the message verbatim. */
function classify(e: unknown): MailErrorCode {
  const raw = (e as { code?: string; responseCode?: number; response?: string; message?: string }) || {}
  const text = `${raw.code ?? ''} ${raw.responseCode ?? ''} ${raw.response ?? ''} ${raw.message ?? ''}`.toLowerCase()
  // SMTP auth failures are 535/534 or carry EAUTH.
  if (/eauth|535|534|auth|login|credential|password|invalid|denied/.test(text)) return 'auth'
  if (/cert|tls|ssl|self[- ]?signed|wrong version number/.test(text)) return 'tls'
  if (/enotfound|eai_again|ehostunreach|econnrefused|econnreset|dns/.test(text)) return 'host'
  if (/timeout|etimedout/.test(text)) return 'timeout'
  return 'unknown'
}

/**
 * Produces a safe, generic human message. We deliberately do NOT echo the raw
 * error text (which some SMTP servers pad with the attempted login) — we map to
 * a fixed sentence per class so a password can never ride out in an error.
 */
function sanitize(e: unknown): string {
  switch (classify(e)) {
    case 'auth':
      return 'Authentication failed — the server rejected these credentials. Gmail / Yahoo / iCloud need an app-specific password; Outlook / Hotmail now require “Sign in with Microsoft” (Microsoft disabled password sign-in in 2024).'
    case 'tls':
      return 'Secure connection failed — the server’s TLS certificate could not be verified.'
    case 'host':
      return 'Could not reach the mail server — check the SMTP host and port.'
    case 'timeout':
      return 'The connection timed out.'
    default:
      return 'The mail server returned an unexpected error.'
  }
}
