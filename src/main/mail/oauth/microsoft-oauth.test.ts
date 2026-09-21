import { describe, it, expect, vi } from 'vitest'
import {
  createVerifier,
  challengeFromVerifier,
  createState,
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  buildXoauth2Token,
  MS_TOKEN_ENDPOINT,
  MS_AUTH_ENDPOINT,
  DEFAULT_MS_MAIL_SCOPES,
  OUTLOOK_IMAP_SCOPE,
  OUTLOOK_SMTP_SCOPE,
  OFFLINE_ACCESS_SCOPE,
  type FetchFn,
} from './microsoft-oauth'

/**
 * PURE Microsoft (Entra v2.0) token logic — exercised with an INJECTED fake fetch,
 * so nothing here reaches Microsoft. Covers the auth-URL params (endpoints, scopes,
 * PKCE challenge, loopback redirect), code exchange + refresh (success + the
 * Microsoft error-body shape → typed error, never throws), refresh-token rotation,
 * and the shared XOAUTH2 bytes.
 */

/** A fake fetch that records the call and returns a scripted JSON response. */
function fakeFetch(
  response: { ok: boolean; status: number; body: unknown },
): FetchFn & { calls: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] } {
  const calls: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = []
  const fn = (async (url, init) => {
    calls.push({ url, init })
    return { ok: response.ok, status: response.status, json: async () => response.body }
  }) as FetchFn & { calls: typeof calls }
  fn.calls = calls
  return fn
}

describe('PKCE (shared)', () => {
  it('produces the RFC 7636 S256 challenge for the known verifier', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(challengeFromVerifier(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('createVerifier is base64url, 43 chars; createState is opaque base64url', () => {
    const v = createVerifier()
    expect(v).toMatch(/^[A-Za-z0-9\-_]+$/)
    expect(v.length).toBe(43)
    expect(createState()).toMatch(/^[A-Za-z0-9\-_]+$/)
  })
})

describe('buildAuthUrl', () => {
  it('emits the v2.0 common-tenant consent URL with all required params + loopback redirect', () => {
    const url = buildAuthUrl('APP-CLIENT-ID', 'http://127.0.0.1:1234', DEFAULT_MS_MAIL_SCOPES, 'CHAL', 'STATE')
    expect(url.startsWith(MS_AUTH_ENDPOINT)).toBe(true)
    expect(MS_AUTH_ENDPOINT).toContain('/common/oauth2/v2.0/authorize')
    const q = new URL(url).searchParams
    expect(q.get('client_id')).toBe('APP-CLIENT-ID')
    expect(q.get('redirect_uri')).toBe('http://127.0.0.1:1234')
    expect(q.get('response_type')).toBe('code')
    expect(q.get('code_challenge')).toBe('CHAL')
    expect(q.get('code_challenge_method')).toBe('S256')
    expect(q.get('state')).toBe('STATE')
    expect(q.get('response_mode')).toBe('query')
    // The Outlook-specific IMAP/SMTP scopes + offline_access (refresh token) are present.
    const scope = q.get('scope') ?? ''
    expect(scope).toContain(OUTLOOK_IMAP_SCOPE)
    expect(scope).toContain(OUTLOOK_SMTP_SCOPE)
    expect(scope).toContain(OFFLINE_ACCESS_SCOPE)
  })

  it('never carries a client secret in the URL', () => {
    const url = buildAuthUrl('CID', 'http://127.0.0.1:9', DEFAULT_MS_MAIL_SCOPES, 'C', 'S')
    expect(url).not.toContain('client_secret')
  })
})

describe('exchangeCode', () => {
  it('exchanges a code for a token set (success), no client secret, with PKCE verifier', async () => {
    const fetchFn = fakeFetch({
      ok: true,
      status: 200,
      body: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 },
    })
    const before = Date.now()
    const res = await exchangeCode(
      { code: 'the-code', verifier: 'the-verifier', clientId: 'CID', redirectUri: 'http://127.0.0.1:9' },
      fetchFn,
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.accessToken).toBe('AT')
    expect(res.value.refreshToken).toBe('RT')
    expect(res.value.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000)
    expect(fetchFn.calls[0].url).toBe(MS_TOKEN_ENDPOINT)
    expect(fetchFn.calls[0].init.body).toContain('code_verifier=the-verifier')
    expect(fetchFn.calls[0].init.body).toContain('grant_type=authorization_code')
    expect(fetchFn.calls[0].init.body).not.toContain('client_secret')
  })

  it('maps a Microsoft error body to a typed, sanitized error (never throws)', async () => {
    // Microsoft returns { error, error_description } — the description must not leak.
    const fetchFn = fakeFetch({
      ok: false,
      status: 400,
      body: { error: 'invalid_grant', error_description: 'AADSTS70008: expired' },
    })
    const res = await exchangeCode({ code: 'x', verifier: 'y', clientId: 'C', redirectUri: 'r' }, fetchFn)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe('auth')
    expect(res.error.message).not.toContain('AADSTS70008')
  })

  it('treats a network throw as a typed host error (no raw error leaked)', async () => {
    const fetchFn = (async () => { throw new Error('ECONNREFUSED') }) as FetchFn
    const res = await exchangeCode({ code: 'x', verifier: 'y', clientId: 'C', redirectUri: 'r' }, fetchFn)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe('host')
    expect(res.error.message).not.toContain('ECONNREFUSED')
  })
})

describe('refreshAccessToken', () => {
  it('refreshes and returns a new access token AND a rotated refresh token', async () => {
    // Microsoft rotates the refresh token — the caller must persist the new one.
    const fetchFn = fakeFetch({ ok: true, status: 200, body: { access_token: 'AT2', refresh_token: 'RT2', expires_in: 1800 } })
    const res = await refreshAccessToken({ refreshToken: 'RT', clientId: 'CID' }, fetchFn)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.accessToken).toBe('AT2')
    expect(res.value.refreshToken).toBe('RT2')
    expect(fetchFn.calls[0].init.body).toContain('grant_type=refresh_token')
    expect(fetchFn.calls[0].init.body).toContain('refresh_token=RT')
  })

  it('forwards the scope when provided', async () => {
    const fetchFn = fakeFetch({ ok: true, status: 200, body: { access_token: 'AT', expires_in: 3600 } })
    await refreshAccessToken({ refreshToken: 'RT', clientId: 'CID', scopes: [OUTLOOK_IMAP_SCOPE, OFFLINE_ACCESS_SCOPE] }, fetchFn)
    expect(decodeURIComponent(fetchFn.calls[0].init.body)).toContain(OUTLOOK_IMAP_SCOPE)
  })

  it('propagates a refresh failure as a typed auth error', async () => {
    const fetchFn = fakeFetch({ ok: false, status: 400, body: { error: 'invalid_grant' } })
    const res = await refreshAccessToken({ refreshToken: 'RT', clientId: 'CID' }, fetchFn)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe('auth')
  })

  it('defaults expiry to ~1h when expires_in is missing', async () => {
    const fetchFn = fakeFetch({ ok: true, status: 200, body: { access_token: 'AT' } })
    const before = Date.now()
    const res = await refreshAccessToken({ refreshToken: 'RT', clientId: 'CID' }, fetchFn)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000)
  })
})

describe('buildXoauth2Token (shared with Google)', () => {
  it('produces the exact SASL XOAUTH2 base64 string for an Outlook address', () => {
    const token = buildXoauth2Token('alice@outlook.com', 'MS.TOKEN')
    const expectedRaw = 'user=alice@outlook.com\x01auth=Bearer MS.TOKEN\x01\x01'
    expect(token).toBe(Buffer.from(expectedRaw, 'utf-8').toString('base64'))
  })
})

describe('no logging', () => {
  it('exchangeCode never writes to console (no token leakage)', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchFn = fakeFetch({ ok: true, status: 200, body: { access_token: 'SECRET', refresh_token: 'SECRET_RT', expires_in: 60 } })
    await exchangeCode({ code: 'c', verifier: 'v', clientId: 'C', redirectUri: 'r' }, fetchFn)
    expect(spy).not.toHaveBeenCalled()
    expect(errSpy).not.toHaveBeenCalled()
    spy.mockRestore()
    errSpy.mockRestore()
  })
})
