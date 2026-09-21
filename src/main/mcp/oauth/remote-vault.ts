import { isValidSecretName } from '../../secrets/vault'

/**
 * Vault record shape + key naming for a remote-oauth MCP connector.
 *
 * SECURITY: the ONLY persisted secret is `refreshToken` — stored inside this
 * JSON blob in the safeStorage-encrypted vault (never plaintext on disk, never
 * logged). The non-secret endpoints/clientId/resource ride along so the
 * token-cli can refresh the access token WITHOUT re-running discovery or
 * needing the app. The access token is NEVER persisted; it is minted on demand
 * by wos-mcp-token and printed once to the CLI.
 *
 * The vault key is `MCP_OAUTH_<id>` (env-var-shaped so it satisfies the vault's
 * key-name rule — connector ids like `sentry` fit `[A-Za-z_][A-Za-z0-9_]*`).
 */

export interface RemoteOAuthRecord {
  /** The persisted secret. Never logged, never printed. */
  refreshToken: string
  /** RFC 8414 token endpoint (used for refresh). */
  tokenEndpoint: string
  /** OAuth client id used in the flow (public). */
  clientId: string
  /** RFC 8707 resource/audience, when known (bound into refresh). */
  resource?: string
  /**
   * Cached access token from the last mint, reused until near-expiry to avoid a
   * refresh round-trip on every connect. This is short-lived and machine-bound
   * (the whole record is safeStorage-encrypted); it is NEVER logged.
   */
  accessToken?: string
  /** Absolute epoch-ms the cached access token expires. */
  accessTokenExpiresAt?: number
}

/** Refresh when the cached access token is within this window of expiry (5 min). */
export const NEAR_EXPIRY_MS = 5 * 60_000

/**
 * Whether a stored record's cached access token must be re-minted: true when
 * there is no cached token or it is within {@link NEAR_EXPIRY_MS} of expiry.
 * Pure — the refresh decision is unit-testable without any network.
 */
export function needsRefresh(rec: RemoteOAuthRecord, now: number = Date.now()): boolean {
  if (!rec.accessToken || typeof rec.accessTokenExpiresAt !== 'number') return true
  return rec.accessTokenExpiresAt - now <= NEAR_EXPIRY_MS
}

/** The vault key name for a remote connector's OAuth record. */
export function remoteVaultKey(connectorId: string): string {
  const key = `MCP_OAUTH_${connectorId}`
  return isValidSecretName(key) ? key : ''
}

/** Serializes a record for storage (compact JSON). */
export function serializeRecord(rec: RemoteOAuthRecord): string {
  return JSON.stringify(rec)
}

/**
 * Parses a stored record. Returns null if the blob is malformed or missing the
 * refresh token / token endpoint (the two fields a refresh cannot proceed
 * without).
 */
export function parseRecord(raw: string | null): RemoteOAuthRecord | null {
  if (!raw) return null
  let doc: unknown
  try {
    doc = JSON.parse(raw)
  } catch {
    return null
  }
  if (!doc || typeof doc !== 'object') return null
  const r = doc as Record<string, unknown>
  if (typeof r.refreshToken !== 'string' || r.refreshToken.length === 0) return null
  if (typeof r.tokenEndpoint !== 'string' || r.tokenEndpoint.length === 0) return null
  if (typeof r.clientId !== 'string' || r.clientId.length === 0) return null
  const rec: RemoteOAuthRecord = {
    refreshToken: r.refreshToken,
    tokenEndpoint: r.tokenEndpoint,
    clientId: r.clientId,
  }
  if (typeof r.resource === 'string' && r.resource.length > 0) rec.resource = r.resource
  if (typeof r.accessToken === 'string' && r.accessToken.length > 0) rec.accessToken = r.accessToken
  if (typeof r.accessTokenExpiresAt === 'number') rec.accessTokenExpiresAt = r.accessTokenExpiresAt
  return rec
}
