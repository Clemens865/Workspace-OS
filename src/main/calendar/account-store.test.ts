import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { CalendarSourceStore } from './account-store'
import type { SecretStore } from '../mail/account-store'

/** A reversible stand-in for safeStorage — lets us assert the ciphertext that
 *  actually lands on disk is not the plaintext. */
const fakeSecrets = (available = true): SecretStore => ({
  isAvailable: () => available,
  encrypt: (s: string) => Buffer.from(`enc:${s}`),
  decrypt: (b: Buffer) => {
    const s = b.toString()
    if (!s.startsWith('enc:')) throw new Error('bad ciphertext')
    return s.slice(4)
  },
})

let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-cal-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

const caldav = { kind: 'caldav' as const, displayName: 'Work', url: 'https://dav.x/', username: 'u', password: 'app-pw' }

describe('CalendarSourceStore', () => {
  it('adds and lists a source', async () => {
    const store = new CalendarSourceStore(dir, fakeSecrets())
    const s = await store.add(caldav)
    expect(s.id).toBeTruthy()
    expect(await store.list()).toHaveLength(1)
    expect((await store.get(s.id))?.displayName).toBe('Work')
  })

  it('NEVER writes the password into the source record', async () => {
    // The invariant this whole design exists to protect.
    const store = new CalendarSourceStore(dir, fakeSecrets())
    await store.add(caldav)
    const raw = await fs.readFile(path.join(dir, 'calendar-sources.json'), 'utf-8')
    expect(raw).not.toContain('app-pw')
    expect(JSON.parse(raw)[0]).not.toHaveProperty('password')
  })

  it('stores the secret separately, as ciphertext', async () => {
    const store = new CalendarSourceStore(dir, fakeSecrets())
    const s = await store.add(caldav)
    const raw = await fs.readFile(path.join(dir, 'calendar-secrets.json'), 'utf-8')
    expect(raw).not.toContain('app-pw')          // not in plaintext…
    expect(await store.getSecret(s.id)).toBe('app-pw') // …but recoverable
  })

  it('rejects a CalDAV source with no password instead of storing a broken account', async () => {
    const store = new CalendarSourceStore(dir, fakeSecrets())
    await expect(store.add({ ...caldav, password: undefined })).rejects.toThrow(/app password/i)
    expect(await store.list()).toHaveLength(0)
  })

  it('accepts an ics feed with no password and keeps the secret file untouched', async () => {
    const store = new CalendarSourceStore(dir, fakeSecrets())
    await store.add({ kind: 'ics', displayName: 'Holidays', url: 'https://x/h.ics' })
    await expect(fs.readFile(path.join(dir, 'calendar-secrets.json'), 'utf-8')).rejects.toThrow()
  })

  it('requires a url', async () => {
    const store = new CalendarSourceStore(dir, fakeSecrets())
    await expect(store.add({ ...caldav, url: '   ' })).rejects.toThrow(/address/i)
  })

  it('refuses to store a secret when the keychain is unavailable', async () => {
    const store = new CalendarSourceStore(dir, fakeSecrets(false))
    await expect(store.add(caldav)).rejects.toThrow(/keychain/i)
  })

  it('updates non-secret fields without disturbing the secret', async () => {
    const store = new CalendarSourceStore(dir, fakeSecrets())
    const s = await store.add(caldav)
    await store.update(s.id, { displayName: 'Renamed', enabledCalendars: ['https://dav.x/a/'] })
    const after = await store.get(s.id)
    expect(after?.displayName).toBe('Renamed')
    expect(after?.enabledCalendars).toEqual(['https://dav.x/a/'])
    expect(await store.getSecret(s.id)).toBe('app-pw')
  })

  it('returns null updating an unknown id', async () => {
    const store = new CalendarSourceStore(dir, fakeSecrets())
    expect(await store.update('nope', { displayName: 'x' })).toBeNull()
  })

  it('removing a source also removes its secret — nothing left behind', async () => {
    const store = new CalendarSourceStore(dir, fakeSecrets())
    const s = await store.add(caldav)
    await store.remove(s.id)
    expect(await store.list()).toHaveLength(0)
    expect(await store.getSecret(s.id)).toBeNull()
    const raw = await fs.readFile(path.join(dir, 'calendar-secrets.json'), 'utf-8')
    expect(raw).not.toContain('app-pw')
  })

  it('treats an undecryptable secret as absent so the caller re-prompts', async () => {
    // Simulates a copied profile / rotated keychain key.
    const store = new CalendarSourceStore(dir, fakeSecrets())
    const s = await store.add(caldav)
    await fs.writeFile(path.join(dir, 'calendar-secrets.json'), JSON.stringify({ [s.id]: Buffer.from('garbage').toString('base64') }))
    expect(await store.getSecret(s.id)).toBeNull()
  })

  it('starts clean on a corrupt sources file rather than blocking the surface', async () => {
    await fs.writeFile(path.join(dir, 'calendar-sources.json'), '{not json')
    const store = new CalendarSourceStore(dir, fakeSecrets())
    expect(await store.list()).toEqual([])
  })

  it('falls back to a sensible name when none is given', async () => {
    const store = new CalendarSourceStore(dir, fakeSecrets())
    const a = await store.add({ kind: 'ics', displayName: '  ', url: 'https://x/a.ics' })
    expect(a.displayName).toBe('Subscribed calendar')
  })
})
