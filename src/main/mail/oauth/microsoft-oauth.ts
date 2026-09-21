import type { MailResult } from '../types'
import { ok, err } from '../types'
import type { FetchFn, TokenSet } from './google-oauth'

// Re-export the shared PKCE + XOAUTH2 helpers so a Microsoft caller can import
// everything it needs from this one module (mirrors google-oauth's surface).
export { createVerifier, challengeFromVerifier, createState } from './pkce'
export { buildXoauth2Token } from './xoauth2'
export type { FetchFn, TokenSet } from './google-oauth'

/**
 * PURE, Electron-free Microsoft (Entra / identity-platform v2.0) OAuth2 token
 * logic for the installed-app / loopback flow (RFC 8252 + PKCE, RFC 7636). Mirrors
 * google-oauth.ts exactly: NO I/O of its own — network calls go through an
 * INJECTED `fetchFn`, so every function here is unit-testable without ever
 * touching Microsoft.
 *
 * WHY THIS EXISTS: Microsoft disabled basic-auth (passwords AND app-passwords)
 * for consumer Outlook/Hotmail/Live/MSN IMAP+SMTP in Sept 2024. OAuth2 XOAUTH2 is
 * now the ONLY way in. This is a public-client flow (no client secret) proven with
 * PKCE; the client id is public and supplied by the caller (env/userData), never
 * hardcoded.
 *
 * SECURITY: this module never logs. Access/refresh tokens are handled as sensitive
 * by callers (token-manager keeps them in memory; the refresh token is only ever
 * safeStorage-encrypted on disk).
 */

/**
 * Microsoft identity-platform v2.0 endpoints. The `common` tenant lets BOTH
 * personal Microsoft accounts (Outlook/Hotmail/Live/MSN) and work/school accounts
 * sign in through the same app registration.
 */
export const MS_AUTH_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
export const MS_TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'

/**
 * Outlook-specific delegated scopes required for IMAP + SMTP over XOAUTH2. These
 * are the `outlook.office.com` resource scopes (NOT Microsoft Graph) — Graph
 * scopes do not grant IMAP/SMTP. `offline_access` yields a refresh token;
 * `openid email profile` let us read back the signed-in address if needed.
 */
export const OUTLOOK_IMAP_SCOPE = 'https://outlook.office.com/IMAP.AccessAsUser.All'
export const OUTLOOK_SMTP_SCOPE = 'https://outlook.office.com/SMTP.Send'
export const OFFLINE_ACCESS_SCOPE = 'offline_access'

/** Default scopes for the Microsoft mail flow. */
export const DEFAULT_MS_MAIL_SCOPES = [
  OUTLOOK_IMAP_SCOPE,
  OUTLOOK_SMTP_SCOPE,
  OFFLINE_ACCESS_SCOPE,
  'openid',
  'email',
  'profile',
]

// ── Authorization URL ────────────────────────────────────────────────────────

/**
 * Builds the Microsoft consent URL for the installed-app flow. `prompt=select_account`
 * lets the user pick which Microsoft account to sign in with; `offline_access`
 * (in scopes) ensures a refresh token is returned on first authorization.
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
    response_mode: 'query',
    prompt: 'select_account',
  })
  return `${MS_AUTH_ENDPOINT}?${params.toString()}`
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
    res = await fetchFn(MS_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    })
  } catch {
    // Network-level failure — never surface the raw error (could echo params).
    return err('host', 'Could not reach Microsoft to complete sign-in.')
  }
  let data: TokenResponse
  try {
    data = ((await res.json()) as TokenResponse) ?? {}
  } catch {
    return err('unknown', 'Microsoft returned an unreadable response during sign-in.')
  }
  if (!res.ok || data.error || !data.access_token) {
    // Map Microsoft's error to a typed, SANITIZED message. We surface the coarse
    // error code (e.g. invalid_grant) but never the full description verbatim.
    return err(classifyOAuthError(data.error), oauthMessage(data.error))
  }
  return ok(data)
}

/**
 * Exchanges an authorization `code` (+ PKCE verifier) for a token set. A public
 * client sends NO client secret — the code_verifier proves the request instead.
 */
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
 * Refreshes an access token using a stored refresh token. Microsoft frequently
 * ROTATES the refresh token here (returns a new one), so the caller MUST persist
 * `refreshToken` when present — otherwise the old one eventually stops working.
 */
export async function refreshAccessToken(
  params: { refreshToken: string; clientId: string; scopes?: string[] },
  fetchFn: FetchFn,
): Promise<MailResult<TokenSet>> {
  const body: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
  }
  // Microsoft accepts the scope on refresh; keep it aligned with the grant.
  if (params.scopes && params.scopes.length) body.scope = params.scopes.join(' ')
  const res = await postToken(fetchFn, body)
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

/** Maps a Microsoft OAuth error code to our typed MailErrorCode. */
function classifyOAuthError(code: string | undefined): 'auth' | 'unknown' {
  switch (code) {
    case 'invalid_grant':
    case 'invalid_client':
    case 'unauthorized_client':
    case 'access_denied':
    case 'interaction_required':
    case 'consent_required':
      return 'auth'
    default:
      return 'unknown'
  }
}

/** A safe, human message per Microsoft error code (never echoes description text). */
function oauthMessage(code: string | undefined): string {
  switch (code) {
    case 'invalid_grant':
      return 'Microsoft sign-in expired or was revoked — please sign in again.'
    case 'invalid_client':
    case 'unauthorized_client':
      return 'The configured Microsoft OAuth client is not valid for this app.'
    case 'access_denied':
      return 'Sign-in was cancelled or access was denied.'
    case 'interaction_required':
    case 'consent_required':
      return 'Microsoft needs you to sign in again to grant access.'
    default:
      return 'Microsoft sign-in failed. Please try again.'
  }
}
