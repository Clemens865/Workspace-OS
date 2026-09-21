import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { MailService } from './mail-service'
import { ImapClient } from './imap-client'
import { MailAccountStore, type SecretStore, type MailAccountInput } from './account-store'
import { ok } from './types'

/**
 * MailService (read-only orchestration) tests. A real MailAccountStore over a
 * temp dir with a mock SecretStore resolves configs; the ImapClient is wired to
 * an injected fake ImapFlow so no server is hit. We prove the secret-resolution
 * branches and the folder-list cache.
 */

function makeMockSecrets(available = true): SecretStore {
  return {
    isAvailable: () => available,
    encrypt: (p: string) => Buffer.from('ENC::' + p, 'utf-8'),
    decrypt: (c: Buffer) => { const s = c.toString('utf-8'); return s.startsWith('ENC::') ? s.slice(5) : s },
  }
}

const INPUT: MailAccountInput = {
  displayName: 'Alice',
  user: 'alice@example.com',
  imap: { host: 'imap.example.com', port: 993, tls: true },
  smtp: null,
}

function tempStore(secrets = makeMockSecrets()): { store: MailAccountStore; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-svc-'))
  return { store: new MailAccountStore(dir, secrets), dir }
}

function fakeImap(list = vi.fn(async () => [])): ImapClient {
  const mock = {
    connect: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    list,
    getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
    fetch: vi.fn(),
    fetchOne: vi.fn(async () => false),
    mailboxOpen: vi.fn(async () => ({ exists: 0 })),
    on: vi.fn(),
  }
  return new ImapClient(() => mock as never)
}

describe('MailService account management', () => {
  it('lists, adds and removes accounts (metadata only)', async () => {
    const { store, dir } = tempStore()
    try {
      const svc = new MailService(store, fakeImap())
      expect(await svc.listAccounts()).toHaveLength(0)
      const acct = await svc.addAccount(INPUT, 'pw')
      expect((await svc.listAccounts())[0].id).toBe(acct.id)
      await svc.removeAccount(acct.id)
      expect(await svc.listAccounts()).toHaveLength(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('MailService.resolveConfig branches (via listFolders)', () => {
  it('errors not-found for an unknown account', async () => {
    const { store, dir } = tempStore()
    try {
      const res = await new MailService(store, fakeImap()).listFolders('missing')
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error.code).toBe('not-found')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('errors unavailable when secure storage throws on getSecret', async () => {
    const good = tempStore()
    try {
      const acct = await good.store.add(INPUT, 'pw')
      // Point a second store with unavailable secrets at the SAME dir.
      const broken = new MailAccountStore(good.dir, makeMockSecrets(false))
      const res = await new MailService(broken, fakeImap()).listFolders(acct.id)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error.code).toBe('unavailable')
    } finally {
      fs.rmSync(good.dir, { recursive: true, force: true })
    }
  })

  it('caches folder lists within the TTL (second call does not re-hit imap)', async () => {
    const { store, dir } = tempStore()
    try {
      const acct = await store.add(INPUT, 'pw')
      const list = vi.fn(async () => [{ path: 'INBOX', name: 'INBOX', subscribed: true, flags: new Set<string>() }])
      const svc = new MailService(store, fakeImap(list))
      const r1 = await svc.listFolders(acct.id)
      const r2 = await svc.listFolders(acct.id)
      expect(r1.ok && r2.ok).toBe(true)
      expect(list).toHaveBeenCalledOnce() // second read served from cache
      svc.invalidate()
      await svc.listFolders(acct.id)
      expect(list).toHaveBeenCalledTimes(2) // invalidate forces a re-hit
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('MailService demo routing (never hits imap; never resolves a secret)', () => {
  it('routes a demo account to the in-memory backend and NEVER calls imap', async () => {
    const { store, dir } = tempStore()
    try {
      const imap = fakeImap()
      const foldersSpy = vi.spyOn(imap, 'listFolders')
      const listSpy = vi.spyOn(imap, 'listMessages')
      const fetchSpy = vi.spyOn(imap, 'fetchMessage')

      const svc = new MailService(store, imap)
      const demo = await svc.addDemoAccount()
      expect(demo.authKind).toBe('demo')

      const folders = await svc.listFolders(demo.id)
      expect(folders.ok && folders.value.map((f) => f.path)).toEqual(['INBOX', 'Sent', 'Drafts', 'Archive'])

      const msgs = await svc.listMessages(demo.id, 'INBOX', { limit: 5 })
      expect(msgs.ok && msgs.value.length).toBeGreaterThan(0)

      const first = msgs.ok ? msgs.value[0].uid : 0
      const full = await svc.fetchMessage(demo.id, 'INBOX', first)
      expect(full.ok).toBe(true)

      const triage = await svc.triageFolder(demo.id, 'INBOX')
      expect(triage.ok && triage.value.length).toBeGreaterThanOrEqual(2)

      // The spy proof: no imap method was ever called for the demo account.
      expect(foldersSpy).not.toHaveBeenCalled()
      expect(listSpy).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a REAL account still routes to imap (spy IS called)', async () => {
    const { store, dir } = tempStore()
    try {
      const imap = fakeImap(vi.fn(async () => [{ path: 'INBOX', name: 'INBOX', subscribed: true, flags: new Set<string>() }]))
      const foldersSpy = vi.spyOn(imap, 'listFolders')
      const svc = new MailService(store, imap)
      const real = await svc.addAccount(INPUT, 'pw')
      const res = await svc.listFolders(real.id)
      expect(res.ok).toBe(true)
      expect(foldersSpy).toHaveBeenCalledOnce()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('addDemoAccount is idempotent (returns the existing demo account)', async () => {
    const { store, dir } = tempStore()
    try {
      const svc = new MailService(store, fakeImap())
      const a = await svc.addDemoAccount()
      const b = await svc.addDemoAccount()
      expect(b.id).toBe(a.id)
      expect((await svc.listAccounts()).filter((x) => x.authKind === 'demo')).toHaveLength(1)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('demo send appends to Sent (+ Inbox echo) and the message is retrievable', async () => {
    const { store, dir } = tempStore()
    try {
      const svc = new MailService(store, fakeImap())
      const demo = await svc.addDemoAccount()
      const sentBefore = await svc.listMessages(demo.id, 'Sent', { limit: 100 })
      const before = sentBefore.ok ? sentBefore.value.length : 0

      const res = await svc.demoSend(demo.id, {
        from: { name: 'You', address: demo.user },
        to: [{ address: 'priya@acme-partners.com' }],
        subject: 'Demo reply',
        text: 'Sending on the demo path.',
      })
      expect(res.ok).toBe(true)
      const sentAfter = await svc.listMessages(demo.id, 'Sent', { limit: 100 })
      expect(sentAfter.ok && sentAfter.value.length).toBe(before + 1)
      // Retrievable in full.
      const uid = res.ok ? res.value.uid : 0
      const full = await svc.fetchMessage(demo.id, 'Sent', uid)
      expect(full.ok && full.value.text).toBe('Sending on the demo path.')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('MailService.testConnection', () => {
  it('passes ad-hoc credentials through without persisting', async () => {
    const { store, dir } = tempStore()
    try {
      const svc = new MailService(store, fakeImap())
      const res = await svc.testConnection(INPUT, 'pw')
      expect(res).toEqual(ok(true))
      expect(await svc.listAccounts()).toHaveLength(0) // nothing saved
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
