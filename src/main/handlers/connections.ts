import { app, type IpcMain } from 'electron'
import { IPC } from '../ipc-channels'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError } from '../ipc-validator'
import { assertMainFrame } from '../security'
import { getVault, getConnectorState } from '../secrets'
import { accountsStore } from '../accounts'
import { CONNECTORS, isConnectorId, isRemoteOAuth, requiredSecretNames } from '../mcp/connectors'
import { needsRefresh, parseRecord, remoteVaultKey, serializeRecord } from '../mcp/oauth/remote-vault'
import { refreshAccessToken, type OAuthFetch } from '../mcp/oauth/remote-oauth'
import { resolveGoogleClientId } from '../mail/oauth/client-config'
import { siteHasSession, signOutSite } from './accounts'
import { mailAccountStore, probeMailAccount } from './mail'
import { calendarSourceStore, probeCalendarSource } from './calendar'
import { driveAccountStore, probeDrive } from './drive'
import { buildConnections, connectionLine, type Connection, type ConnectionInputs, type Probe } from '../connections/registry'
import { notify } from '../notify'

/**
 * IPC for the Connectors page: ONE list over the MCP vault, Connected Accounts
 * (browser sessions) and the mail / calendar / drive stores.
 *
 * Status is computed by probing — a refresh for OAuth accounts, a session check
 * for sites. Probes cost network, so verdicts are cached for ten minutes; the
 * page can ask for a fresh read with `force`. No secret value ever crosses
 * this boundary: probes return verdicts, and the registry returns presence
 * booleans only.
 */

const PROBE_TTL_MS = 10 * 60_000
const seenStatus = new Map<string, string>()
const probeCache = new Map<string, { at: number; result: string }>()

async function cachedProbe<T extends string>(key: string, force: boolean, run: () => Promise<T>): Promise<T> {
  const hit = probeCache.get(key)
  if (!force && hit && Date.now() - hit.at < PROBE_TTL_MS) return hit.result as T
  let result: T
  try {
    result = await run()
  } catch {
    result = 'fail' as T
  }
  probeCache.set(key, { at: Date.now(), result })
  return result
}

const nodeFetch: OAuthFetch = (url, init) => fetch(url, { method: init.method, headers: init.headers, body: init.body })

/**
 * A remote MCP connector's OAuth record, verified by minting an access token
 * when the cached one is near expiry. A rotated refresh token is persisted, as
 * the token CLI does — a probe must leave the record at least as healthy as it
 * found it.
 */
async function probeMcpOAuth(id: string): Promise<'none' | 'ok' | 'fail'> {
  const key = remoteVaultKey(id)
  if (!key) return 'none'
  const rec = parseRecord(getVault().get(key))
  if (!rec) return 'none'
  if (!needsRefresh(rec)) return 'ok'
  const res = await refreshAccessToken(
    { tokenEndpoint: rec.tokenEndpoint, refreshToken: rec.refreshToken, clientId: rec.clientId, resource: rec.resource },
    nodeFetch,
  )
  if (!res.ok) return 'fail'
  getVault().set(
    key,
    serializeRecord({
      ...rec,
      refreshToken: res.value.refreshToken || rec.refreshToken,
      accessToken: res.value.accessToken,
      accessTokenExpiresAt: res.value.expiresAt,
    }),
  )
  return 'ok'
}

async function gather(force: boolean): Promise<ConnectionInputs> {
  const vault = getVault()
  const enabled = new Set(getConnectorState().enabled())
  const userData = app.getPath('userData')

  const mcp = await Promise.all(
    CONNECTORS.map(async (c) => {
      const remote = isRemoteOAuth(c)
      const need = requiredSecretNames(c.id)
      return {
        id: c.id,
        displayName: c.displayName,
        description: c.description,
        remote,
        enabled: enabled.has(c.id),
        secrets: c.secrets.map((s) => ({ envVar: s.envVar, label: s.label, hint: s.hint, stored: vault.has(s.envVar) })),
        oauth: remote && need.length === 0 ? await cachedProbe(`mcp:${c.id}`, force, () => probeMcpOAuth(c.id)) : ('none' as const),
      }
    }),
  )

  const sites = await Promise.all(
    accountsStore()
      .list()
      .map(async (s) => ({ domain: s.domain, label: s.label, session: await siteHasSession(s.domain) })),
  )

  const mailAccounts = await mailAccountStore().list()
  const mail = await Promise.all(
    mailAccounts.map(async (a) => ({
      id: a.id,
      displayName: a.displayName,
      user: a.user,
      authKind: a.authKind,
      provider: a.authProvider,
      probe:
        a.authKind === 'xoauth2'
          ? await cachedProbe<Probe>(`mail:${a.id}`, force, () => probeMailAccount(a.id))
          : ('skip' as Probe),
    })),
  )

  const sources = await calendarSourceStore().list()
  const calendar = await Promise.all(
    sources.map(async (s) => ({
      id: s.id,
      displayName: s.displayName,
      kind: s.kind,
      probe:
        s.kind === 'google' || s.kind === 'microsoft'
          ? await cachedProbe<Probe>(`calendar:${s.id}`, force, () => probeCalendarSource(s.id))
          : ('skip' as Probe),
    })),
  )

  const driveConn = await driveAccountStore().get()
  const drive = driveConn ? { email: driveConn.email, probe: await cachedProbe<Probe>('drive', force, probeDrive) } : null

  return {
    now: Date.now(),
    mcp,
    sites,
    mail,
    calendar,
    drive,
    googleConfigured: Boolean(resolveGoogleClientId(userData)),
  }
}

export function registerConnectionsHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, IPC.CONNECTIONS_LIST, async (event, opts: unknown): Promise<Connection[]> => {
    assertMainFrame(event)
    const force = !!(opts && typeof opts === 'object' && (opts as { force?: unknown }).force === true)
    const list = buildConnections(await gather(force))
    // Tell the person ONCE per session when a sign-in has died — the list is
    // re-read often while the page is open, so only the transition counts.
    for (const conn of list) {
      const prev = seenStatus.get(conn.id)
      seenStatus.set(conn.id, conn.status)
      if (conn.status === 'needs-signin' && prev !== 'needs-signin') {
        notify({ source: 'connectors', key: conn.id, title: conn.name, body: connectionLine(conn) || 'needs you to sign in again', rail: 'connectors' })
      }
    }
    return list
  })

  /**
   * Sign out of one connection, routed by its id prefix. The secret goes
   * first, then the record — a row with no secret behind it is worse than no
   * row. MCP connectors are switched off as well so the agent stops being
   * offered a tool it can no longer reach.
   */
  ipcHandle(ipcMain, IPC.CONNECTIONS_SIGNOUT, async (event, id: unknown) => {
    assertMainFrame(event)
    if (typeof id !== 'string' || id.length === 0 || id.length > 300) throw new IpcValidationError('Invalid connection id')
    const [type, rest] = splitId(id)
    switch (type) {
      case 'mcp': {
        if (!isConnectorId(rest)) throw new IpcValidationError('Unknown connector')
        const vault = getVault()
        const key = remoteVaultKey(rest)
        if (key && vault.has(key)) vault.remove(key)
        for (const name of requiredSecretNames(rest)) if (vault.has(name)) vault.remove(name)
        getConnectorState().disable(rest)
        probeCache.delete(`mcp:${rest}`)
        return { ok: true as const }
      }
      case 'site':
        await signOutSite(rest)
        return { ok: true as const }
      case 'mail':
        await mailAccountStore().remove(rest)
        probeCache.delete(`mail:${rest}`)
        return { ok: true as const }
      case 'calendar':
        await calendarSourceStore().remove(rest)
        probeCache.delete(`calendar:${rest}`)
        return { ok: true as const }
      case 'drive':
        await driveAccountStore().disconnect()
        probeCache.delete('drive')
        return { ok: true as const }
      default:
        throw new IpcValidationError('Unknown connection')
    }
  })
}

function splitId(id: string): [string, string] {
  const i = id.indexOf(':')
  return i === -1 ? [id, ''] : [id.slice(0, i), id.slice(i + 1)]
}
