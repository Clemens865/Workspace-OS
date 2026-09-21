import http from 'http'
import { shell } from 'electron'
import { createVerifier, challengeFromVerifier, createState } from '../../mail/oauth/pkce'
import {
  buildAuthUrl,
  discoverEndpoints,
  exchangeCode,
  type OAuthEndpoints,
  type OAuthFetch,
  type RemoteTokenSet,
} from './remote-oauth'
import type { RemoteOAuthConfig } from '../connectors'

/**
 * The ONLY Electron-touching part of the remote-OAuth path — the RFC 8252
 * loopback flow for a remote MCP server. Mirrors the email oauth-flow loopback
 * (127.0.0.1:0 ephemeral port + shell.openExternal + state check), but drives
 * the pure remote-oauth token logic. No token is ever logged; the caller
 * persists only the refresh token (safeStorage-encrypted).
 */

export type RemoteFlowResult =
  | { ok: true; tokens: RemoteTokenSet; endpoints: OAuthEndpoints }
  | { ok: false; error: string }

export interface RemoteFlowDeps {
  fetchFn: OAuthFetch
  /** Public OAuth client id (from env/config). */
  clientId: string
  openExternal?: (url: string) => Promise<void>
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000

/**
 * Resolves the connector's OAuth endpoints: configured endpoints win; otherwise
 * RFC 9728 → RFC 8414 discovery against the MCP url.
 */
async function resolveEndpoints(
  remote: RemoteOAuthConfig,
  fetchFn: OAuthFetch,
): Promise<{ ok: true; value: OAuthEndpoints } | { ok: false; error: string }> {
  if (remote.authorizationEndpoint && remote.tokenEndpoint) {
    return {
      ok: true,
      value: {
        authorizationEndpoint: remote.authorizationEndpoint,
        tokenEndpoint: remote.tokenEndpoint,
        resource: remote.resource ?? remote.url,
      },
    }
  }
  const disc = await discoverEndpoints(remote.url, fetchFn)
  if (!disc.ok) return { ok: false, error: disc.error }
  return { ok: true, value: { ...disc.value, resource: remote.resource ?? disc.value.resource } }
}

/**
 * Runs the full loopback PKCE flow for a remote connector and resolves with the
 * token set + resolved endpoints, or a typed error (never throws).
 */
export async function runRemoteOAuthFlow(
  remote: RemoteOAuthConfig,
  deps: RemoteFlowDeps,
): Promise<RemoteFlowResult> {
  const endpointsRes = await resolveEndpoints(remote, deps.fetchFn)
  if (!endpointsRes.ok) return endpointsRes
  const endpoints = endpointsRes.value

  const verifier = createVerifier()
  const challenge = challengeFromVerifier(verifier)
  const state = createState()
  const openExternal = deps.openExternal ?? ((url: string) => shell.openExternal(url))

  let server: http.Server | null = null
  try {
    const { redirectUri, waitForCode } = await startLoopbackServer(
      (s) => { server = s },
      state,
      deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    )

    const authUrl = buildAuthUrl({
      authorizationEndpoint: endpoints.authorizationEndpoint,
      clientId: deps.clientId,
      redirectUri,
      codeChallenge: challenge,
      state,
      scopes: remote.scopes,
      resource: endpoints.resource,
    })
    await openExternal(authUrl)

    const codeRes = await waitForCode()
    if (!codeRes.ok) return { ok: false, error: codeRes.error }

    const tokens = await exchangeCode(
      {
        tokenEndpoint: endpoints.tokenEndpoint,
        code: codeRes.code,
        verifier,
        clientId: deps.clientId,
        redirectUri,
        resource: endpoints.resource,
      },
      deps.fetchFn,
    )
    if (!tokens.ok) return { ok: false, error: tokens.error }
    return { ok: true, tokens: tokens.value, endpoints }
  } catch {
    return { ok: false, error: 'Sign-in could not be started.' }
  } finally {
    if (server) {
      try { (server as http.Server).close() } catch { /* best-effort */ }
    }
  }
}

const DONE_HTML =
  '<!doctype html><meta charset="utf-8"><title>Connected</title>' +
  '<body style="font-family:system-ui;padding:3rem;text-align:center">' +
  '<h2>Connected</h2><p>You can close this tab and return to Workspace OS.</p></body>'

type CodeResult = { ok: true; code: string } | { ok: false; error: string }

/** Binds 127.0.0.1:0, returns the loopback redirect URI + a code promise. */
function startLoopbackServer(
  onServer: (s: http.Server) => void,
  expectedState: string,
  timeoutMs: number,
): Promise<{ redirectUri: string; waitForCode: () => Promise<CodeResult> }> {
  return new Promise((resolve, reject) => {
    let settle: ((r: CodeResult) => void) | null = null
    const codePromise = new Promise<CodeResult>((res) => { settle = res })

    const timer = setTimeout(() => {
      settle?.({ ok: false, error: 'Sign-in timed out. Please try again.' })
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()

    const server = http.createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
        response.statusCode = 404
        response.end()
        return
      }
      response.statusCode = 200
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(DONE_HTML)

      clearTimeout(timer)
      if (url.searchParams.get('error')) {
        settle?.({ ok: false, error: 'Sign-in was cancelled or access was denied.' })
        return
      }
      if (url.searchParams.get('state') !== expectedState) {
        settle?.({ ok: false, error: 'Sign-in could not be verified (state mismatch).' })
        return
      }
      const code = url.searchParams.get('code') ?? ''
      settle?.(code ? { ok: true, code } : { ok: false, error: 'No authorization code was returned.' })
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      onServer(server)
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Could not determine loopback port'))
        return
      }
      resolve({
        redirectUri: `http://127.0.0.1:${addr.port}`,
        waitForCode: () => codePromise,
      })
    })
  })
}
