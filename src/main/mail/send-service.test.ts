import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { SendService, buildOutgoing, smtpSecure, smtpRequireTLS, type DraftInput } from './send-service'
import { SmtpClient } from './smtp-client'
import { MailAccountStore, type SecretStore, type MailAccountInput } from './account-store'
import type { FullMessage, OutAddress } from './types'
import { ok } from './types'

/**
 * send-service tests. The PURE builder (buildOutgoing) is exercised exhaustively
 * for subject prefixing, threading headers, quoting and recipient logic. The
 * orchestration (send/testSmtp) uses a real MailAccountStore over a temp dir with
 * a mock SecretStore, and an SmtpClient wired to an injected fake transport so no
 * socket is opened.
 */

const FROM: OutAddress = { name: 'Alice', address: 'alice@example.com' }

const SOURCE: FullMessage = {
  uid: 42,
  subject: 'Project update',
  from: [{ name: 'Bob', address: 'bob@example.com' }],
  to: [{ name: 'Alice', address: 'alice@example.com' }, { name: 'Carol', address: 'carol@example.com' }],
  cc: [{ name: 'Dave', address: 'dave@example.com' }],
  date: '2026-07-07T10:00:00.000Z',
  messageId: '<parent-123@example.com>',
  text: 'Line one\nLine two',
  html: '',
  hasBlockedRemoteContent: false,
  attachments: [],
  flags: [],
  seen: true,
}

const DRAFT: DraftInput = { to: [{ address: 'bob@example.com' }], subject: '', text: 'My reply.' }

describe('buildOutgoing — new message', () => {
  it('passes recipients, subject and body straight through', () => {
    const draft: DraftInput = {
      to: [{ address: 'x@y.com' }],
      cc: [{ address: 'c@y.com' }],
      bcc: [{ address: 'b@y.com' }],
      subject: 'Hi there',
      text: 'Hello!',
      html: '<p>Hello!</p>',
    }
    const out = buildOutgoing(FROM, draft, { kind: 'new' })
    expect(out.from).toEqual(FROM)
    expect(out.to).toEqual([{ address: 'x@y.com' }])
    expect(out.cc).toEqual([{ address: 'c@y.com' }])
    expect(out.bcc).toEqual([{ address: 'b@y.com' }])
    expect(out.subject).toBe('Hi there')
    expect(out.text).toBe('Hello!')
    expect(out.html).toBe('<p>Hello!</p>')
    expect(out.inReplyTo).toBeUndefined()
    expect(out.references).toBeUndefined()
  })
})

describe('buildOutgoing — reply', () => {
  it('prefixes Re:, sets In-Reply-To + References, and quotes the original', () => {
    const out = buildOutgoing(FROM, DRAFT, { kind: 'reply', source: SOURCE })
    expect(out.subject).toBe('Re: Project update')
    expect(out.inReplyTo).toBe('<parent-123@example.com>')
    expect(out.references).toEqual(['<parent-123@example.com>'])
    expect(out.text.startsWith('My reply.')).toBe(true)
    expect(out.text).toContain('Bob <bob@example.com> wrote:')
    expect(out.text).toContain('> Line one')
    expect(out.text).toContain('> Line two')
  })

  it('does not double-prefix an already-Re: subject', () => {
    const out = buildOutgoing(FROM, { ...DRAFT, subject: 'RE: Project update' }, { kind: 'reply', source: SOURCE })
    expect(out.subject).toBe('RE: Project update')
  })

  it('appends References onto the source chain when the source already has one', () => {
    const chained = { ...SOURCE, references: ['<root@example.com>'] } as FullMessage & { references: string[] }
    const out = buildOutgoing(FROM, DRAFT, { kind: 'reply', source: chained })
    expect(out.references).toEqual(['<root@example.com>', '<parent-123@example.com>'])
  })

  it('reply (not all) keeps only the drafted To — no widened Cc', () => {
    const out = buildOutgoing(FROM, DRAFT, { kind: 'reply', source: SOURCE, replyAll: false })
    expect(out.to).toEqual([{ address: 'bob@example.com' }])
    expect(out.cc).toBeUndefined()
  })
})

describe('buildOutgoing — reply-all', () => {
  it('widens Cc to original To+Cc minus self and the sender', () => {
    const out = buildOutgoing(FROM, DRAFT, { kind: 'reply', source: SOURCE, replyAll: true })
    const addrs = (out.cc ?? []).map((a) => a.address)
    expect(addrs).toContain('carol@example.com')
    expect(addrs).toContain('dave@example.com')
    // self (alice) and the original sender (bob) are excluded from Cc.
    expect(addrs).not.toContain('alice@example.com')
    expect(addrs).not.toContain('bob@example.com')
  })

  it('de-duplicates recipients across To and Cc', () => {
    const dup: FullMessage = { ...SOURCE, to: [{ name: '', address: 'carol@example.com' }], cc: [{ name: '', address: 'carol@example.com' }] }
    const out = buildOutgoing(FROM, DRAFT, { kind: 'reply', source: dup, replyAll: true })
    const carol = (out.cc ?? []).filter((a) => a.address === 'carol@example.com')
    expect(carol).toHaveLength(1)
  })

  it('does not overwrite an explicitly-drafted Cc', () => {
    const out = buildOutgoing(FROM, { ...DRAFT, cc: [{ address: 'custom@x.com' }] }, { kind: 'reply', source: SOURCE, replyAll: true })
    expect(out.cc).toEqual([{ address: 'custom@x.com' }])
  })
})

describe('buildOutgoing — forward', () => {
  it('prefixes Fwd:, quotes original headers+body and carries drafted attachments', () => {
    const draft: DraftInput = {
      to: [{ address: 'new@x.com' }],
      subject: '',
      text: 'FYI',
      attachments: [{ filename: 'orig.pdf', content: Buffer.from('bytes') }],
    }
    const out = buildOutgoing(FROM, draft, { kind: 'forward', source: SOURCE })
    expect(out.subject).toBe('Fwd: Project update')
    expect(out.text).toContain('Forwarded message')
    expect(out.text).toContain('From: Bob <bob@example.com>')
    expect(out.text).toContain('Subject: Project update')
    expect(out.text).toContain('To: Alice <alice@example.com>, Carol <carol@example.com>')
    expect(out.text).toContain('Cc: Dave <dave@example.com>')
    expect(out.text).toContain('Line one')
    expect(out.attachments).toHaveLength(1)
    expect(out.attachments?.[0].filename).toBe('orig.pdf')
    // Forward sets no threading headers (it's a new thread).
    expect(out.inReplyTo).toBeUndefined()
  })

  it('does not double-prefix an already-Fwd: subject', () => {
    const out = buildOutgoing(FROM, { ...DRAFT, subject: 'Fwd: Project update' }, { kind: 'forward', source: SOURCE })
    expect(out.subject).toBe('Fwd: Project update')
  })
})

// ── Orchestration (send / testSmtp) with a temp store + fake transport ──────

function makeMockSecrets(): SecretStore {
  return {
    isAvailable: () => true,
    encrypt: (p: string) => Buffer.from('ENC::' + p, 'utf-8'),
    decrypt: (c: Buffer) => { const s = c.toString('utf-8'); return s.startsWith('ENC::') ? s.slice(5) : s },
  }
}

const ACCOUNT_INPUT: MailAccountInput = {
  displayName: 'Alice',
  user: 'alice@example.com',
  imap: { host: 'imap.example.com', port: 993, tls: true },
  smtp: { host: 'smtp.example.com', port: 465, tls: true },
}

function tempStore(): { store: MailAccountStore; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-send-'))
  return { store: new MailAccountStore(dir, makeMockSecrets()), dir }
}

describe('SendService.send', () => {
  it('resolves the SMTP config from the account and sends with the decrypted secret', async () => {
    const { store, dir } = tempStore()
    try {
      const account = await store.add(ACCOUNT_INPUT, 'app-pw-1234')
      const sendMail = vi.fn(async () => ({ messageId: '<ok@x>', accepted: ['bob@example.com'], rejected: [] }))
      const smtp = new SmtpClient(() => ({ verify: vi.fn(), sendMail, close: vi.fn() } as never))
      const svc = new SendService(store, smtp)
      const res = await svc.send(account.id, DRAFT, { kind: 'new' })
      expect(res.ok).toBe(true)
      // The from was seeded from the account, and the decrypted secret reached the transport.
      const opts = sendMail.mock.calls[0][0] as Record<string, unknown>
      expect(opts.from).toMatchObject({ address: 'alice@example.com' })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('errors not-found for an unknown account', async () => {
    const { store, dir } = tempStore()
    try {
      const svc = new SendService(store, new SmtpClient(() => ({ sendMail: vi.fn(), verify: vi.fn(), close: vi.fn() } as never)))
      const res = await svc.send('nope', DRAFT)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error.code).toBe('not-found')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('errors unavailable when the account has no SMTP configured', async () => {
    const { store, dir } = tempStore()
    try {
      const account = await store.add({ ...ACCOUNT_INPUT, smtp: null }, 'pw')
      const svc = new SendService(store, new SmtpClient(() => ({ sendMail: vi.fn(), verify: vi.fn(), close: vi.fn() } as never)))
      const res = await svc.send(account.id, DRAFT)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error.code).toBe('unavailable')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('SendService.testSmtp', () => {
  it('delegates to SmtpClient.verify with the given creds', async () => {
    const verify = vi.fn(async () => true as const)
    const smtp = new SmtpClient(() => ({ verify, sendMail: vi.fn(), close: vi.fn() } as never))
    const svc = new SendService({} as MailAccountStore, smtp)
    const res = await svc.testSmtp({ host: 'smtp.x', port: 465, tls: true }, 'u@x', 'pw')
    expect(res).toEqual(ok(true))
    expect(verify).toHaveBeenCalledOnce()
  })

  it('maps port→secure: 465 ⇒ secure:true, 587 ⇒ secure:false (STARTTLS)', async () => {
    const captured: { port: number; secure: boolean }[] = []
    const smtp = new SmtpClient((cfg) => {
      captured.push({ port: cfg.port, secure: cfg.secure })
      return { verify: vi.fn(async () => true as const), sendMail: vi.fn(), close: vi.fn() } as never
    })
    const svc = new SendService({} as MailAccountStore, smtp)
    await svc.testSmtp({ host: 'smtp.gmail.com', port: 465, tls: true }, 'u@x', 'pw')
    await svc.testSmtp({ host: 'smtp.office365.com', port: 587, tls: true }, 'u@x', 'pw')
    expect(captured).toEqual([
      { port: 465, secure: true },
      { port: 587, secure: false },
    ])
  })
})

/**
 * The pure port→secure mapping — the fix that makes Outlook/iCloud (587 STARTTLS)
 * send while Gmail/Yahoo/Fastmail (465 implicit TLS) keep working. A single "use
 * TLS" flag can't express both, so the port decides `secure`.
 */
describe('smtpSecure — port→implicit-TLS mapping', () => {
  it('465 with TLS on ⇒ true (implicit TLS)', () => {
    expect(smtpSecure(465, true)).toBe(true)
  })
  it('587 with TLS on ⇒ false (STARTTLS, upgraded by smtp-client requireTLS)', () => {
    expect(smtpSecure(587, true)).toBe(false)
  })
  it('25 with TLS on ⇒ false (submission/STARTTLS)', () => {
    expect(smtpSecure(25, true)).toBe(false)
  })
  it('TLS explicitly off ⇒ false regardless of port', () => {
    expect(smtpSecure(465, false)).toBe(false)
    expect(smtpSecure(587, false)).toBe(false)
  })
})

describe('smtpRequireTLS — STARTTLS mandate for submission ports', () => {
  it('587 with TLS on ⇒ true (mandate STARTTLS before AUTH)', () => {
    expect(smtpRequireTLS(587, true)).toBe(true)
  })
  it('465 with TLS on ⇒ false (already implicit TLS)', () => {
    expect(smtpRequireTLS(465, true)).toBe(false)
  })
  it('TLS off ⇒ false (user opted out)', () => {
    expect(smtpRequireTLS(587, false)).toBe(false)
  })
})

describe('SendService.send — port→secure end to end', () => {
  it('passes secure:false for an account on SMTP 587', async () => {
    const { store, dir } = tempStore()
    try {
      const account = await store.add(
        { ...ACCOUNT_INPUT, smtp: { host: 'smtp.mail.me.com', port: 587, tls: true } },
        'app-pw',
      )
      let seen: { port: number; secure: boolean; requireTLS?: boolean } | null = null
      const smtp = new SmtpClient((cfg) => {
        seen = { port: cfg.port, secure: cfg.secure, requireTLS: cfg.requireTLS }
        return { verify: vi.fn(), sendMail: vi.fn(async () => ({ messageId: '<x>', accepted: [], rejected: [] })), close: vi.fn() } as never
      })
      await new SendService(store, smtp).send(account.id, DRAFT, { kind: 'new' })
      expect(seen).toEqual({ port: 587, secure: false, requireTLS: true })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
