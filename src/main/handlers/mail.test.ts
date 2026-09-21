import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

/**
 * Handler-boundary tests. We register the mail IPC handlers against a fake
 * ipcMain, capture the handler functions, and invoke them directly to prove the
 * boundary VALIDATION/COERCION (addresses, ports, attachment sizes, compose
 * context) before anything reaches the service.
 *
 * electron + safeStorage are mocked (the store never touches a real keychain),
 * and WOS_USERDATA_DIR points at a scratch dir so no real userData is written.
 * The SMTP transport is stubbed so no socket opens; we assert on the nodemailer
 * envelope the coerced draft produced.
 */

const sendMail = vi.fn(async () => ({ messageId: '<ok@x>', accepted: [], rejected: [] }))
const verify = vi.fn(async () => true as const)

vi.mock('electron', () => ({
  // `default` (with `.app.getPath`) is needed because handlers/mail.ts now imports
  // the metrics/ranges singletons (for the live-data + rich-email paths), which do
  // a default import of electron and read app.getPath lazily. Harmless stub.
  default: { app: { getPath: () => os.tmpdir() } },
  app: { getPath: () => os.tmpdir() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from('ENC::' + s, 'utf-8'),
    decryptString: (b: Buffer) => { const s = b.toString('utf-8'); return s.startsWith('ENC::') ? s.slice(5) : s },
  },
}))

// Stub nodemailer so SmtpClient's default factory opens no socket.
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ verify, sendMail, close: () => {} }) },
}))

import { registerMailHandlers } from './mail'
import { IPC } from '../ipc-channels'

type Handler = (event: unknown, ...args: unknown[]) => unknown
let handlers: Map<string, Handler>
let dir: string

function fakeIpcMain(): { handle: (channel: string, fn: Handler) => void } {
  handlers = new Map()
  return { handle: (channel, fn) => handlers.set(channel, fn) }
}

async function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return fn({}, ...args)
}

// The ipc-registry dedupes channels process-wide and the store singleton caches
// its dir at first use, so we register ONCE against one scratch dir. Each test
// seeds its own account so they stay independent.
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-mailh-'))
  process.env.WOS_USERDATA_DIR = dir
  registerMailHandlers(fakeIpcMain() as never)
})

afterAll(() => {
  delete process.env.WOS_USERDATA_DIR
  fs.rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  sendMail.mockClear()
  verify.mockClear()
})

async function seedAccount(): Promise<string> {
  const payload = {
    displayName: 'Alice',
    user: 'alice@example.com',
    imap: { host: 'imap.x', port: 993, tls: true },
    smtp: { host: 'smtp.x', port: 465, tls: true },
  }
  const account = (await call(IPC.MAIL_ACCOUNTS_ADD, payload, 'app-pw')) as { id: string }
  return account.id
}

describe('MAIL_SEND boundary coercion', () => {
  it('drops invalid recipients and sends only well-formed addresses', async () => {
    const id = await seedAccount()
    const res = await call(IPC.MAIL_SEND, id, {
      to: [{ address: 'good@x.com' }, { address: 'not-an-email' }, { address: '' }, 42],
      subject: 'Hi',
      text: 'Body',
    }, { kind: 'new' })
    expect((res as { ok: boolean }).ok).toBe(true)
    const opts = sendMail.mock.calls[0][0] as { to: { address: string }[] }
    expect(opts.to).toEqual([{ address: 'good@x.com' }])
  })

  it('decodes base64 attachments to real bytes', async () => {
    const id = await seedAccount()
    await call(IPC.MAIL_SEND, id, {
      to: [{ address: 'good@x.com' }],
      subject: 'With file',
      text: 'see attached',
      attachments: [{ filename: 'a.txt', content: Buffer.from('hello world').toString('base64'), contentType: 'text/plain' }],
    })
    const opts = sendMail.mock.calls[0][0] as { attachments: { filename: string; content: Buffer }[] }
    expect(opts.attachments[0].filename).toBe('a.txt')
    expect(Buffer.from(opts.attachments[0].content).toString()).toBe('hello world')
  })

  it('applies reply context (Re: + In-Reply-To) via the coerced source', async () => {
    const id = await seedAccount()
    const source = {
      uid: 1, subject: 'Topic', from: [{ name: 'Bob', address: 'bob@x.com' }],
      to: [], cc: [], date: null, messageId: '<p@x>', text: 'orig', html: '',
      hasBlockedRemoteContent: false, attachments: [], flags: [], seen: true,
    }
    await call(IPC.MAIL_SEND, id, { to: [{ address: 'bob@x.com' }], subject: '', text: 'reply body' }, { kind: 'reply', source })
    const opts = sendMail.mock.calls[0][0] as { subject: string; inReplyTo: string }
    expect(opts.subject).toBe('Re: Topic')
    expect(opts.inReplyTo).toBe('<p@x>')
  })

  it('falls back to a plain new message when reply context has no source', async () => {
    const id = await seedAccount()
    await call(IPC.MAIL_SEND, id, { to: [{ address: 'x@y.com' }], subject: 'Plain', text: 'b' }, { kind: 'reply' })
    const opts = sendMail.mock.calls[0][0] as { subject: string; inReplyTo?: string }
    expect(opts.subject).toBe('Plain')
    expect(opts.inReplyTo).toBeUndefined()
  })

  it('returns a typed error (no throw) for an unknown account', async () => {
    const res = await call(IPC.MAIL_SEND, 'missing', { to: [{ address: 'x@y.com' }], subject: 's', text: 't' }, { kind: 'new' })
    expect(res).toMatchObject({ ok: false, error: { code: 'not-found' } })
  })
})

describe('MAIL_SMTP_TEST boundary', () => {
  it('verifies when SMTP config is present', async () => {
    const res = await call(IPC.MAIL_SMTP_TEST, {
      displayName: 'A', user: 'a@x.com',
      imap: { host: 'imap.x', port: 993, tls: true },
      smtp: { host: 'smtp.x', port: 465, tls: true },
    }, 'pw')
    expect(res).toMatchObject({ ok: true })
    expect(verify).toHaveBeenCalledOnce()
  })

  it('rejects when no SMTP server is given', async () => {
    const res = await call(IPC.MAIL_SMTP_TEST, {
      displayName: 'A', user: 'a@x.com', imap: { host: 'imap.x', port: 993, tls: true }, smtp: null,
    }, 'pw')
    expect(res).toMatchObject({ ok: false, error: { code: 'unavailable' } })
    expect(verify).not.toHaveBeenCalled()
  })
})
