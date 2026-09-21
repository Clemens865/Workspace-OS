import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Vault, isValidSecretName } from './vault'
import type { SecretStore } from './secret-store'

/**
 * A reversible mock SecretStore. `encrypt` prefixes a marker so a test can prove
 * the on-disk blob is NOT the plaintext (it's "ciphertext"), and `decrypt`
 * strips it back. `available` is togglable to exercise the refuse-path.
 */
function mockStore(available = true, backend = 'mock'): SecretStore & { available: boolean } {
  const MARK = 'ENC::'
  const store = {
    available,
    isAvailable() { return this.available },
    encrypt(plaintext: string): Buffer { return Buffer.from(MARK + plaintext, 'utf-8') },
    decrypt(buf: Buffer): string {
      const s = buf.toString('utf-8')
      if (!s.startsWith(MARK)) throw new Error('not ciphertext from this store')
      return s.slice(MARK.length)
    },
    backend() { return backend },
  }
  return store
}

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-vault-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('Vault encrypt/decrypt round-trip', () => {
  it('stores then returns the same plaintext', () => {
    const v = new Vault(dir, mockStore())
    v.set('GITHUB_PERSONAL_ACCESS_TOKEN', 'ghp_supersecret123')
    expect(v.get('GITHUB_PERSONAL_ACCESS_TOKEN')).toBe('ghp_supersecret123')
  })

  it('list() returns names only, never values', () => {
    const v = new Vault(dir, mockStore())
    v.set('DATABASE_URL', 'postgresql://u:p@h/db')
    v.set('GITHUB_PERSONAL_ACCESS_TOKEN', 'ghp_x')
    const list = v.list()
    expect(list.map((m) => m.name).sort()).toEqual(['DATABASE_URL', 'GITHUB_PERSONAL_ACCESS_TOKEN'])
    // No value field exists on the metadata at all.
    for (const m of list) expect(Object.keys(m)).toEqual(['name'])
  })

  it('remove() deletes the stored secret', () => {
    const v = new Vault(dir, mockStore())
    v.set('DATABASE_URL', 'postgresql://x')
    v.remove('DATABASE_URL')
    expect(v.get('DATABASE_URL')).toBeNull()
    expect(v.has('DATABASE_URL')).toBe(false)
  })
})

describe('secrets.json never contains plaintext', () => {
  it('the on-disk file holds only base64 ciphertext, not the secret', () => {
    const v = new Vault(dir, mockStore())
    const secret = 'ghp_PLAINTEXT_MUST_NOT_APPEAR'
    v.set('GITHUB_PERSONAL_ACCESS_TOKEN', secret)
    const raw = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf-8')
    expect(raw).not.toContain(secret)
    // What IS there is the base64 of the mock ciphertext ("ENC::<secret>").
    const parsed = JSON.parse(raw) as Record<string, string>
    const b64 = parsed['GITHUB_PERSONAL_ACCESS_TOKEN']
    expect(typeof b64).toBe('string')
    expect(Buffer.from(b64, 'base64').toString('utf-8')).toBe('ENC::' + secret)
  })

  it('writes the file mode 0o600 (owner-only)', () => {
    const v = new Vault(dir, mockStore())
    v.set('DATABASE_URL', 'x')
    const mode = fs.statSync(path.join(dir, 'secrets.json')).mode & 0o777
    expect(mode).toBe(0o600)
  })
})

describe('refusal when secure storage is unavailable (Linux basic_text)', () => {
  it('set() throws and writes nothing', () => {
    const store = mockStore(false, 'basic_text')
    const v = new Vault(dir, store)
    expect(() => v.set('GITHUB_PERSONAL_ACCESS_TOKEN', 'ghp_x')).toThrow(/unavailable|plaintext/i)
    // No file should have been created — nothing persisted.
    expect(fs.existsSync(path.join(dir, 'secrets.json'))).toBe(false)
  })

  it('status() surfaces availability + backend', () => {
    const v = new Vault(dir, mockStore(false, 'basic_text'))
    expect(v.status()).toEqual({ available: false, backend: 'basic_text' })
  })
})

describe('secret name validation', () => {
  it('accepts env-var-shaped names, rejects junk', () => {
    expect(isValidSecretName('GITHUB_PERSONAL_ACCESS_TOKEN')).toBe(true)
    expect(isValidSecretName('DATABASE_URL')).toBe(true)
    expect(isValidSecretName('has space')).toBe(false)
    expect(isValidSecretName('../etc')).toBe(false)
    expect(isValidSecretName('1LEADING_DIGIT')).toBe(false)
    expect(isValidSecretName('')).toBe(false)
    expect(isValidSecretName(42)).toBe(false)
  })

  it('set() rejects an invalid name before touching the store', () => {
    const v = new Vault(dir, mockStore())
    expect(() => v.set('bad name', 'x')).toThrow(/invalid secret name/i)
  })
})
