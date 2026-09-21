import { describe, it, expect, vi } from 'vitest'
import { SmtpClient, toTransportOptions, type SmtpConnectConfig, type TransportLike } from './smtp-client'
import type { OutgoingMessage } from './types'

/**
 * The SMTP client is exercised with an INJECTED fake transport — no socket. We
 * assert the wrapper calls verify/sendMail with the right nodemailer options,
 * maps results, closes the transport, and turns failures into typed, sanitized
 * errors that never leak the password.
 */

const CFG: SmtpConnectConfig = {
  host: 'smtp.example.com',
  port: 465,
  secure: true,
  auth: { user: 'alice@example.com', pass: 'secret-pw' },
}

const MSG: OutgoingMessage = {
  from: { name: 'Alice', address: 'alice@example.com' },
  to: [{ address: 'bob@example.com' }],
  subject: 'Hello',
  text: 'Body text',
}

function makeTransport(overrides: Partial<TransportLike> = {}): TransportLike & Record<string, ReturnType<typeof vi.fn>> {
  const base = {
    verify: vi.fn(async () => true as const),
    sendMail: vi.fn(async () => ({ messageId: '<generated@smtp>', accepted: ['bob@example.com'], rejected: [] })),
    close: vi.fn(),
  }
  return { ...base, ...overrides } as unknown as TransportLike & Record<string, ReturnType<typeof vi.fn>>
}

/**
 * The correctness core of multi-provider send: 465 must map to implicit TLS
 * (secure:true) and 587 to STARTTLS (secure:false + requireTLS). A single "use
 * TLS" boolean can't be correct for both — the old `secure:tls` mapping sent
 * AUTH in the clear on 587 (Outlook/iCloud). These assert the exact options the
 * transport factory computes, with NO socket opened.
 */
describe('toTransportOptions — 465 vs 587 secure mapping', () => {
  it('465 ⇒ implicit TLS (secure:true, no requireTLS)', () => {
    const opts = toTransportOptions({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: 'a@gmail.com', pass: 'pw' },
    })
    expect(opts.secure).toBe(true)
    expect(opts.requireTLS).toBeUndefined()
    expect(opts.port).toBe(465)
  })

  it('587 with requireTLS ⇒ STARTTLS (secure:false, requireTLS:true)', () => {
    const opts = toTransportOptions({
      host: 'smtp.office365.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'a@outlook.com', pass: 'pw' },
    })
    expect(opts.secure).toBe(false)
    expect(opts.requireTLS).toBe(true)
    expect(opts.port).toBe(587)
  })

  it('secure:false WITHOUT requireTLS stays plaintext (e2e / opt-out) — no forced STARTTLS', () => {
    const opts = toTransportOptions({
      host: '127.0.0.1',
      port: 2525,
      secure: false,
      auth: { user: 'x', pass: 'y' },
    })
    expect(opts.secure).toBe(false)
    expect(opts.requireTLS).toBeUndefined()
  })

  it('the injected transport factory receives secure:false + requireTLS on 587', async () => {
    let seen: Record<string, unknown> | null = null
    const factory = (cfg: SmtpConnectConfig): TransportLike => {
      seen = toTransportOptions(cfg) as unknown as Record<string, unknown>
      return makeTransport()
    }
    await new SmtpClient(factory).verify({
      host: 'smtp.mail.me.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'me@icloud.com', pass: 'app-pw' },
    })
    expect(seen).toMatchObject({ port: 587, secure: false, requireTLS: true })
  })
})

describe('SmtpClient.verify', () => {
  it('verifies and closes, returning ok', async () => {
    const t = makeTransport()
    const res = await new SmtpClient(() => t).verify(CFG)
    expect(res.ok).toBe(true)
    expect(t.verify).toHaveBeenCalledOnce()
    expect(t.close).toHaveBeenCalledOnce()
  })

  it('accepts an xoauth2 config (accessToken instead of pass) and passes it to the factory', async () => {
    const t = makeTransport()
    let seen: SmtpConnectConfig | null = null
    const res = await new SmtpClient((cfg) => { seen = cfg; return t }).verify({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: 'oauth@gmail.com', accessToken: 'ya29.ACCESS' },
    })
    expect(res.ok).toBe(true)
    expect(seen!.auth.accessToken).toBe('ya29.ACCESS')
    expect(seen!.auth.pass).toBeUndefined()
  })

  it('classifies auth failures (535) without leaking the password', async () => {
    const t = makeTransport({
      verify: vi.fn(async () => {
        throw Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535 })
      }),
    })
    const res = await new SmtpClient(() => t).verify(CFG)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('auth')
      expect(res.error.message).not.toContain('secret-pw')
    }
    expect(t.close).toHaveBeenCalledOnce() // still closed on failure
  })

  it('classifies host-unreachable errors', async () => {
    const t = makeTransport({
      verify: vi.fn(async () => {
        throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })
      }),
    })
    const res = await new SmtpClient(() => t).verify(CFG)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('host')
  })

  it('classifies TLS errors', async () => {
    const t = makeTransport({
      verify: vi.fn(async () => {
        throw Object.assign(new Error('self-signed certificate'), { code: 'ESOCKET' })
      }),
    })
    const res = await new SmtpClient(() => t).verify(CFG)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('tls')
  })

  it('classifies timeouts', async () => {
    const t = makeTransport({
      verify: vi.fn(async () => {
        throw Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' })
      }),
    })
    const res = await new SmtpClient(() => t).verify(CFG)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('timeout')
  })

  it('falls back to unknown for unclassifiable errors', async () => {
    const t = makeTransport({ verify: vi.fn(async () => { throw new Error('kaboom') }) })
    const res = await new SmtpClient(() => t).verify(CFG)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('unknown')
  })

  it('returns a typed error when the transport factory itself throws', async () => {
    const res = await new SmtpClient(() => { throw new Error('bad config') }).verify(CFG)
    expect(res.ok).toBe(false)
  })
})

describe('SmtpClient.send', () => {
  it('sends and maps accepted/rejected/messageId', async () => {
    const t = makeTransport()
    const res = await new SmtpClient(() => t).send(CFG, MSG)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.messageId).toBe('<generated@smtp>')
      expect(res.value.accepted).toEqual(['bob@example.com'])
      expect(res.value.rejected).toEqual([])
    }
    expect(t.close).toHaveBeenCalledOnce()
  })

  it('passes the correct nodemailer envelope (from/to/subject/text)', async () => {
    const t = makeTransport()
    await new SmtpClient(() => t).send(CFG, MSG)
    const opts = t.sendMail.mock.calls[0][0]
    expect(opts).toMatchObject({
      from: { name: 'Alice', address: 'alice@example.com' },
      to: [{ address: 'bob@example.com' }],
      subject: 'Hello',
      text: 'Body text',
    })
  })

  it('carries cc, bcc, html, threading headers and attachments through', async () => {
    const t = makeTransport()
    const full: OutgoingMessage = {
      ...MSG,
      cc: [{ address: 'carol@example.com' }],
      bcc: [{ address: 'dave@example.com' }],
      html: '<p>hi</p>',
      inReplyTo: '<parent@x>',
      references: ['<root@x>', '<parent@x>'],
      attachments: [{ filename: 'a.txt', content: Buffer.from('data'), contentType: 'text/plain' }],
    }
    await new SmtpClient(() => t).send(CFG, full)
    const opts = t.sendMail.mock.calls[0][0] as Record<string, unknown>
    expect(opts.cc).toEqual([{ address: 'carol@example.com' }])
    expect(opts.bcc).toEqual([{ address: 'dave@example.com' }])
    expect(opts.html).toBe('<p>hi</p>')
    expect(opts.inReplyTo).toBe('<parent@x>')
    expect(opts.references).toEqual(['<root@x>', '<parent@x>'])
    const atts = opts.attachments as { filename: string; content: Buffer }[]
    expect(atts[0].filename).toBe('a.txt')
    expect(atts[0].content.toString()).toBe('data')
  })

  it('classifies a send auth failure and does not leak the password', async () => {
    const t = makeTransport({
      sendMail: vi.fn(async () => { throw Object.assign(new Error('535 auth'), { responseCode: 535 }) }),
    })
    const res = await new SmtpClient(() => t).send(CFG, MSG)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('auth')
      expect(res.error.message).not.toContain('secret-pw')
    }
  })
})
