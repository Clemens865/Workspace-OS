/**
 * CONNECTIONS — one shape over everything the workspace is signed into.
 *
 * A connection lived in one of four places: the MCP vault, Connected Accounts
 * (browser sessions), and the mail / calendar / drive account stores. Nobody
 * could see at a glance what the workspace is signed into, and nothing said
 * when a session had quietly died. This module presents all of them as one
 * roster with a status that is COMPUTED, not stored.
 *
 * Three states the person acts on, plus one for "never set up":
 *   connected     – works right now (a probe said so, or nothing can go stale)
 *   needs-signin  – it used to work; a refresh or the session probe failed
 *   setup         – nothing to refresh yet: no key, no OAuth record, no client id
 *   off           – present but switched off (MCP connectors only)
 *
 * Pure: the handler gathers the probe results and hands them in; this file
 * decides what they mean. No Electron, no I/O, fully unit-tested.
 */

export type ConnectionKind = 'token' | 'oauth' | 'browser' | 'account'
export type ConnectionStatus = 'connected' | 'needs-signin' | 'setup' | 'off'
export type ConnectionGroup = 'services' | 'accounts' | 'sites'

/** A probe's verdict. `skip` = nothing to verify (a password we cannot test without a full login). */
export type Probe = 'ok' | 'fail' | 'unconfigured' | 'skip'

export interface ConnectionSecretView {
  envVar: string
  label: string
  hint: string
  stored: boolean
}

export type ConnectionSource =
  | { type: 'mcp'; connectorId: string; remote: boolean; enabled: boolean; secrets: ConnectionSecretView[] }
  | { type: 'site'; domain: string }
  | { type: 'mail'; accountId: string }
  | { type: 'calendar'; sourceId: string }
  | { type: 'drive' }

export interface Connection {
  id: string
  name: string
  kind: ConnectionKind
  /** The honest mechanism, in words: "key · keychain", "oauth · system browser", "browser session". */
  how: string
  /** What an agent can do with it, in plain words. */
  gives: string
  status: ConnectionStatus
  /** One short line: the address, the domain, or why it is not connected. */
  detail: string
  group: ConnectionGroup
  source: ConnectionSource
  checkedAt: number
}

export interface ConnectionInputs {
  now: number
  mcp: {
    id: string
    displayName: string
    description: string
    remote: boolean
    enabled: boolean
    secrets: ConnectionSecretView[]
    /** Remote connectors only: no record / record stored and probe ok / probe failed. */
    oauth: 'none' | 'ok' | 'fail'
  }[]
  sites: { domain: string; label: string; session: boolean }[]
  mail: {
    id: string
    displayName: string
    user: string
    authKind: 'basic' | 'xoauth2' | 'demo'
    provider?: 'google' | 'microsoft'
    probe: Probe
  }[]
  calendar: { id: string; displayName: string; kind: 'caldav' | 'ics' | 'google' | 'microsoft'; probe: Probe }[]
  drive: { email: string; probe: Probe } | null
  /** Whether a Google OAuth client id exists in this build; without one every Google path is "set up". */
  googleConfigured: boolean
}

const OAUTH = 'oauth · system browser'
const KEYCHAIN_PASSWORD = 'password · keychain'

function providerName(p: 'google' | 'microsoft' | undefined): string {
  return p === 'microsoft' ? 'Microsoft 365' : 'Google'
}

function fromProbe(probe: Probe, needsSetup: string, failed: string): { status: ConnectionStatus; detail: string } {
  if (probe === 'ok' || probe === 'skip') return { status: 'connected', detail: '' }
  if (probe === 'unconfigured') return { status: 'setup', detail: needsSetup }
  return { status: 'needs-signin', detail: failed }
}

export function buildConnections(input: ConnectionInputs): Connection[] {
  const out: Connection[] = []
  const at = input.now

  for (const c of input.mcp) {
    const source: ConnectionSource = {
      type: 'mcp',
      connectorId: c.id,
      remote: c.remote,
      enabled: c.enabled,
      secrets: c.secrets,
    }
    let status: ConnectionStatus
    let detail = ''
    if (c.remote) {
      if (!c.enabled) {
        status = 'off'
        detail = c.oauth === 'none' ? '' : 'connection kept'
      } else if (c.oauth === 'ok') status = 'connected'
      else if (c.oauth === 'fail') {
        status = 'needs-signin'
        detail = 'the sign-in could not be renewed'
      } else {
        status = 'setup'
        detail = 'not connected yet'
      }
    } else {
      const missing = c.secrets.filter((s) => !s.stored)
      if (!c.enabled) {
        status = 'off'
        detail = c.secrets.length > 0 && missing.length === 0 ? 'key stored' : ''
      } else if (missing.length === 0) status = 'connected'
      else {
        status = 'setup'
        detail = missing.length === 1 ? `needs ${missing[0].label}` : `needs ${missing.length} keys`
      }
    }
    out.push({
      id: `mcp:${c.id}`,
      name: c.displayName,
      kind: c.remote ? 'oauth' : 'token',
      how: c.remote ? OAUTH : c.secrets.length === 0 ? 'no key needed' : 'key · keychain',
      gives: c.description,
      status,
      detail,
      group: 'services',
      source,
      checkedAt: at,
    })
  }

  for (const m of input.mail) {
    const isOAuth = m.authKind === 'xoauth2'
    const who = providerName(m.provider)
    const r = isOAuth
      ? fromProbe(m.probe, `${who} sign-in needs a client id`, `${who} would not renew the sign-in`)
      : { status: 'connected' as ConnectionStatus, detail: m.authKind === 'demo' ? 'demo account' : '' }
    out.push({
      id: `mail:${m.id}`,
      name: isOAuth ? `${who} · Mail` : m.displayName || 'Mail',
      kind: 'account',
      how: isOAuth ? OAUTH : m.authKind === 'demo' ? 'built-in demo' : KEYCHAIN_PASSWORD,
      gives: `Read and send mail as ${m.user}`,
      status: r.status,
      detail: r.detail || m.user,
      group: 'accounts',
      source: { type: 'mail', accountId: m.id },
      checkedAt: at,
    })
  }

  for (const s of input.calendar) {
    const isOAuth = s.kind === 'google' || s.kind === 'microsoft'
    const who = providerName(s.kind === 'google' || s.kind === 'microsoft' ? s.kind : undefined)
    const r = isOAuth
      ? fromProbe(s.probe, `${who} sign-in needs a client id`, `${who} would not renew the sign-in`)
      : { status: 'connected' as ConnectionStatus, detail: '' }
    out.push({
      id: `calendar:${s.id}`,
      name: isOAuth ? `${who} · Calendar` : s.displayName || 'Calendar',
      kind: 'account',
      how: isOAuth ? OAUTH : s.kind === 'ics' ? 'public feed' : KEYCHAIN_PASSWORD,
      gives: `Read ${s.displayName || 'this calendar'}; agents see your day`,
      status: r.status,
      detail: r.detail || s.displayName,
      group: 'accounts',
      source: { type: 'calendar', sourceId: s.id },
      checkedAt: at,
    })
  }

  // Drive is one row whether or not it is connected: it is the one Google
  // path with its own Set up / Connect action, so it must be visible to reach.
  {
    let status: ConnectionStatus
    let detail: string
    if (!input.googleConfigured) {
      status = 'setup'
      detail = 'needs a Google client id'
    } else if (!input.drive) {
      status = 'setup'
      detail = 'not connected yet'
    } else {
      const r = fromProbe(input.drive.probe, 'needs a Google client id', 'Google would not renew the sign-in')
      status = r.status
      detail = r.detail || input.drive.email
    }
    out.push({
      id: 'drive',
      name: 'Google Drive',
      kind: 'account',
      how: OAUTH,
      gives: 'Open and save Drive files in the canvas',
      status,
      detail,
      group: 'accounts',
      source: { type: 'drive' },
      checkedAt: at,
    })
  }

  for (const s of input.sites) {
    out.push({
      id: `site:${s.domain}`,
      name: s.label,
      kind: 'browser',
      how: 'browser session',
      gives: 'Agents work here signed in as you',
      status: s.session ? 'connected' : 'needs-signin',
      detail: s.session ? s.domain : `no session for ${s.domain}`,
      group: 'sites',
      source: { type: 'site', domain: s.domain },
      checkedAt: at,
    })
  }

  return out.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name))
}

const STATUS_ORDER: Record<ConnectionStatus, number> = { 'needs-signin': 0, connected: 1, setup: 2, off: 3 }

/** The one plain line above the roster. */
export function connectionsStatus(list: Connection[]): string {
  if (list.length === 0) return 'Nothing is connected yet.'
  const warm = list.filter((c) => c.status === 'needs-signin').length
  const on = list.filter((c) => c.status === 'connected').length
  const parts: string[] = []
  parts.push(`${on} connected`)
  if (warm > 0) parts.push(`${warm} need${warm === 1 ? 's' : ''} you to sign in again`)
  else parts.push('nothing needs you')
  return parts.join(' · ') + '.'
}

/** The sentence Stream shows for a connection that needs the person. */
export function connectionLine(c: Connection): string {
  return c.status === 'needs-signin' ? `${c.name} needs you to sign in again` : ''
}
