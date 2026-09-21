import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { DriveAccountStore, canWrite, type SecretStore } from './drive-account'

/**
 * The record on disk must never contain the token, and a connection must never
 * exist without one. Everything here is one of those two.
 */

let dir: string
let secrets: SecretStore

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-drive-'))
  // A stand-in for safeStorage: reversible, and clearly not plaintext on disk.
  secrets = {
    isAvailable: () => true,
    encrypt: (p) => Buffer.from(`enc:${p}`, 'utf-8'),
    decrypt: (c) => c.toString('utf-8').replace(/^enc:/, ''),
  }
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const CONNECTION = { email: 'alex@example.com', access: 'readOnly' as const, connectedAt: '2026-08-18T12:00:00Z' }

describe('DriveAccountStore', () => {
  it('has no connection before one is made', async () => {
    expect(await new DriveAccountStore(dir, secrets).get()).toBeNull()
  })

  it('stores the connection and hands the token back', async () => {
    const s = new DriveAccountStore(dir, secrets)
    await s.save(CONNECTION, 'refresh-abc')
    expect(await s.get()).toEqual(CONNECTION)
    expect(await s.refreshToken()).toBe('refresh-abc')
  })

  /** The bug this file is shaped to prevent. */
  it('never writes the token to disk', async () => {
    const s = new DriveAccountStore(dir, secrets)
    await s.save(CONNECTION, 'refresh-abc')
    expect(fs.readFileSync(path.join(dir, 'drive-account.json'), 'utf-8')).not.toContain('refresh-abc')
  })

  /**
   * A card with no token behind it looks connected and fails on every use, with
   * an error about a token nobody knew was missing.
   */
  it('records nothing when the keychain is unavailable', async () => {
    const s = new DriveAccountStore(dir, { ...secrets, isAvailable: () => false })
    await expect(s.save(CONNECTION, 'refresh-abc')).rejects.toThrow(/keychain/)
    expect(await s.get()).toBeNull()
  })

  it('forgets both halves on disconnect', async () => {
    const s = new DriveAccountStore(dir, secrets)
    await s.save(CONNECTION, 'refresh-abc')
    await s.disconnect()
    expect(await s.get()).toBeNull()
    expect(await s.refreshToken()).toBeNull()
  })

  it('reads a corrupt file as no connection rather than throwing', async () => {
    fs.writeFileSync(path.join(dir, 'drive-account.json'), '{ not json')
    expect(await new DriveAccountStore(dir, secrets).get()).toBeNull()
  })

  /** An unknown access level must not silently become the most powerful one. */
  it('falls back to read-only for an access level it does not recognise', async () => {
    fs.writeFileSync(path.join(dir, 'drive-account.json'), JSON.stringify({ email: 'a@b.c', access: 'everything' }))
    expect((await new DriveAccountStore(dir, secrets).get())?.access).toBe('readOnly')
  })
})

describe('canWrite', () => {
  it('is true only for a full-access connection', () => {
    expect(canWrite({ ...CONNECTION, access: 'full' })).toBe(true)
    expect(canWrite({ ...CONNECTION, access: 'readOnly' })).toBe(false)
    expect(canWrite({ ...CONNECTION, access: 'appFiles' })).toBe(false)
    expect(canWrite(null)).toBe(false)
  })
})
