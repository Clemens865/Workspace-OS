import type { MailResult } from '../types'
import { ok, err } from '../types'

// PKCE + XOAUTH2 helpers now live in shared modules (used by Microsoft too). They
// are re-exported here so existing importers (oauth-flow, tests) are unchanged.
export { createVerifier, challengeFromVerifier, createState } from './pkce'
export { buildXoauth2Token } from './xoauth2'

/**
 * PURE, Electron-free Google OAuth2 token logic for the installed-app / loopback
 * flow (RFC 8252 + PKCE, RFC 7636). This module contains NO I/O of its own —
 * network calls are performed through an INJECTED `fetchFn`, so every function
 * here is unit-testable without ever touching Google.
 *
 * SECURITY:
 *  - Installed apps have NO client secret. Authorization is proven with PKCE
 *    (S256 code-challenge) instead. The client id is public and is supplied by
 *    the caller (read from a setting/env upstream) — never hardcoded here.
 *  - This module never logs. Access/refresh tokens returned from it are handled
 *    as sensitive by callers (token-manager keeps them in memory; the refresh
 *    token is only ever safeStorage-encrypted on disk).
 */

/** Google's OAuth2 endpoints (installed-app flow). */
export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

/** Full-access Gmail scope — required for IMAP + SMTP via XOAUTH2. */
export const GMAIL_SCOPE = 'https://mail.google.com/'
/** Identity scope so we can read back the signed-in address (userinfo email). */
export const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email'

/** Default scopes for the mail flow. A future calendar scope slots in alongside. */
export const DEFAULT_MAIL_SCOPES = [GMAIL_SCOPE, EMAIL_SCOPE]

/** Minimal fetch surface we depend on — lets tests inject a fake. */
export type FetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

/** A resolved token set. `refreshToken` is only present on the initial exchange. */
export interface TokenSet {
  accessToken: string
  refreshToken?: string
  /** Absolute epoch-ms at which the access token expires. */
  expiresAt: number
}

// ── Authorization URL ────────────────────────────────────────────────────────

/**
 * Builds the Google consent URL for the installed-app flow. `access_type=offline`
 * + `prompt=consent` ensure a refresh token is returned on first authorization.
 */
export function buildAuthUrl(
  clientId: string,
  redirectUri: string,
  scopes: string[],
  codeChallenge: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent',
  })
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`
}

// ── Token exchange / refresh ─────────────────────────────────────────────────

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

/** Post form-encoded params to the token endpoint via the injected fetch. */
async function postToken(
  fetchFn: FetchFn,
  body: Record<string, string>,
): Promise<MailResult<TokenResponse>> {
  let res: { ok: boolean; status: number; json: () => Promise<unknown> }
  try {
    res = await fetchFn(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    })
  } catch {
    // Network-level failure — never surface the raw error (could echo params).
    return err('host', 'Could not reach Google to complete sign-in.')
  }
  let data: TokenResponse
  try {
    data = ((await res.json()) as TokenResponse) ?? {}
  } catch {
    return err('unknown', 'Google returned an unreadable response during sign-in.')
  }
  if (!res.ok || data.error || !data.access_token) {
    // Map Google's error to a typed, SANITIZED message. We surface the coarse
    // error code (e.g. invalid_grant) but never the full description verbatim.
    return err(classifyOAuthError(data.error), oauthMessage(data.error))
  }
  return ok(data)
}

/** Exchanges an authorization `code` (+ PKCE verifier) for a token set. */
export async function exchangeCode(
  params: { code: string; verifier: string; clientId: string; redirectUri: string },
  fetchFn: FetchFn,
): Promise<MailResult<TokenSet>> {
  const res = await postToken(fetchFn, {
    grant_type: 'authorization_code',
    code: params.code,
    code_verifier: params.verifier,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
  })
  if (!res.ok) return res
  return ok(toTokenSet(res.value))
}

/**
 * Refreshes an access token using a stored refresh token. Google typically does
 * NOT return a new refresh token here, so the caller keeps the existing one.
 */
export async function refreshAccessToken(
  params: { refreshToken: string; clientId: string },
  fetchFn: FetchFn,
): Promise<MailResult<TokenSet>> {
  const res = await postToken(fetchFn, {
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
  })
  if (!res.ok) return res
  return ok(toTokenSet(res.value))
}

/** Normalizes a raw token response into our TokenSet (absolute expiry). */
function toTokenSet(data: TokenResponse): TokenSet {
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600
  const set: TokenSet = {
    accessToken: data.access_token as string,
    expiresAt: Date.now() + expiresIn * 1000,
  }
  if (data.refresh_token) set.refreshToken = data.refresh_token
  return set
}

// ── Error mapping ────────────────────────────────────────────────────────────

/** Maps a Google OAuth error code to our typed MailErrorCode. */
function classifyOAuthError(code: string | undefined): 'auth' | 'unknown' {
  switch (code) {
    case 'invalid_grant':
    case 'invalid_client':
    case 'unauthorized_client':
    case 'access_denied':
      return 'auth'
    default:
      return 'unknown'
  }
}

/** A safe, human message per Google error code (never echoes description text). */
function oauthMessage(code: string | undefined): string {
  switch (code) {
    case 'invalid_grant':
      return 'Google sign-in expired or was revoked — please sign in again.'
    case 'invalid_client':
    case 'unauthorized_client':
      return 'The configured Google OAuth client is not valid for this app.'
    case 'access_denied':
      return 'Sign-in was cancelled or access was denied.'
    default:
      return 'Google sign-in failed. Please try again.'
  }
}
