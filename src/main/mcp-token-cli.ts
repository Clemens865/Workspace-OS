/*
 * wos-mcp-token — the `headersHelper` for remote OAuth MCP connectors (Path B).
 *
 * Invocation:   wos-mcp-token <connectorId>
 *
 * It reads the connector's OAuth record (refresh token + endpoints + clientId)
 * from the SAME safeStorage-encrypted vault the app uses, refreshes the access
 * token when near-expiry via the connector's token endpoint, and prints EXACTLY
 *
 *     {"Authorization":"Bearer <accessToken>"}
 *
 * to stdout and nothing else — the `claude` CLI reads this as the auth headers
 * for the remote MCP server at connect time.
 *
 * FAIL-SAFE: on ANY failure (no record, network error, keychain unavailable) it
 * prints an empty JSON object `{}` to stdout (so the CLI simply gets no auth
 * header and the spawn is never crashed) and exits non-zero, logging a coarse
 * reason to stderr. It NEVER prints or logs the refresh token or any secret.
 *
 * Runs under plain `node` (no electron runtime): it constructs its own Vault
 * pointed at the app's userData secrets.json, using electron `safeStorage` for
 * decryption. `require('electron')` under plain node returns the binary path, so
 * we access safeStorage only when it is a real object.
 */
import { Vault } from './secrets/vault'
import type { SecretStore } from './secrets/secret-store'
import { userDataDir } from './userdata-path'
import {
  parseRecord,
  serializeRecord,
  remoteVaultKey,
  needsRefresh,
  type RemoteOAuthRecord,
} from './mcp/oauth/remote-vault'
import { refreshAccessToken, type OAuthFetch } from './mcp/oauth/remote-oauth'

/**
 * Resolves the auth headers for a stored record, minting a fresh access token
 * via the token endpoint ONLY when the cached one is missing/near-expiry.
 * Returns the headers object plus an optional UPDATED record to persist (when a
 * new access token was minted and/or the refresh token rotated). PURE aside from
 * the injected fetch — unit-testable with a fake token endpoint, no electron.
 *
 * NEVER includes the refresh token in the returned headers; only the Bearer.
 */
export async function resolveAuthHeaders(
  rec: RemoteOAuthRecord,
  fetchFn: OAuthFetch,
  now: number = Date.now(),
): Promise<
  | { ok: true; headers: { Authorization: string }; updated?: RemoteOAuthRecord }
  | { ok: false; error: string }
> {
  if (!needsRefresh(rec, now) && rec.accessToken) {
    return { ok: true, headers: { Authorization: `Bearer ${rec.accessToken}` } }
  }
  const res = await refreshAccessToken(
    {
      tokenEndpoint: rec.tokenEndpoint,
      refreshToken: rec.refreshToken,
      clientId: rec.clientId,
      resource: rec.resource,
    },
    fetchFn,
  )
  if (!res.ok) return { ok: false, error: res.error }
  const updated: RemoteOAuthRecord = {
    ...rec,
    accessToken: res.value.accessToken,
    accessTokenExpiresAt: res.value.expiresAt,
  }
  // If the server rotated the refresh token, persist the new one.
  if (res.value.refreshToken && res.value.refreshToken !== rec.refreshToken) {
    updated.refreshToken = res.value.refreshToken
  }
  return { ok: true, headers: { Authorization: `Bearer ${res.value.accessToken}` }, updated }
}

/** Print `{}` and exit non-zero, logging only a coarse reason (no secrets). */
function bail(reason: string): never {
  process.stdout.write('{}')
  process.stderr.write(`wos-mcp-token: ${reason}\n`)
  process.exit(1)
}

/**
 * Builds a SecretStore backed by electron safeStorage when available. Under
 * plain node `require('electron')` returns a string (the binary path) — in that
 * case safeStorage is undefined and we cannot decrypt, so the caller bails.
 */
function makeSecretStore(): SecretStore | null {
  let safeStorage: {
    isEncryptionAvailable?: () => boolean
    encryptString?: (s: string) => Buffer
    decryptString?: (b: Buffer) => string
  } | undefined
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron')
    safeStorage = electron && typeof electron === 'object' ? electron.safeStorage : undefined
  } catch {
    safeStorage = undefined
  }
  if (!safeStorage || typeof safeStorage.decryptString !== 'function') return null
  return {
    isAvailable: () => {
      try {
        return !!safeStorage!.isEncryptionAvailable?.()
      } catch {
        return false
      }
    },
    encrypt: (plaintext: string) => safeStorage!.encryptString!(plaintext),
    decrypt: (ciphertext: Buffer) => safeStorage!.decryptString!(ciphertext),
    backend: () => 'safeStorage',
  }
}

const nodeFetch: OAuthFetch = (url, init) =>
  fetch(url, { method: init.method, headers: init.headers, body: init.body })

async function main(): Promise<void> {
  const connectorId = process.argv[2]
  if (!connectorId || !/^[A-Za-z0-9_-]{1,64}$/.test(connectorId)) bail('missing/invalid connector id')

  const key = remoteVaultKey(connectorId)
  if (!key) bail('invalid connector id')

  const store = makeSecretStore()
  if (!store) bail('secure storage unavailable')
  if (!store.isAvailable()) bail('keychain unavailable')

  const vault = new Vault(userDataDir(), store)

  let raw: string | null
  try {
    raw = vault.get(key)
  } catch {
    bail('could not read vault')
  }
  const rec = parseRecord(raw)
  if (!rec) bail('connector not connected')

  const res = await resolveAuthHeaders(rec, nodeFetch)
  if (!res.ok) bail(`refresh failed: ${res.error}`)

  // Persist a freshly-minted access token (and any rotated refresh token) so the
  // NEXT connect can reuse it until near-expiry. Best-effort — never fatal.
  if (res.updated) {
    try {
      vault.set(key, serializeRecord(res.updated))
    } catch {
      /* best-effort cache/rotation persistence */
    }
  }

  // EXACTLY the headers object and nothing else. No trailing newline noise, no
  // token anywhere but the Bearer value.
  process.stdout.write(JSON.stringify(res.headers))
  process.exit(0)
}

// Only auto-run as a CLI (not when imported by unit tests). Under the esbuild
// CJS bundle `require.main === module` is true for the entry; under vitest's ESM
// loader `require`/`module` are undefined, so this guard keeps import side-effect
// free (the test imports resolveAuthHeaders without triggering main()).
declare const module: unknown
if (
  typeof require !== 'undefined' &&
  typeof module !== 'undefined' &&
  (require as unknown as { main?: unknown }).main === module
) {
  main().catch((e) => {
    // Never leak an exception body (could echo params); coarse reason only.
    bail(`unexpected error${e instanceof Error && e.name ? ` (${e.name})` : ''}`)
  })
}
