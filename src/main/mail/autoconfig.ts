import { lookupProvider, type ProviderInfo, type MailSecurity } from './providers'

/**
 * Email-domain autoconfig resolver.
 *
 * Resolution order for an email address:
 *  1. The curated provider TABLE (`lookupProvider`) — instant, offline, exact.
 *  2. Mozilla's ISPDB (autoconfig.thunderbird.net) for unknown domains — parsed
 *     from its small XML document.
 *  3. The documented heuristic guess (imap.<domain>:993 / smtp.<domain>:587).
 *
 * `fetchFn` is INJECTED so tests drive a fixture and this module never hits the
 * network under test. Any ISPDB failure (non-200, throw, unparseable) silently
 * falls back to the heuristic — autoconfig is a convenience, never a hard dep.
 *
 * SECURITY: no secrets. We fetch a public XML doc describing public servers.
 */

/** The narrow fetch surface we depend on (matches the global `fetch`). */
export type AutoconfigFetch = (url: string) => Promise<{
  ok: boolean
  status: number
  text(): Promise<string>
}>

/** Where the resolved settings came from — surfaced to the UI for a "verify" hint. */
export type AutoconfigSource = 'table' | 'ispdb' | 'guess'

export interface AutoconfigResult {
  provider: ProviderInfo
  source: AutoconfigSource
}

const ISPDB_BASE = 'https://autoconfig.thunderbird.net/v1.1/'

/** Lowercased domain of an email, or '' when there is none. */
function domainOf(email: string): string {
  const at = email.lastIndexOf('@')
  return at < 0 ? '' : email.slice(at + 1).trim().toLowerCase()
}

/**
 * Resolve autoconfig for an email address. Never throws — returns null only when
 * the address has no usable domain.
 */
export async function resolveAutoconfig(
  email: string,
  fetchFn: AutoconfigFetch,
): Promise<AutoconfigResult | null> {
  const domain = domainOf(email)
  if (!domain || !domain.includes('.')) return null

  // 1) Curated table wins — it's exact and carries our auth notes.
  const table = lookupProvider(email)
  if (table && !table.guessed) return { provider: table, source: 'table' }

  // 2) Try ISPDB for the unknown domain.
  try {
    const res = await fetchFn(`${ISPDB_BASE}${encodeURIComponent(domain)}`)
    if (res.ok && res.status === 200) {
      const xml = await res.text()
      const parsed = parseIspdb(xml, domain)
      if (parsed) return { provider: parsed, source: 'ispdb' }
    }
  } catch {
    /* fall through to the heuristic */
  }

  // 3) Heuristic guess (table is the guessed ProviderInfo when domain unknown).
  return table ? { provider: table, source: 'guess' } : null
}

/** One `<incomingServer>`/`<outgoingServer>` block extracted from ISPDB XML. */
interface IspdbServer {
  type: string // 'imap' | 'pop3' | 'smtp'
  host: string
  port: number
  socketType: string // 'SSL' | 'STARTTLS' | 'plain'
}

/**
 * Minimal, dependency-free parser for the ISPDB `clientConfig` XML. We only need
 * the first usable IMAP incoming server and the SMTP outgoing server. Regex is
 * sufficient (and safe) for this fixed, small, trusted document shape — we never
 * evaluate it, only read three fields per server block.
 */
export function parseIspdb(xml: string, domain: string): ProviderInfo | null {
  const incoming = extractServers(xml, 'incomingServer')
  const outgoing = extractServers(xml, 'outgoingServer')

  const imap = incoming.find((s) => s.type === 'imap')
  const smtp = outgoing.find((s) => s.type === 'smtp')
  if (!imap || !smtp) return null

  return {
    id: 'ispdb',
    label: domain,
    imap: { host: imap.host, port: imap.port, security: toSecurity(imap.socketType) },
    smtp: { host: smtp.host, port: smtp.port, security: toSecurity(smtp.socketType) },
    appPasswordRequired: false,
    supportsOAuth: false,
    authNote:
      'Settings were fetched from Mozilla’s public autoconfig database — please verify them. If your account uses 2-factor auth you may need an app-specific password.',
    guessed: false,
  }
}

/** Map an ISPDB socketType to our MailSecurity (defaults to STARTTLS if odd). */
function toSecurity(socketType: string): MailSecurity {
  return socketType.trim().toUpperCase() === 'SSL' ? 'ssl' : 'starttls'
}

/** Extract every `<incomingServer|outgoingServer …>…</…>` block's fields. */
function extractServers(xml: string, tag: string): IspdbServer[] {
  const out: IspdbServer[] = []
  const blockRe = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi')
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(xml)) !== null) {
    const block = m[0]
    const type = attr(m[0], 'type') || tagText(block, 'type')
    const host = tagText(block, 'hostname')
    const port = Number(tagText(block, 'port'))
    const socketType = tagText(block, 'socketType')
    if (host && Number.isInteger(port)) out.push({ type: type.toLowerCase(), host, port, socketType })
  }
  return out
}

/** Read an attribute value from an opening tag, e.g. type="imap". */
function attr(fragment: string, name: string): string {
  const m = new RegExp(`${name}="([^"]*)"`, 'i').exec(fragment)
  return m ? m[1].trim() : ''
}

/** Read the text of the first `<name>…</name>` child inside a block. */
function tagText(block: string, name: string): string {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(block)
  return m ? m[1].trim() : ''
}
