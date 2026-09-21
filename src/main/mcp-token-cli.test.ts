import { describe, it, expect, vi } from 'vitest'
import { resolveAuthHeaders } from './mcp-token-cli'
import type { OAuthFetch } from './mcp/oauth/remote-oauth'
import { NEAR_EXPIRY_MS, type RemoteOAuthRecord } from './mcp/oauth/remote-vault'

const REFRESH = 'rt_SUPER_SECRET_REFRESH_TOKEN'
const ACCESS = 'at_FRESH_ACCESS_TOKEN'

function baseRecord(over: Partial<RemoteOAuthRecord> = {}): RemoteOAuthRecord {
  return {
    refreshToken: REFRESH,
    tokenEndpoint: 'https://auth.example.com/token',
    clientId: 'workspace-os',
    resource: 'https://mcp.example.com/mcp',
    ...over,
  }
}

/** A fake token endpoint that returns a fresh access token. */
function okFetch(body: Record<string, unknown> = {}): OAuthFetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ access_token: ACCESS, expires_in: 3600, ...body }),
  }))
}

describe('resolveAuthHeaders (wos-mcp-token core)', () => {
  it('emits EXACTLY {"Authorization":"Bearer X"} on a successful refresh', async () => {
    const fetchFn = okFetch()
    const res = await resolveAuthHeaders(baseRecord(), fetchFn)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.headers).toEqual({ Authorization: `Bearer ${ACCESS}` })
    // The serialized headers are the exact contract the CLI prints — no extra keys.
    expect(JSON.stringify(res.headers)).toBe(`{"Authorization":"Bearer ${ACCESS}"}`)
  })

  it('NEVER leaks the refresh token in the emitted headers', async () => {
    const res = await resolveAuthHeaders(baseRecord(), okFetch())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const serialized = JSON.stringify(res.headers)
    expect(serialized).not.toContain(REFRESH)
    // Only the access token is present, as a Bearer.
    expect(serialized).toContain(ACCESS)
  })

  it('refreshes (hits the token endpoint) when the cached token is near-expiry', async () => {
    const fetchFn = okFetch()
    // Cached token expires in 1 minute — inside the 5-minute window → refresh.
    const rec = baseRecord({ accessToken: 'at_STALE', accessTokenExpiresAt: Date.now() + 60_000 })
    const res = await resolveAuthHeaders(rec, fetchFn)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.headers.Authorization).toBe(`Bearer ${ACCESS}`)
    // A newly-minted token → an updated record to persist (fresh access token).
    expect(res.updated?.accessToken).toBe(ACCESS)
  })

  it('reuses a still-fresh cached token WITHOUT hitting the token endpoint', async () => {
    const fetchFn = okFetch()
    const rec = baseRecord({
      accessToken: 'at_CACHED_STILL_GOOD',
      accessTokenExpiresAt: Date.now() + NEAR_EXPIRY_MS + 60_000, // well outside window
    })
    const res = await resolveAuthHeaders(rec, fetchFn)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.headers).toEqual({ Authorization: 'Bearer at_CACHED_STILL_GOOD' })
    expect(res.updated).toBeUndefined()
  })

  it('persists a ROTATED refresh token when the server returns a new one', async () => {
    const rotated = 'rt_ROTATED_NEW'
    const res = await resolveAuthHeaders(baseRecord(), okFetch({ refresh_token: rotated }))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.updated?.refreshToken).toBe(rotated)
    // Still no refresh token in the headers.
    expect(JSON.stringify(res.headers)).not.toContain(rotated)
  })

  it('returns a failure (→ CLI prints {}) when the token endpoint rejects', async () => {
    const badFetch: OAuthFetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant' }),
    }))
    const res = await resolveAuthHeaders(baseRecord(), badFetch)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('invalid_grant')
  })

  it('returns a failure when the network throws (never crashes)', async () => {
    const throwFetch: OAuthFetch = vi.fn(async () => { throw new Error('ECONNREFUSED') })
    const res = await resolveAuthHeaders(baseRecord(), throwFetch)
    expect(res.ok).toBe(false)
  })
})
