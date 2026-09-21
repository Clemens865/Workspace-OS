import { refreshAccessToken as refreshGoogleToken, type FetchFn, type TokenSet } from './oauth/google-oauth'
import { refreshAccessToken as refreshMicrosoftToken } from './oauth/microsoft-oauth'
import type { MailAccountStore, MailAuthProvider } from './account-store'
import type { MailResult } from './types'
import { ok, err } from './types'

/**
 * In-memory access-token cache for xoauth2 mail accounts (Google AND Microsoft).
 *
 * The stored "secret" for an xoauth2 account is its REFRESH TOKEN (safeStorage-
 * encrypted on disk via the account store). Access tokens are EPHEMERAL: obtained
 * on demand from that refresh token, cached in memory keyed by accountId, and
 * refreshed automatically when within a small skew of expiry. They are NEVER
 * persisted and NEVER logged.
 *
 * Provider-aware: each account carries an `authProvider` ('google' | 'microsoft',
 * defaulting to 'google' for pre-tag records). The manager dispatches to the right
 * token endpoint and resolves the right client id. Microsoft ROTATES refresh
 * tokens on refresh — when a new one comes back we re-encrypt it into the store so
 * the account keeps working.
 *
 * All dependencies (fetch, clock, the client-id resolvers) are injected so the
 * whole thing is unit-testable without Electron or a real provider socket.
 */

/** Refresh when the cached token is within this many ms of expiring. */
const EXPIRY_SKEW_MS = 60_000

interface CachedToken {
  accessToken: string
  expiresAt: number
}

export interface TokenManagerDeps {
  /** Injected fetch — production passes a global-fetch adapter; tests a fake. */
  fetchFn: FetchFn
  /** Resolves the Google OAuth client id (from settings/env). May return null. */
  getClientId: () => string | null
  /** Resolves the Microsoft OAuth client id. Optional so existing callers/tests
   *  that only use Google continue to work unchanged. */
  getMicrosoftClientId?: () => string | null
  /** Injectable clock for tests (defaults to Date.now). */
  now?: () => number
  /** Skew window override (tests). */
  skewMs?: number
}

export class TokenManager {
  private readonly cache = new Map<string, CachedToken>()
  private readonly now: () => number
  private readonly skewMs: number

  constructor(
    private readonly accounts: MailAccountStore,
    private readonly deps: TokenManagerDeps,
  ) {
    this.now = deps.now ?? Date.now
    this.skewMs = deps.skewMs ?? EXPIRY_SKEW_MS
  }

  /**
   * Returns a valid access token for the account, refreshing if necessary. The
   * caller uses it immediately for one IMAP/SMTP auth and does not store it.
   */
  async getAccessToken(accountId: string): Promise<MailResult<string>> {
    const cached = this.cache.get(accountId)
    if (cached && this.now() < cached.expiresAt - this.skewMs) {
      return ok(cached.accessToken)
    }
    return this.refresh(accountId)
  }

  /** Drops any cached token for an account (e.g. on removal or forced re-auth). */
  invalidate(accountId: string): void {
    this.cache.delete(accountId)
  }

  /** Forces a refresh from the stored refresh token, updating the cache. */
  private async refresh(accountId: string): Promise<MailResult<string>> {
    // Determine which provider this account refreshes against (default google).
    const provider = await this.providerFor(accountId)
    const clientId =
      provider === 'microsoft'
        ? (this.deps.getMicrosoftClientId?.() ?? null)
        : this.deps.getClientId()
    if (!clientId) {
      const who = provider === 'microsoft' ? 'Microsoft' : 'Google'
      return err('unavailable', `${who} sign-in is not configured (no client ID).`)
    }

    let refreshToken: string | null
    try {
      refreshToken = await this.accounts.getSecret(accountId)
    } catch {
      return err('unavailable', 'Secure credential storage is unavailable on this system.')
    }
    if (!refreshToken) {
      const who = provider === 'microsoft' ? 'Microsoft' : 'Google'
      return err('unavailable', `This account is not signed in with ${who}.`)
    }

    const res =
      provider === 'microsoft'
        ? await refreshMicrosoftToken({ refreshToken, clientId }, this.deps.fetchFn)
        : await refreshGoogleToken({ refreshToken, clientId }, this.deps.fetchFn)
    if (!res.ok) return res

    // Microsoft rotates the refresh token — persist the new one so the account
    // keeps working. Google usually omits it; then we keep the existing secret.
    if (res.value.refreshToken && res.value.refreshToken !== refreshToken) {
      try {
        await this.accounts.update(accountId, {}, res.value.refreshToken)
      } catch {
        /* best-effort — the in-memory access token still works for this session */
      }
    }

    this.store(accountId, res.value)
    return ok(res.value.accessToken)
  }

  /** Reads the account's provider tag, defaulting to 'google' when absent/unknown. */
  private async providerFor(accountId: string): Promise<MailAuthProvider> {
    try {
      const account = await this.accounts.get(accountId)
      return account?.authProvider === 'microsoft' ? 'microsoft' : 'google'
    } catch {
      return 'google'
    }
  }

  /**
   * Caches a freshly-obtained token set. The access token stays in memory only.
   * We re-anchor the token's remaining lifetime to the manager's OWN clock so an
   * injected test clock is authoritative (in production both are the wall clock).
   */
  private store(accountId: string, set: TokenSet): void {
    const remainingMs = Math.max(0, set.expiresAt - Date.now())
    this.cache.set(accountId, { accessToken: set.accessToken, expiresAt: this.now() + remainingMs })
  }
}
