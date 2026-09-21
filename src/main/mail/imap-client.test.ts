import { describe, it, expect, vi } from 'vitest'
import { ImapClient, type ImapConnectConfig, type ImapFlowLike } from './imap-client'

/**
 * The IMAP client is exercised with a MOCKED ImapFlow — no real server. We
 * assert the wrapper calls the right imapflow methods and maps envelopes/flags
 * correctly, and that connect failures become typed, sanitized errors.
 */

const CFG: ImapConnectConfig = {
  host: 'imap.example.com',
  port: 993,
  secure: true,
  auth: { user: 'alice@example.com', pass: 'secret-pw' },
}

function makeMock(overrides: Partial<ImapFlowLike> = {}): ImapFlowLike & Record<string, ReturnType<typeof vi.fn>> {
  const base = {
    connect: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    list: vi.fn(async () => []),
    getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
    fetch: vi.fn(),
    fetchOne: vi.fn(async () => false),
    mailboxOpen: vi.fn(async () => ({ exists: 0 })),
    on: vi.fn(),
  }
  return { ...base, ...overrides } as unknown as ImapFlowLike & Record<string, ReturnType<typeof vi.fn>>
}

describe('ImapClient.testConnection', () => {
  it('connects and logs out, returning ok', async () => {
    const mock = makeMock()
    const client = new ImapClient(() => mock)
    const res = await client.testConnection(CFG)
    expect(res.ok).toBe(true)
    expect(mock.connect).toHaveBeenCalledOnce()
    expect(mock.logout).toHaveBeenCalledOnce()
  })

  it('accepts an xoauth2 config (accessToken instead of pass) and connects', async () => {
    const mock = makeMock()
    let seen: ImapConnectConfig | null = null
    const client = new ImapClient((cfg) => { seen = cfg; return mock })
    const res = await client.testConnection({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user: 'oauth@gmail.com', accessToken: 'ya29.ACCESS' },
    })
    expect(res.ok).toBe(true)
    expect(mock.connect).toHaveBeenCalledOnce()
    // The access token (not a password) is what reached the factory.
    expect(seen!.auth.accessToken).toBe('ya29.ACCESS')
    expect(seen!.auth.pass).toBeUndefined()
  })

  it('classifies auth failures without leaking the password', async () => {
    const mock = makeMock({
      connect: vi.fn(async () => {
        throw Object.assign(new Error('Invalid credentials'), { responseText: 'AUTHENTICATIONFAILED' })
      }),
    })
    const client = new ImapClient(() => mock)
    const res = await client.testConnection(CFG)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('auth')
      expect(res.error.message).not.toContain('secret-pw')
    }
  })

  it('classifies host-unreachable errors', async () => {
    const mock = makeMock({
      connect: vi.fn(async () => {
        throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })
      }),
    })
    const res = await new ImapClient(() => mock).testConnection(CFG)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('host')
  })
})

describe('ImapClient.listFolders', () => {
  it('maps raw folders and \\Noselect → not selectable', async () => {
    const mock = makeMock({
      list: vi.fn(async () => [
        { path: 'INBOX', name: 'INBOX', subscribed: true, flags: new Set<string>() },
        { path: '[Gmail]', name: '[Gmail]', subscribed: false, flags: new Set(['\\Noselect']) },
      ]),
    })
    const res = await new ImapClient(() => mock).listFolders(CFG)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value).toHaveLength(2)
      expect(res.value[0]).toMatchObject({ path: 'INBOX', selectable: true, subscribed: true })
      expect(res.value[1].selectable).toBe(false)
    }
  })
})

describe('ImapClient.listMessages — page window', () => {
  const gen = () => (async function* () { /* empty page */ })()

  it('requests only the newest page, not the whole folder', async () => {
    const fetch = vi.fn(() => gen())
    const mock = makeMock({
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      mailboxOpen: vi.fn(async () => ({ exists: 400 })),
      fetch,
    })
    await new ImapClient(() => mock).listMessages(CFG, 'INBOX', { limit: 30 })
    // 400 messages, page of 30 → sequence 371:400. NOT `uid 1:*`.
    expect(fetch.mock.calls[0][0]).toBe('371:400')
  })

  it('pages backwards by offset', async () => {
    const fetch = vi.fn(() => gen())
    const mock = makeMock({
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      mailboxOpen: vi.fn(async () => ({ exists: 400 })),
      fetch,
    })
    await new ImapClient(() => mock).listMessages(CFG, 'INBOX', { limit: 30, offset: 30 })
    expect(fetch.mock.calls[0][0]).toBe('341:370')
  })

  it('clamps the window at the start of a short folder', async () => {
    const fetch = vi.fn(() => gen())
    const mock = makeMock({
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      mailboxOpen: vi.fn(async () => ({ exists: 5 })),
      fetch,
    })
    await new ImapClient(() => mock).listMessages(CFG, 'INBOX', { limit: 30 })
    expect(fetch.mock.calls[0][0]).toBe('1:5')
  })

  it('returns nothing for an empty folder without fetching', async () => {
    const fetch = vi.fn(() => gen())
    const mock = makeMock({
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      mailboxOpen: vi.fn(async () => ({ exists: 0 })),
      fetch,
    })
    const res = await new ImapClient(() => mock).listMessages(CFG, 'INBOX', { limit: 30 })
    expect(res.ok && res.value).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns nothing when paged past the start', async () => {
    const fetch = vi.fn(() => gen())
    const mock = makeMock({
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      mailboxOpen: vi.fn(async () => ({ exists: 10 })),
      fetch,
    })
    const res = await new ImapClient(() => mock).listMessages(CFG, 'INBOX', { limit: 30, offset: 50 })
    expect(res.ok && res.value).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('ImapClient.listMessages', () => {
  it('fetches envelopes, maps flags, sorts newest-first and caps to limit', async () => {
    async function* gen() {
      yield {
        uid: 1,
        flags: new Set<string>(['\\Seen']),
        envelope: { subject: 'Old', from: [{ name: 'A', address: 'a@x.com' }], date: new Date('2026-01-01') },
      }
      yield {
        uid: 5,
        flags: new Set<string>(),
        envelope: { subject: 'New', from: [{ address: 'b@x.com' }], date: new Date('2026-07-01') },
        bodyStructure: { childNodes: [{ disposition: 'attachment' }] },
      }
    }
    const release = vi.fn()
    const mock = makeMock({
      getMailboxLock: vi.fn(async () => ({ release })),
      // listMessages now asks how many messages the folder holds so it can
      // request ONE PAGE by sequence number instead of `uid 1:*` (which
      // transferred the whole folder on every call).
      mailboxOpen: vi.fn(async () => ({ exists: 2 })),
      fetch: vi.fn(() => gen()),
    })
    const client = new ImapClient(() => mock)
    const res = await client.listMessages(CFG, 'INBOX', { limit: 10 })
    expect(res.ok).toBe(true)
    if (res.ok) {
      // Newest (uid 5) first.
      expect(res.value.map((m) => m.uid)).toEqual([5, 1])
      const newMsg = res.value[0]
      expect(newMsg.subject).toBe('New')
      expect(newMsg.seen).toBe(false)
      expect(newMsg.hasAttachments).toBe(true)
      expect(res.value[1].seen).toBe(true)
    }
    expect(mock.getMailboxLock).toHaveBeenCalledWith('INBOX')
    expect(release).toHaveBeenCalledOnce()
    expect(mock.logout).toHaveBeenCalledOnce()
  })
})

describe('ImapClient.fetchMessage', () => {
  it('fetches source, parses it, and derives seen from flags', async () => {
    const source = Buffer.from(
      ['From: a@x.com', 'To: b@x.com', 'Subject: Hi', '', 'Body text here', ''].join('\r\n'),
    )
    const mock = makeMock({
      fetchOne: vi.fn(async () => ({ uid: 7, flags: new Set<string>(['\\Seen']), source })),
    })
    const res = await new ImapClient(() => mock).fetchMessage(CFG, 'INBOX', 7)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.uid).toBe(7)
      expect(res.value.subject).toBe('Hi')
      expect(res.value.text).toContain('Body text here')
      expect(res.value.seen).toBe(true)
    }
  })

  it('returns a not-found error when the message is missing', async () => {
    const mock = makeMock({ fetchOne: vi.fn(async () => false) })
    const res = await new ImapClient(() => mock).fetchMessage(CFG, 'INBOX', 99)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('not-found')
  })
})
