/**
 * PURE, Electron-free OAuth 2.1 logic for REMOTE (Streamable-HTTP) MCP servers.
 *
 * Path B: WE own the OAuth (PKCE loopback, reusing the email flow) against the
 * MCP server's own authorization server and store the refresh token in our
 * vault. The `claude` CLI gets a fresh bearer at connect time via our
 * `headersHelper` (wos-mcp-token) — we never rely on the CLI's own buggy OAuth
 * persistence.
 *
 * This module contains NO I/O of its own — every network call is performed via
 * an INJECTED `fetchFn`, so discovery + token exchange/refresh are unit-testable
 * without touching a real server. It never logs and treats every token as
 * sensitive (callers persist only the refresh token, safeStorage-encrypted).
 *
 * Metadata discovery follows RFC 9728 (protected-resource metadata) →
 * RFC 8414 (authorization-server metadata). A connector may also carry
 * pre-configured endpoints, which short-circuit discovery.
 */

/** Minimal fetch surface — a GET-and-POST superset of the mail FetchFn. */
export type OAuthFetch = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

/** The endpoints needed to run PKCE + refresh against a server's auth server. */
export interface OAuthEndpoints {
  /** RFC 8414 `authorization_endpoint`. */
  authorizationEndpoint: string
  /** RFC 8414 `token_endpoint`. */
  tokenEndpoint: string
  /** RFC 9728 `resource` identifier (audience), when known. */
  resource?: string
  /** OAuth registration/client id to use in the PKCE flow (public). */
  clientId?: string
}

/** A resolved token set from an exchange/refresh. */
export interface RemoteTokenSet {
  accessToken: string
  refreshToken?: string
  /** Absolute epoch-ms at which the access token expires. */
  expiresAt: number
}

export type OAuthResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

function ok<T>(value: T): OAuthResult<T> {
  return { ok: true, value }
}
function fail<T>(error: string): OAuthResult<T> {
  return { ok: false, error }
}

// ── Metadata discovery ───────────────────────────────────────────────────────

interface ProtectedResourceMetadata {
  authorization_servers?: unknown
  resource?: unknown
}
interface AuthServerMetadata {
  authorization_endpoint?: unknown
  token_endpoint?: unknown
  registration_endpoint?: unknown
}

/** Joins an origin with a well-known suffix, tolerating a path on the base URL. */
function wellKnown(baseUrl: string, suffix: string): string {
  const u = new URL(baseUrl)
  return `${u.origin}${suffix}`
}

async function getJson(
  fetchFn: OAuthFetch,
  url: string,
): Promise<unknown | null> {
  try {
    const res = await fetchFn(url, { method: 'GET', headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/**
 * Parses an RFC 9728 protected-resource metadata document into the auth-server
 * URL(s) + resource id. Pure — separated so a fixture can exercise it directly.
 */
export function parseProtectedResource(
  doc: unknown,
): { authServer: string; resource?: string } | null {
  if (!doc || typeof doc !== 'object') return null
  const m = doc as ProtectedResourceMetadata
  const servers = Array.isArray(m.authorization_servers) ? m.authorization_servers : []
  const first = servers.find((s) => typeof s === 'string' && s.length > 0)
  if (typeof first !== 'string') return null
  const resource = typeof m.resource === 'string' ? m.resource : undefined
  return { authServer: first, resource }
}

/**
 * Parses an RFC 8414 authorization-server metadata document into the endpoints
 * we need. Pure — fixture-testable.
 */
export function parseAuthServerMetadata(doc: unknown): {
  authorizationEndpoint: string
  tokenEndpoint: string
} | null {
  if (!doc || typeof doc !== 'object') return null
  const m = doc as AuthServerMetadata
  if (typeof m.authorization_endpoint !== 'string' || typeof m.token_endpoint !== 'string') {
    return null
  }
  return { authorizationEndpoint: m.authorization_endpoint, tokenEndpoint: m.token_endpoint }
}

/**
 * Discovers a remote MCP server's OAuth endpoints: RFC 9728
 * `/.well-known/oauth-protected-resource` on the MCP URL origin → the named
 * authorization server's RFC 8414 metadata. Returns the endpoints or an error.
 */
export async function discoverEndpoints(
  mcpUrl: string,
  fetchFn: OAuthFetch,
): Promise<OAuthResult<OAuthEndpoints>> {
  const prDoc = await getJson(fetchFn, wellKnown(mcpUrl, '/.well-known/oauth-protected-resource'))
  const pr = parseProtectedResource(prDoc)
  if (!pr) return fail('Could not discover the server’s OAuth metadata.')

  // RFC 8414: metadata lives at <issuer-origin>/.well-known/oauth-authorization-server
  const asDoc = await getJson(
    fetchFn,
    wellKnown(pr.authServer, '/.well-known/oauth-authorization-server'),
  )
  const as = parseAuthServerMetadata(asDoc)
  if (!as) return fail('The server’s authorization metadata was unreadable.')

  return ok({
    authorizationEndpoint: as.authorizationEndpoint,
    tokenEndpoint: as.tokenEndpoint,
    resource: pr.resource ?? mcpUrl,
  })
}

// ── Authorization URL ────────────────────────────────────────────────────────

/**
 * Builds the OAuth 2.1 consent URL (PKCE S256). `resource` is included per
 * RFC 8707 (resource indicators) so the token is audience-bound to this MCP
 * server. `scopes` may be empty (server default).
 */
export function buildAuthUrl(params: {
  authorizationEndpoint: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  state: string
  scopes?: string[]
  resource?: string
}): string {
  const qs = new URLSearchParams({
    response_type: 'code',
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    state: params.state,
  })
  if (params.scopes && params.scopes.length > 0) qs.set('scope', params.scopes.join(' '))
  if (params.resource) qs.set('resource', params.resource)
  const sep = params.authorizationEndpoint.includes('?') ? '&' : '?'
  return `${params.authorizationEndpoint}${sep}${qs.toString()}`
}

// ── Token exchange / refresh ─────────────────────────────────────────────────

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
}

async function postToken(
  fetchFn: OAuthFetch,
  tokenEndpoint: string,
  body: Record<string, string>,
): Promise<OAuthResult<RemoteTokenSet>> {
  let res: { ok: boolean; status: number; json: () => Promise<unknown> }
  try {
    res = await fetchFn(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(body).toString(),
    })
  } catch {
    return fail('Could not reach the authorization server.')
  }
  let data: TokenResponse
  try {
    data = ((await res.json()) as TokenResponse) ?? {}
  } catch {
    return fail('The authorization server returned an unreadable response.')
  }
  if (!res.ok || data.error || !data.access_token) {
    // Surface the coarse code only — never echo a description (may leak params).
    return fail(data.error ? `authorization failed (${data.error})` : 'authorization failed')
  }
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600
  const set: RemoteTokenSet = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  }
  if (data.refresh_token) set.refreshToken = data.refresh_token
  return ok(set)
}

/** Exchanges an authorization `code` (+ PKCE verifier) for a token set. */
export function exchangeCode(
  params: {
    tokenEndpoint: string
    code: string
    verifier: string
    clientId: string
    redirectUri: string
    resource?: string
  },
  fetchFn: OAuthFetch,
): Promise<OAuthResult<RemoteTokenSet>> {
  const body: Record<string, string> = {
    grant_type: 'authorization_code',
    code: params.code,
    code_verifier: params.verifier,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
  }
  if (params.resource) body.resource = params.resource
  return postToken(fetchFn, params.tokenEndpoint, body)
}

/**
 * Refreshes an access token from a stored refresh token. Some servers rotate
 * the refresh token; when a new one is returned the caller MUST persist it.
 */
export function refreshAccessToken(
  params: {
    tokenEndpoint: string
    refreshToken: string
    clientId: string
    resource?: string
  },
  fetchFn: OAuthFetch,
): Promise<OAuthResult<RemoteTokenSet>> {
  const body: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
  }
  if (params.resource) body.resource = params.resource
  return postToken(fetchFn, params.tokenEndpoint, body)
}
