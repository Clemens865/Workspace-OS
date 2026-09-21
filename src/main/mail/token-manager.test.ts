import { describe, it, expect, vi } from 'vitest'
import { TokenManager } from './token-manager'
import type { MailAccountStore } from './account-store'
import type { FetchFn } from './oauth/google-oauth'

/**
 * The TokenManager is exercised with an INJECTED fake fetch + clock + account
 * store — no Electron, no Google socket. We assert it caches within the skew
 * window, refreshes when close to expiry, propagates failures as typed errors,
 * and never logs the token.
 */

/** A minimal account store exposing only getSecret (the refresh token source). */
function fakeStore(refreshToken: string | null): MailAccountStore {
  return { getSecret: vi.fn(async () => refreshToken) } as unknown as MailAccountStore
}

/** A fake fetch returning a scripted token response and counting calls. */
function fakeFetch(body: unknown, ok = true): FetchFn & { count: () => number } {
  let n = 0
  const fn = (async () => {
    n++
    return { ok, status: ok ? 200 : 400, json: async () => body }
  }) as FetchFn & { count: () => number }
  fn.count = () => n
  return fn
}

const CLIENT = () => 'CID.apps.googleusercontent.com'

describe('TokenManager', () => {
  it('refreshes on first use and caches the access token', async () => {
    let now = 1_000_000
    const fetchFn = fakeFetch({ access_token: 'AT', expires_in: 3600 })
    const tm = new TokenManager(fakeStore('RT'), { fetchFn, getClientId: CLIENT, now: () => now })

    const a = await tm.getAccessToken('acct1')
    expect(a.ok).toBe(true)
    if (a.ok) expect(a.value).toBe('AT')
    expect(fetchFn.count()).toBe(1)

    // A second call well before expiry uses the cache — no new refresh.
    now += 60_000
    const b = await tm.getAccessToken('acct1')
    expect(b.ok).toBe(true)
    expect(fetchFn.count()).toBe(1)
  })

  it('refreshes again once inside the ~60s expiry skew window', async () => {
    let now = 0
    let issued = 0
    const fetchFn = (async () => {
      issued++
      return { ok: true, status: 200, json: async () => ({ access_token: `AT${issued}`, expires_in: 3600 }) }
    }) as FetchFn
    const tm = new TokenManager(fakeStore('RT'), { fetchFn, getClientId: CLIENT, now: () => now })

    const first = await tm.getAccessToken('a')
    expect(first.ok && first.value).toBe('AT1')

    // Jump to within the skew window (expiry at 3_600_000; skew 60_000).
    now = 3_600_000 - 30_000
    const second = await tm.getAccessToken('a')
    expect(second.ok && second.value).toBe('AT2') // refreshed
  })

  it('returns a typed error when the client id is not configured', async () => {
    const fetchFn = fakeFetch({ access_token: 'AT' })
    const tm = new TokenManager(fakeStore('RT'), { fetchFn, getClientId: () => null })
    const res = await tm.getAccessToken('a')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('unavailable')
    expect(fetchFn.count()).toBe(0) // never hit the network
  })

  it('returns unavailable when there is no stored refresh token', async () => {
    const fetchFn = fakeFetch({ access_token: 'AT' })
    const tm = new TokenManager(fakeStore(null), { fetchFn, getClientId: CLIENT })
    const res = await tm.getAccessToken('a')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('unavailable')
  })

  it('propagates a refresh failure (invalid_grant) as a typed auth error', async () => {
    const fetchFn = fakeFetch({ error: 'invalid_grant' }, false)
    const tm = new TokenManager(fakeStore('RT'), { fetchFn, getClientId: CLIENT })
    const res = await tm.getAccessToken('a')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('auth')
  })

  it('invalidate() forces the next call to refresh', async () => {
    const fetchFn = fakeFetch({ access_token: 'AT', expires_in: 3600 })
    const tm = new TokenManager(fakeStore('RT'), { fetchFn, getClientId: CLIENT })
    await tm.getAccessToken('a')
    expect(fetchFn.count()).toBe(1)
    tm.invalidate('a')
    await tm.getAccessToken('a')
    expect(fetchFn.count()).toBe(2)
  })

  it('NEVER logs the access or refresh token', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchFn = fakeFetch({ access_token: 'SECRET_AT', expires_in: 3600 })
    const tm = new TokenManager(fakeStore('SECRET_RT'), { fetchFn, getClientId: CLIENT })
    await tm.getAccessToken('a')
    const all = [...logSpy.mock.calls, ...errSpy.mock.calls].flat().join(' ')
    expect(all).not.toContain('SECRET_AT')
    expect(all).not.toContain('SECRET_RT')
    logSpy.mockRestore()
    errSpy.mockRestore()
  })
})

/**
 * A richer fake store for the Microsoft path: it exposes `get` (so the manager can
 * read authProvider), `getSecret` (the refresh token), and `update` (to persist a
 * rotated Microsoft refresh token). It records the last update secret so a test can
 * assert the rotation was written back.
 */
function fakeProviderStore(opts: { provider?: 'google' | 'microsoft'; refreshToken: string | null }) {
  let secret = opts.refreshToken
  const updates: { secret?: string }[] = []
  const store = {
    get: vi.fn(async (_id: string) => (opts.provider ? { id: _id, authProvider: opts.provider } : { id: _id })),
    getSecret: vi.fn(async () => secret),
    update: vi.fn(async (_id: string, _patch: unknown, newSecret?: string) => {
      if (newSecret !== undefined) { secret = newSecret; updates.push({ secret: newSecret }) }
      return { id: _id }
    }),
  } as unknown as MailAccountStore & { updates: typeof updates }
  ;(store as unknown as { updates: typeof updates }).updates = updates
  return store as MailAccountStore & { updates: typeof updates }
}

const MS_CLIENT = () => 'ms-app-client-id'

describe('TokenManager — Microsoft provider', () => {
  it('refreshes a microsoft account against the Microsoft endpoint via getMicrosoftClientId', async () => {
    const fetchFn = fakeFetch({ access_token: 'MS_AT', expires_in: 3600 })
    const store = fakeProviderStore({ provider: 'microsoft', refreshToken: 'MS_RT' })
    const tm = new TokenManager(store, {
      fetchFn,
      getClientId: () => 'google-only',
      getMicrosoftClientId: MS_CLIENT,
    })
    const res = await tm.getAccessToken('acct-ms')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value).toBe('MS_AT')
    expect(fetchFn.count()).toBe(1)
  })

  it('returns unavailable when the Microsoft client id is not configured', async () => {
    const fetchFn = fakeFetch({ access_token: 'AT' })
    const store = fakeProviderStore({ provider: 'microsoft', refreshToken: 'MS_RT' })
    const tm = new TokenManager(store, { fetchFn, getClientId: CLIENT, getMicrosoftClientId: () => null })
    const res = await tm.getAccessToken('a')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('unavailable')
    expect(fetchFn.count()).toBe(0)
  })

  it('persists a ROTATED microsoft refresh token via store.update', async () => {
    const fetchFn = fakeFetch({ access_token: 'MS_AT', refresh_token: 'MS_RT_NEW', expires_in: 3600 })
    const store = fakeProviderStore({ provider: 'microsoft', refreshToken: 'MS_RT_OLD' })
    const tm = new TokenManager(store, { fetchFn, getClientId: CLIENT, getMicrosoftClientId: MS_CLIENT })
    const res = await tm.getAccessToken('a')
    expect(res.ok).toBe(true)
    // The rotated refresh token was written back to the store.
    expect(store.updates.map((u) => u.secret)).toContain('MS_RT_NEW')
  })

  it('defaults a provider-less account to Google (no migration break)', async () => {
    const fetchFn = fakeFetch({ access_token: 'G_AT', expires_in: 3600 })
    // No provider tag on the record → treated as google; refreshed with the Google client id.
    const store = fakeProviderStore({ refreshToken: 'G_RT' })
    const tm = new TokenManager(store, { fetchFn, getClientId: CLIENT, getMicrosoftClientId: () => null })
    const res = await tm.getAccessToken('legacy')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value).toBe('G_AT')
  })
})
