import { describe, it, expect, vi } from 'vitest'
import {
  createVerifier,
  challengeFromVerifier,
  createState,
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  buildXoauth2Token,
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_AUTH_ENDPOINT,
  DEFAULT_MAIL_SCOPES,
  type FetchFn,
} from './google-oauth'

/**
 * PURE token logic — exercised with an INJECTED fake fetch, so nothing here ever
 * reaches Google. Covers PKCE (against the RFC 7636 known vector), the auth-URL
 * params, code exchange + refresh (success + error), and the exact XOAUTH2 bytes.
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

describe('PKCE', () => {
  it('produces the RFC 7636 Appendix-B S256 challenge for the known verifier', () => {
    // The canonical RFC 7636 test vector.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(challengeFromVerifier(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('createVerifier is base64url, 43 chars, and round-trips through the challenge', () => {
    const v = createVerifier()
    expect(v).toMatch(/^[A-Za-z0-9\-_]+$/) // base64url, no padding
    expect(v.length).toBe(43) // 32 bytes → 43 base64url chars
    const c = challengeFromVerifier(v)
    expect(c).toMatch(/^[A-Za-z0-9\-_]+$/)
    expect(c).not.toContain('=')
  })

  it('createState is opaque base64url', () => {
    const s = createState()
    expect(s).toMatch(/^[A-Za-z0-9\-_]+$/)
    expect(s.length).toBeGreaterThan(10)
  })
})

describe('buildAuthUrl', () => {
  it('emits the installed-app consent URL with all required params', () => {
    const url = buildAuthUrl('CID.apps.googleusercontent.com', 'http://127.0.0.1:1234', DEFAULT_MAIL_SCOPES, 'CHAL', 'STATE')
    expect(url.startsWith(GOOGLE_AUTH_ENDPOINT)).toBe(true)
    const q = new URL(url).searchParams
    expect(q.get('client_id')).toBe('CID.apps.googleusercontent.com')
    expect(q.get('redirect_uri')).toBe('http://127.0.0.1:1234')
    expect(q.get('response_type')).toBe('code')
    expect(q.get('code_challenge')).toBe('CHAL')
    expect(q.get('code_challenge_method')).toBe('S256')
    expect(q.get('state')).toBe('STATE')
    expect(q.get('access_type')).toBe('offline')
    expect(q.get('prompt')).toBe('consent')
    expect(q.get('scope')).toContain('https://mail.google.com/')
  })
})

describe('exchangeCode', () => {
  it('exchanges a code for a token set (success)', async () => {
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
    // The request went to the token endpoint with the PKCE verifier + code.
    expect(fetchFn.calls[0].url).toBe(GOOGLE_TOKEN_ENDPOINT)
    expect(fetchFn.calls[0].init.body).toContain('code_verifier=the-verifier')
    expect(fetchFn.calls[0].init.body).toContain('grant_type=authorization_code')
    expect(fetchFn.calls[0].init.body).not.toContain('client_secret')
  })

  it('maps an OAuth error body to a typed, sanitized error (never throws)', async () => {
    const fetchFn = fakeFetch({ ok: false, status: 400, body: { error: 'invalid_grant', error_description: 'Bad Request' } })
    const res = await exchangeCode({ code: 'x', verifier: 'y', clientId: 'C', redirectUri: 'r' }, fetchFn)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe('auth')
    // The verbatim Google description must not ride out in the message.
    expect(res.error.message).not.toContain('Bad Request')
  })

  it('treats a network throw as a typed host error', async () => {
    const fetchFn = (async () => { throw new Error('ECONNREFUSED') }) as FetchFn
    const res = await exchangeCode({ code: 'x', verifier: 'y', clientId: 'C', redirectUri: 'r' }, fetchFn)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe('host')
    expect(res.error.message).not.toContain('ECONNREFUSED')
  })
})

describe('refreshAccessToken', () => {
  it('refreshes and returns a new access token (no new refresh token expected)', async () => {
    const fetchFn = fakeFetch({ ok: true, status: 200, body: { access_token: 'AT2', expires_in: 1800 } })
    const res = await refreshAccessToken({ refreshToken: 'RT', clientId: 'CID' }, fetchFn)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.accessToken).toBe('AT2')
    expect(res.value.refreshToken).toBeUndefined()
    expect(fetchFn.calls[0].init.body).toContain('grant_type=refresh_token')
    expect(fetchFn.calls[0].init.body).toContain('refresh_token=RT')
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

describe('buildXoauth2Token', () => {
  it('produces the exact SASL XOAUTH2 base64 string', () => {
    const token = buildXoauth2Token('alice@gmail.com', 'ya29.TOKEN')
    // Reconstruct the exact expected bytes: user=...^Aauth=Bearer <tok>^A^A
    const expectedRaw = 'user=alice@gmail.com\x01auth=Bearer ya29.TOKEN\x01\x01'
    expect(token).toBe(Buffer.from(expectedRaw, 'utf-8').toString('base64'))
    // And decoding it back yields those exact control-char-delimited bytes.
    const decoded = Buffer.from(token, 'base64').toString('utf-8')
    expect(decoded).toBe(expectedRaw)
    expect(decoded.split('\x01')).toEqual(['user=alice@gmail.com', 'auth=Bearer ya29.TOKEN', '', ''])
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
