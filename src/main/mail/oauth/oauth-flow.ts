import http from 'http'
import { shell } from 'electron'
import {
  buildAuthUrl as buildGoogleAuthUrl,
  createVerifier,
  challengeFromVerifier,
  createState,
  exchangeCode as exchangeGoogleCode,
  DEFAULT_MAIL_SCOPES,
  type FetchFn,
  type TokenSet,
} from './google-oauth'
import {
  buildAuthUrl as buildMicrosoftAuthUrl,
  exchangeCode as exchangeMicrosoftCode,
  DEFAULT_MS_MAIL_SCOPES,
} from './microsoft-oauth'
import { ok, err, type MailResult } from '../types'

/**
 * The ONLY Electron-touching part of the OAuth path, kept deliberately thin: it
 * runs the RFC 8252 loopback flow and delegates all token math to the PURE
 * google-oauth / microsoft-oauth modules.
 *
 *   1. start a localhost http server on an EPHEMERAL port,
 *   2. open the system browser (shell.openExternal) to the consent URL,
 *   3. capture the ?code= (and validate ?state=) on the loopback redirect,
 *   4. exchange the code for tokens via the injected fetch,
 *   5. shut the server down and return the token set.
 *
 * The provider-specific bits (auth-URL builder, code exchange, default scopes,
 * and the wording of the "couldn't start" error) are injected so ONE core drives
 * both Google and Microsoft — the loopback plumbing exists exactly once.
 *
 * No token is ever logged. The refresh token in the returned set is handed
 * straight to the account store (safeStorage-encrypted) by the caller.
 */

export interface OAuthFlowResult {
  tokens: TokenSet
}

export interface RunFlowDeps {
  clientId: string
  fetchFn: FetchFn
  scopes?: string[]
  /** Injectable browser opener (defaults to Electron shell.openExternal). */
  openExternal?: (url: string) => Promise<void>
  /** Overall timeout for the user to complete consent (ms). */
  timeoutMs?: number
}

/** Provider-specific hooks the shared core needs. */
interface ProviderFlow {
  /** Human name used in timeout / error messages ("Google" / "Microsoft"). */
  name: string
  defaultScopes: string[]
  buildAuthUrl: (
    clientId: string,
    redirectUri: string,
    scopes: string[],
    codeChallenge: string,
    state: string,
  ) => string
  exchangeCode: (
    params: { code: string; verifier: string; clientId: string; redirectUri: string },
    fetchFn: FetchFn,
  ) => Promise<MailResult<TokenSet>>
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000

/**
 * Runs the full loopback flow for a given provider and resolves with the token
 * set, or a typed error (never throws). The caller persists tokens.refreshToken
 * as the account secret.
 */
async function runOAuthFlow(
  provider: ProviderFlow,
  deps: RunFlowDeps,
): Promise<MailResult<OAuthFlowResult>> {
  const verifier = createVerifier()
  const challenge = challengeFromVerifier(verifier)
  const state = createState()
  const openExternal = deps.openExternal ?? ((url: string) => shell.openExternal(url))
  const scopes = deps.scopes ?? provider.defaultScopes

  let server: http.Server | null = null
  try {
    const { redirectUri, waitForCode } = await startLoopbackServer(
      (s) => { server = s },
      state,
      provider.name,
      deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    )

    const authUrl = provider.buildAuthUrl(deps.clientId, redirectUri, scopes, challenge, state)
    await openExternal(authUrl)

    const codeRes = await waitForCode()
    if (!codeRes.ok) return codeRes

    const tokens = await provider.exchangeCode(
      { code: codeRes.value, verifier, clientId: deps.clientId, redirectUri },
      deps.fetchFn,
    )
    if (!tokens.ok) return tokens
    return ok({ tokens: tokens.value })
  } catch {
    return err('unknown', `${provider.name} sign-in could not be started.`)
  } finally {
    if (server) {
      try {
        ;(server as http.Server).close()
      } catch {
        /* best-effort */
      }
    }
  }
}

/** Google installed-app loopback flow. */
export function runGoogleOAuthFlow(deps: RunFlowDeps): Promise<MailResult<OAuthFlowResult>> {
  return runOAuthFlow(
    {
      name: 'Google',
      defaultScopes: DEFAULT_MAIL_SCOPES,
      buildAuthUrl: buildGoogleAuthUrl,
      exchangeCode: exchangeGoogleCode,
    },
    deps,
  )
}

/**
 * Microsoft installed-app loopback flow. Required for consumer Outlook/Hotmail/
 * Live/MSN since Microsoft disabled basic-auth IMAP/SMTP in Sept 2024.
 */
export function runMicrosoftOAuthFlow(deps: RunFlowDeps): Promise<MailResult<OAuthFlowResult>> {
  return runOAuthFlow(
    {
      name: 'Microsoft',
      defaultScopes: DEFAULT_MS_MAIL_SCOPES,
      buildAuthUrl: buildMicrosoftAuthUrl,
      exchangeCode: exchangeMicrosoftCode,
    },
    deps,
  )
}

/** Minimal success/redirect HTML shown in the browser tab after consent. */
const DONE_HTML =
  '<!doctype html><meta charset="utf-8"><title>Signed in</title>' +
  '<body style="font-family:system-ui;padding:3rem;text-align:center">' +
  '<h2>Signed in</h2><p>You can close this tab and return to Workspace OS.</p></body>'

/**
 * Binds an http server to 127.0.0.1:0 (ephemeral port) and returns the resolved
 * loopback redirect URI plus a promise that resolves with the captured code (or
 * a typed error on state mismatch / OAuth error / timeout).
 */
function startLoopbackServer(
  onServer: (s: http.Server) => void,
  expectedState: string,
  providerName: string,
  timeoutMs: number,
): Promise<{ redirectUri: string; waitForCode: () => Promise<MailResult<string>> }> {
  return new Promise((resolve, reject) => {
    let settle: ((r: MailResult<string>) => void) | null = null
    const codePromise = new Promise<MailResult<string>>((res) => { settle = res })

    const timer = setTimeout(() => {
      settle?.(err('timeout', `${providerName} sign-in timed out. Please try again.`))
    }, timeoutMs)
    // Do not keep the process alive purely for this timer.
    if (typeof timer.unref === 'function') timer.unref()

    const server = http.createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      // Ignore favicon and any non-callback noise.
      if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
        response.statusCode = 404
        response.end()
        return
      }
      response.statusCode = 200
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(DONE_HTML)

      clearTimeout(timer)
      const oauthError = url.searchParams.get('error')
      if (oauthError) {
        settle?.(err('auth', 'Sign-in was cancelled or access was denied.'))
        return
      }
      if (url.searchParams.get('state') !== expectedState) {
        settle?.(err('auth', 'Sign-in could not be verified (state mismatch).'))
        return
      }
      const code = url.searchParams.get('code') ?? ''
      settle?.(code ? ok(code) : err('auth', `${providerName} did not return an authorization code.`))
    })

    server.on('error', reject)
    // 127.0.0.1 (loopback) + port 0 → OS assigns a free ephemeral port.
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
