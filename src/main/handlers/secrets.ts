import { IpcMain } from 'electron'
import { IPC } from '../ipc-channels'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError } from '../ipc-validator'
import { assertMainFrame } from '../security'
import { getVault, getConnectorState } from '../secrets'
import { isValidSecretName } from '../secrets/vault'
import { CONNECTORS, getConnector, isConnectorId, isRemoteOAuth, requiredSecretNames } from '../mcp/connectors'
import { runRemoteOAuthFlow, type RemoteFlowDeps } from '../mcp/oauth/remote-flow'
import { remoteVaultKey, serializeRecord } from '../mcp/oauth/remote-vault'
import type { OAuthFetch } from '../mcp/oauth/remote-oauth'

/** Adapts the runtime global fetch to the narrow OAuthFetch the flow expects. */
const nodeFetch: OAuthFetch = (url, init) =>
  fetch(url, { method: init.method, headers: init.headers, body: init.body })

/**
 * Resolves the public OAuth client id for a remote connector. Env wins:
 * `MCP_OAUTH_<ID>_CLIENT_ID` (id upper-cased). Then any configured
 * `remote.clientId` in the catalog. Sentry supports Dynamic Client Registration,
 * so a fallback public id lets the flow proceed when nothing is configured.
 */
function resolveRemoteClientId(connectorId: string, configured?: string): string {
  const envKey = `MCP_OAUTH_${connectorId.toUpperCase()}_CLIENT_ID`
  const fromEnv = process.env[envKey]
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  if (configured && configured.trim()) return configured.trim()
  // A stable public client id for the loopback flow (installed-app style). The
  // server may still require DCR; that surfaces as a clear auth error the user
  // can act on. Never a secret.
  return 'workspace-os'
}

/**
 * IPC surface for the secret vault + MCP connectors.
 *
 * SECURITY: no channel here ever returns a secret VALUE. `secret:list` returns
 * names only; `secret:set` takes a value and it is encrypted+persisted in main
 * immediately (never stored renderer-side). Inputs are validated/coerced at the
 * boundary — a bad name or non-string value is rejected before the vault sees it.
 */
export function registerSecretsHandlers(ipcMain: IpcMain): void {
  const vault = (): ReturnType<typeof getVault> => getVault()
  const state = (): ReturnType<typeof getConnectorState> => getConnectorState()

  // --- secrets -------------------------------------------------------------

  ipcHandle(ipcMain, IPC.SECRET_LIST, (event) => {
    assertMainFrame(event)
    return vault().list() // names + metadata only
  })

  ipcHandle(ipcMain, IPC.SECRET_STATUS, (event) => {
    assertMainFrame(event)
    return vault().status() // { available, backend }
  })

  ipcHandle(ipcMain, IPC.SECRET_SET, (event, name: unknown, value: unknown) => {
    assertMainFrame(event)
    if (!isValidSecretName(name)) throw new IpcValidationError('Invalid secret name')
    if (typeof value !== 'string' || value.length === 0) {
      throw new IpcValidationError('Secret value must be a non-empty string')
    }
    // Vault.set throws (surfaced to the UI) if secure storage is unavailable —
    // it refuses to persist plaintext.
    vault().set(name, value)
    return { ok: true }
  })

  ipcHandle(ipcMain, IPC.SECRET_REMOVE, (event, name: unknown) => {
    assertMainFrame(event)
    if (!isValidSecretName(name)) throw new IpcValidationError('Invalid secret name')
    vault().remove(name)
    return { ok: true }
  })

  // --- MCP connectors ------------------------------------------------------

  ipcHandle(ipcMain, IPC.MCP_LIST_CONNECTORS, (event) => {
    assertMainFrame(event)
    // Static catalog (no secrets) — display data for the settings panel.
    return CONNECTORS.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      description: c.description,
      kind: isRemoteOAuth(c) ? ('remote-oauth' as const) : ('stdio-apikey' as const),
      secrets: c.secrets.map((s) => ({ envVar: s.envVar, label: s.label, hint: s.hint })),
    }))
  })

  ipcHandle(ipcMain, IPC.MCP_ENABLE, (event, id: unknown) => {
    assertMainFrame(event)
    if (!isConnectorId(id)) throw new IpcValidationError('Unknown connector')
    state().enable(id)
    return { ok: true }
  })

  ipcHandle(ipcMain, IPC.MCP_DISABLE, (event, id: unknown) => {
    assertMainFrame(event)
    if (!isConnectorId(id)) throw new IpcValidationError('Unknown connector')
    state().disable(id)
    return { ok: true }
  })

  /**
   * Per-connector runtime status for the UI: enabled? and are all its required
   * secrets present in the vault (so it will actually wire into a run)? No
   * secret value crosses IPC — only presence booleans.
   */
  ipcHandle(ipcMain, IPC.MCP_STATUS, (event) => {
    assertMainFrame(event)
    const enabled = new Set(state().enabled())
    const v = vault()
    return CONNECTORS.map((c) => {
      const need = requiredSecretNames(c.id)
      const missing = need.filter((n) => !v.has(n))
      // A remote-oauth connector is "ready" when it is enabled AND connected (an
      // OAuth record is stored) — it has no env secrets.
      const remote = isRemoteOAuth(c)
      const connected = remote && v.has(remoteVaultKey(c.id))
      return {
        id: c.id,
        kind: remote ? ('remote-oauth' as const) : ('stdio-apikey' as const),
        enabled: enabled.has(c.id),
        requiredSecrets: need,
        missingSecrets: missing,
        connected: remote ? connected : undefined,
        ready: remote
          ? enabled.has(c.id) && !!connected
          : enabled.has(c.id) && missing.length === 0,
      }
    })
  })

  // --- Remote OAuth connectors (Path B) ------------------------------------

  /**
   * Run the PKCE loopback flow for a remote-oauth connector against the server's
   * own auth server and persist the REFRESH TOKEN (+ token endpoint/clientId/
   * resource, all non-secret) in the vault, safeStorage-encrypted. No token is
   * ever logged or returned to the renderer — only a { connected } result.
   */
  ipcHandle(ipcMain, IPC.MCP_OAUTH_CONNECT, async (event, id: unknown) => {
    assertMainFrame(event)
    if (!isConnectorId(id)) throw new IpcValidationError('Unknown connector')
    const connector = getConnector(id)
    if (!connector || !isRemoteOAuth(connector) || !connector.remote) {
      return { ok: false as const, error: 'Not a remote OAuth connector.' }
    }
    const clientId = resolveRemoteClientId(id, connector.remote.clientId)
    const deps: RemoteFlowDeps = { fetchFn: nodeFetch, clientId }
    const flow = await runRemoteOAuthFlow(connector.remote, deps)
    if (!flow.ok) return { ok: false as const, error: flow.error }

    const refreshToken = flow.tokens.refreshToken
    if (!refreshToken) {
      return {
        ok: false as const,
        error: 'The server did not return a refresh token — cannot stay connected.',
      }
    }
    const key = remoteVaultKey(id)
    if (!key) return { ok: false as const, error: 'Invalid connector id.' }
    // Vault.set throws if secure storage is unavailable (refuses plaintext).
    getVault().set(
      key,
      serializeRecord({
        refreshToken,
        tokenEndpoint: flow.endpoints.tokenEndpoint,
        clientId,
        resource: flow.endpoints.resource,
        accessToken: flow.tokens.accessToken,
        accessTokenExpiresAt: flow.tokens.expiresAt,
      }),
    )
    // Enabling on successful connect mirrors the API-key UX (a saved key alone
    // doesn't enable, but connecting is an explicit user action here).
    getConnectorState().enable(id)
    return { ok: true as const, connected: true }
  })

  /** Connected? (an OAuth record is stored). No token crosses IPC. */
  ipcHandle(ipcMain, IPC.MCP_OAUTH_STATUS, (event, id: unknown) => {
    assertMainFrame(event)
    if (!isConnectorId(id)) throw new IpcValidationError('Unknown connector')
    const key = remoteVaultKey(id)
    return { connected: !!key && vault().has(key) }
  })

  /** Disconnect — remove the stored OAuth record. */
  ipcHandle(ipcMain, IPC.MCP_OAUTH_DISCONNECT, (event, id: unknown) => {
    assertMainFrame(event)
    if (!isConnectorId(id)) throw new IpcValidationError('Unknown connector')
    const key = remoteVaultKey(id)
    if (key) vault().remove(key)
    return { ok: true as const }
  })
}
