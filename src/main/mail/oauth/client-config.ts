import fs from 'fs'
import path from 'path'

/**
 * Resolves the OAuth *client id* for the installed-app (PKCE) flow.
 *
 * An installed-app client id is PUBLIC BY DESIGN. There is no client secret in
 * the PKCE flow, and the id is extractable from any binary that ships it —
 * which is exactly why Apple Mail, Thunderbird and Spark each register ONE app
 * and ship its id inside the application.
 *
 * This file used to insist the id must never be hardcoded. That was a security
 * instinct misapplied: it protects nothing (the id is not a secret) and it costs
 * everything (it made "connect your mailbox" begin with a trip to
 * portal.azure.com, which is a hard stop for the persona this product targets).
 * So a SHIPPED DEFAULT is the intended end state, with the env var and the
 * per-user file kept as overrides that beat it.
 *
 * Resolution order (first hit wins):
 *   1. process.env.<PROVIDER>_OAUTH_CLIENT_ID   — per-launch override
 *   2. <userData>/<provider>-oauth.json         — per-user override, pasted in the UI
 *   3. SHIPPED_CLIENT_ID                        — the id we ship
 *
 * Returns null only when none of the three is set — callers must handle that.
 */

const CONFIG_FILE = 'google-oauth.json'
const MS_CONFIG_FILE = 'microsoft-oauth.json'

export type OAuthProvider = 'google' | 'microsoft'

/**
 * The client ids Workspace OS ships with. `null` means "we ship none for this
 * provider" — the OAuth path then stays unavailable until the user supplies one,
 * and the UI offers a paste field instead of a sign-in button.
 *
 * To ship one: paste the Application (client) ID here. That is the whole change.
 * Registration steps and the two traps are in `docs/OUTLOOK-OAUTH-SETUP.md`
 * (supported account types must include personal Microsoft accounts; allow
 * public client flows = Yes).
 */
export const SHIPPED_CLIENT_ID: Record<OAuthProvider, string | null> = {
  google: null,
  microsoft: '5cd533ae-5510-43cb-8052-363795fda512',
}

/**
 * The precedence rule on its own, so it can be proven without touching the
 * module-level constant — which changes the day we ship an id.
 */
export function pickClientId(
  fromEnv: string | undefined,
  fromFile: string | null,
  shipped: string | null,
): string | null {
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  if (fromFile && fromFile.trim()) return fromFile.trim()
  if (shipped && shipped.trim()) return shipped.trim()
  return null
}

/** Reads `{ clientId }` out of a userData config file; null if absent/unreadable. */
function readClientIdFile(userDataDir: string, configFile: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(userDataDir, configFile), 'utf-8')
    const parsed = JSON.parse(raw) as { clientId?: unknown }
    if (typeof parsed.clientId === 'string' && parsed.clientId.trim()) {
      return parsed.clientId.trim()
    }
  } catch {
    /* no config file / unreadable — treated as unconfigured */
  }
  return null
}

/** env → userData file → shipped default. Shared so the rule exists once. */
function resolveClientId(
  userDataDir: string,
  envKey: string,
  configFile: string,
  provider: OAuthProvider,
): string | null {
  return pickClientId(
    process.env[envKey],
    readClientIdFile(userDataDir, configFile),
    SHIPPED_CLIENT_ID[provider],
  )
}

export function resolveGoogleClientId(userDataDir: string): string | null {
  return resolveClientId(userDataDir, 'GOOGLE_OAUTH_CLIENT_ID', CONFIG_FILE, 'google')
}

/** True when a Google client id is configured (drives the UI's "sign in" affordance). */
export function isGoogleOAuthConfigured(userDataDir: string): boolean {
  return resolveGoogleClientId(userDataDir) !== null
}

/**
 * Resolves the Microsoft (Entra) OAuth *client id* — the Application (client) ID
 * from an Azure app registration. Same three tiers as Google:
 *   1. process.env.MICROSOFT_OAUTH_CLIENT_ID
 *   2. <userData>/microsoft-oauth.json  →  { "clientId": "…" }
 *   3. SHIPPED_CLIENT_ID.microsoft
 *
 * Note the registration is not tied to a mailbox: a client id identifies the
 * APPLICATION, so one registration whose supported account types include
 * personal Microsoft accounts serves every user's Outlook/Hotmail address.
 */
export function resolveMicrosoftClientId(userDataDir: string): string | null {
  return resolveClientId(userDataDir, 'MICROSOFT_OAUTH_CLIENT_ID', MS_CONFIG_FILE, 'microsoft')
}

/** True when a Microsoft client id is configured (drives the UI's "sign in" affordance). */
export function isMicrosoftOAuthConfigured(userDataDir: string): boolean {
  return resolveMicrosoftClientId(userDataDir) !== null
}

/**
 * Persist a client id so the user never has to hand-create a JSON file.
 *
 * The original design only READ the id (env var, or a file the user was told to
 * create in a hidden userData folder). That is a fine mechanism and a poor
 * experience: the app's own error message asked people to go and write JSON
 * somewhere they cannot see. This is the same file, written for them.
 *
 * Still no secret involved — an installed-app client id is public and the PKCE
 * flow has no client secret — so a plain 0600 file in userData is appropriate.
 *
 * A saved id beats the shipped default, so this stays useful even once we ship
 * one: it is how a user points the app at their own registration.
 */

const FILE_FOR: Record<OAuthProvider, string> = {
  google: CONFIG_FILE,
  microsoft: MS_CONFIG_FILE,
}

/** Rough shape check so an obvious paste error fails here, not mid-flow. */
export function looksLikeClientId(provider: OAuthProvider, id: string): boolean {
  const v = id.trim()
  if (!v) return false
  if (provider === 'google') return /\.apps\.googleusercontent\.com$/.test(v)
  // Microsoft/Entra application ids are GUIDs.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

export function saveClientId(userDataDir: string, provider: OAuthProvider, clientId: string): void {
  const file = path.join(userDataDir, FILE_FOR[provider])
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ clientId: clientId.trim() }, null, 2), { encoding: 'utf-8', mode: 0o600 })
}
