import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import { MailAccountStore, type SecretStore, type MailAccountInput } from './account-store'

/**
 * A mock SecretStore standing in for Electron safeStorage. It "encrypts" by
 * prefixing a marker so a test can prove (a) the plaintext is never written to
 * the accounts JSON, and (b) the round-trip works.
 */
function makeMockSecrets(available = true): SecretStore & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    isAvailable: () => available,
    encrypt: (plaintext: string) => {
      calls.push('encrypt')
      return Buffer.from('ENC::' + plaintext, 'utf-8')
    },
    decrypt: (ciphertext: Buffer) => {
      calls.push('decrypt')
      const s = ciphertext.toString('utf-8')
      return s.startsWith('ENC::') ? s.slice(5) : s
    },
  }
}

const INPUT: MailAccountInput = {
  displayName: 'My Mail',
  user: 'alice@example.com',
  imap: { host: 'imap.example.com', port: 993, tls: true },
  smtp: { host: 'smtp.example.com', port: 465, tls: true },
}

const PASSWORD = 'super-secret-app-password-1234'

describe('MailAccountStore', () => {
  let dir: string
  let secrets: ReturnType<typeof makeMockSecrets>
  let store: MailAccountStore

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-mail-'))
    secrets = makeMockSecrets()
    store = new MailAccountStore(dir, secrets)
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('creates an account and returns non-secret metadata only', async () => {
    const acct = await store.add(INPUT, PASSWORD)
    expect(acct.id).toMatch(/^[0-9a-f]+$/)
    expect(acct.user).toBe('alice@example.com')
    expect(acct.imap.host).toBe('imap.example.com')
    // The record itself must not carry any secret field.
    expect(JSON.stringify(acct)).not.toContain(PASSWORD)
    expect((acct as Record<string, unknown>).password).toBeUndefined()
    expect((acct as Record<string, unknown>).secret).toBeUndefined()
  })

  it('NEVER writes the plaintext password into the accounts JSON', async () => {
    await store.add(INPUT, PASSWORD)
    const accountsRaw = await fsp.readFile(path.join(dir, 'mail-accounts.json'), 'utf-8')
    expect(accountsRaw).not.toContain(PASSWORD)
    expect(accountsRaw).toContain('imap.example.com') // metadata IS there
  })

  it('stores the secret encrypted (base64 ciphertext) in a SEPARATE file', async () => {
    const acct = await store.add(INPUT, PASSWORD)
    const secretsRaw = await fsp.readFile(path.join(dir, 'mail-secrets.json'), 'utf-8')
    // Plaintext must not appear even in the secrets file (it's ciphertext base64).
    expect(secretsRaw).not.toContain(PASSWORD)
    const map = JSON.parse(secretsRaw) as Record<string, string>
    expect(map[acct.id]).toBeDefined()
    // Decoding the base64 yields our mock's ciphertext marker, not the plaintext.
    const decoded = Buffer.from(map[acct.id], 'base64').toString('utf-8')
    expect(decoded.startsWith('ENC::')).toBe(true)
    expect(secrets.calls).toContain('encrypt')
  })

  it('round-trips the secret via getSecret (safeStorage mocked)', async () => {
    const acct = await store.add(INPUT, PASSWORD)
    const got = await store.getSecret(acct.id)
    expect(got).toBe(PASSWORD)
    expect(secrets.calls).toContain('decrypt')
  })

  it('lists and gets accounts', async () => {
    const a = await store.add(INPUT, PASSWORD)
    const b = await store.add({ ...INPUT, user: 'bob@example.com' }, 'pw2')
    const list = await store.list()
    expect(list.map((x) => x.user).sort()).toEqual(['alice@example.com', 'bob@example.com'])
    expect((await store.get(a.id))?.user).toBe('alice@example.com')
    expect((await store.get(b.id))?.user).toBe('bob@example.com')
  })

  it('remove deletes both the account record and its stored secret', async () => {
    const acct = await store.add(INPUT, PASSWORD)
    await store.remove(acct.id)
    expect(await store.get(acct.id)).toBeNull()
    expect(await store.getSecret(acct.id)).toBeNull()
    const secretsRaw = await fsp.readFile(path.join(dir, 'mail-secrets.json'), 'utf-8')
    expect(JSON.parse(secretsRaw)[acct.id]).toBeUndefined()
  })

  it('update can re-encrypt a new secret and leaves plaintext out of JSON', async () => {
    const acct = await store.add(INPUT, PASSWORD)
    await store.update(acct.id, { displayName: 'Renamed' }, 'new-password-xyz')
    const updated = await store.get(acct.id)
    expect(updated?.displayName).toBe('Renamed')
    expect(await store.getSecret(acct.id)).toBe('new-password-xyz')
    const accountsRaw = await fsp.readFile(path.join(dir, 'mail-accounts.json'), 'utf-8')
    expect(accountsRaw).not.toContain('new-password-xyz')
  })

  it('refuses to add when secure storage is unavailable', async () => {
    const store2 = new MailAccountStore(dir, makeMockSecrets(false))
    await expect(store2.add(INPUT, PASSWORD)).rejects.toThrow(/unavailable/i)
  })

  it('get returns null for an unknown id, and list is newest-first', async () => {
    expect(await store.get('does-not-exist')).toBeNull()
    const a = await store.add(INPUT, PASSWORD)
    await new Promise((r) => setTimeout(r, 2)) // ensure a later createdAt
    const b = await store.add({ ...INPUT, user: 'bob@example.com' }, 'pw2')
    const list = await store.list()
    expect(list[0].id).toBe(b.id) // most recent first
    expect(list[1].id).toBe(a.id)
  })

  it('getSecret returns null when no secret is stored for the id', async () => {
    expect(await store.getSecret('missing-id')).toBeNull()
  })

  it('update without a secret leaves the stored secret unchanged', async () => {
    const acct = await store.add(INPUT, PASSWORD)
    await store.update(acct.id, { displayName: 'Renamed only' })
    expect(await store.getSecret(acct.id)).toBe(PASSWORD) // unchanged
    expect((await store.get(acct.id))?.displayName).toBe('Renamed only')
  })

  it('update can null-out SMTP and patch imap independently', async () => {
    const acct = await store.add(INPUT, PASSWORD)
    const patched = await store.update(acct.id, { smtp: null, imap: { host: 'imap2.example.com', port: 143, tls: false } })
    expect(patched.smtp).toBeNull()
    expect(patched.imap).toEqual({ host: 'imap2.example.com', port: 143, tls: false })
  })

  it('update throws for an unknown account id', async () => {
    await expect(store.update('nope', { displayName: 'x' })).rejects.toThrow(/not found/i)
  })

  it('update with a secret throws when secure storage is unavailable', async () => {
    const acct = await store.add(INPUT, PASSWORD)
    const store2 = new MailAccountStore(dir, makeMockSecrets(false))
    await expect(store2.update(acct.id, {}, 'new-pw')).rejects.toThrow(/unavailable/i)
  })

  it('getSecret throws when secure storage becomes unavailable', async () => {
    const acct = await store.add(INPUT, PASSWORD)
    const store2 = new MailAccountStore(dir, makeMockSecrets(false))
    await expect(store2.getSecret(acct.id)).rejects.toThrow(/unavailable/i)
  })

  it('remove of an unknown id is a no-op (does not throw)', async () => {
    await expect(store.remove('never-existed')).resolves.toBeUndefined()
  })

  // ── xoauth2: the stored secret is a REFRESH TOKEN, same invariants as basic ──
  it('creates an xoauth2 account storing the refresh token encrypted, never in JSON', async () => {
    const REFRESH = 'gmail-refresh-token-abc123'
    const acct = await store.add(
      { ...INPUT, authKind: 'xoauth2', user: 'oauth@gmail.com' },
      REFRESH,
    )
    expect(acct.authKind).toBe('xoauth2')
    // The refresh token must not appear on the record nor in the accounts JSON.
    expect(JSON.stringify(acct)).not.toContain(REFRESH)
    const accountsRaw = await fsp.readFile(path.join(dir, 'mail-accounts.json'), 'utf-8')
    expect(accountsRaw).not.toContain(REFRESH)
    // The secrets file holds only ciphertext base64 — no plaintext token.
    const secretsRaw = await fsp.readFile(path.join(dir, 'mail-secrets.json'), 'utf-8')
    expect(secretsRaw).not.toContain(REFRESH)
    // getSecret round-trips the refresh token back out.
    expect(await store.getSecret(acct.id)).toBe(REFRESH)
  })

  it('defaults an xoauth2 account authProvider to google when unspecified', async () => {
    const acct = await store.add({ ...INPUT, authKind: 'xoauth2', user: 'g@gmail.com' }, 'g-refresh')
    expect(acct.authProvider).toBe('google')
  })

  it('tags a microsoft xoauth2 account and keeps the refresh token out of JSON', async () => {
    const MS_REFRESH = 'ms-refresh-token-xyz'
    const acct = await store.add(
      { ...INPUT, authKind: 'xoauth2', authProvider: 'microsoft', user: 'a@outlook.com' },
      MS_REFRESH,
    )
    expect(acct.authKind).toBe('xoauth2')
    expect(acct.authProvider).toBe('microsoft')
    // The refresh token must not appear on the record nor in the accounts JSON.
    expect(JSON.stringify(acct)).not.toContain(MS_REFRESH)
    const accountsRaw = await fsp.readFile(path.join(dir, 'mail-accounts.json'), 'utf-8')
    expect(accountsRaw).not.toContain(MS_REFRESH)
    // The provider tag IS persisted (it drives which endpoint the token manager uses).
    expect(accountsRaw).toContain('"authProvider": "microsoft"')
    // The secrets file holds only ciphertext base64 — no plaintext token.
    const secretsRaw = await fsp.readFile(path.join(dir, 'mail-secrets.json'), 'utf-8')
    expect(secretsRaw).not.toContain(MS_REFRESH)
    expect(await store.getSecret(acct.id)).toBe(MS_REFRESH)
  })

  it('does NOT tag a basic account with an authProvider', async () => {
    const acct = await store.add(INPUT, PASSWORD)
    expect(acct.authProvider).toBeUndefined()
    const accountsRaw = await fsp.readFile(path.join(dir, 'mail-accounts.json'), 'utf-8')
    expect(accountsRaw).not.toContain('authProvider')
  })
})
