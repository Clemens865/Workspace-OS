import fs from 'fs'
import path from 'path'

/**
 * Connected Accounts — the user signs into a website ONCE by hand in the in-app
 * browser (on the persistent `persist:wos-browser` session), and we record that
 * they've connected it so it's visible + revocable. The tab-driving agent then
 * inherits the authenticated session automatically (shared partition).
 *
 * SECURITY: we NEVER see, store, autofill, or log a password/credential. The
 * login happens on the real site's own form; the session lives as cookies in the
 * encrypted persistent partition (managed by Electron, not us). This store
 * persists ONLY non-secret intent: { domain, label, addedAt }. Nothing secret
 * ever reaches this file.
 *
 * Pure of Electron — takes its userData dir by injection so it is unit-testable
 * against a temp dir (no `session`/`app` import here). The `hasSession` liveness
 * check lives in the handler, which owns the Electron `session`.
 */

/** A recorded connected account. NOTHING here is secret. */
export interface ConnectedAccount {
  /** Bare host, lowercased, no scheme/path/port (e.g. "linkedin.com"). */
  domain: string
  /** Human label shown on the card (e.g. "LinkedIn"). Derived. */
  label: string
  /** ISO timestamp the account was added. */
  addedAt: string
}

const DOMAIN_MAX = 253 // RFC 1035 max hostname length
const LABEL_MAX = 80

/**
 * Normalize a user-typed site into a bare domain. Accepts "linkedin.com",
 * "https://www.linkedin.com/login", "LinkedIn.com/", etc. Returns null for
 * anything that isn't a plausible http(s) web host — no `file:`/`javascript:`,
 * no path traversal, no localhost-with-nothing, no bare junk.
 */
export function normalizeDomain(input: unknown): string | null {
  if (typeof input !== 'string') return null
  let s = input.trim().toLowerCase()
  if (!s) return null
  // Reject non-http(s) schemes outright (file:, javascript:, data:, …).
  const schemeMatch = s.match(/^([a-z][a-z0-9+.-]*):\/\//)
  if (schemeMatch && schemeMatch[1] !== 'http' && schemeMatch[1] !== 'https') return null
  // Add a scheme so the URL parser can extract the host cleanly.
  if (!/^https?:\/\//.test(s)) s = 'https://' + s
  let host: string
  try {
    host = new URL(s).hostname
  } catch {
    return null
  }
  if (!host) return null
  // Strip a leading www. — one account per site, not per subdomain-of-www.
  host = host.replace(/^www\./, '')
  if (host.length === 0 || host.length > DOMAIN_MAX) return null
  // Only DNS-safe characters (spaces/slashes/traversal don't survive URL parsing,
  // but we guard explicitly). Must contain a dot (a TLD), no leading/trailing dot.
  if (!/^[a-z0-9.-]+$/.test(host)) return null
  if (!host.includes('.')) return null
  if (host.startsWith('.') || host.endsWith('.') || host.includes('..')) return null
  return host
}

/** A friendly default label from a domain: "linkedin.com" → "LinkedIn". */
export function labelForDomain(domain: string): string {
  const first = domain.split('.')[0] ?? domain
  if (!first) return domain
  return first.charAt(0).toUpperCase() + first.slice(1)
}

function isAccount(v: unknown): v is ConnectedAccount {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.domain === 'string' && typeof o.label === 'string' && typeof o.addedAt === 'string'
}

/**
 * The persisted store of connected-account entries. One JSON file
 * (`connected-accounts.json`) in userData, holding an array of the non-secret
 * entries above. Corrupt/partial files degrade to an empty list rather than
 * throwing — a broken file can never break the app.
 */
export class AccountsStore {
  private readonly file: string
  private accounts: ConnectedAccount[] | null = null

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, 'connected-accounts.json')
  }

  private load(): ConnectedAccount[] {
    if (this.accounts) return this.accounts
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.accounts) ? parsed.accounts : []
      this.accounts = (list as unknown[]).filter(isAccount)
    } catch {
      this.accounts = []
    }
    return this.accounts
  }

  private persist(): void {
    const dir = path.dirname(this.file)
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.accounts ?? [], null, 2), 'utf8')
    } catch {
      /* best-effort — a write failure must never crash the app */
    }
  }

  /** All recorded entries (non-secret), newest first. */
  list(): ConnectedAccount[] {
    return [...this.load()].sort((a, b) => b.addedAt.localeCompare(a.addedAt))
  }

  /**
   * Record intent to connect a site. Does NOT log in — just persists the entry.
   * Idempotent per domain (re-adding refreshes the label, keeps addedAt). Returns
   * the stored entry, or null if the input isn't a valid web domain.
   */
  add(input: unknown): ConnectedAccount | null {
    const domain = normalizeDomain(input)
    if (!domain) return null
    const list = this.load()
    const existing = list.find((a) => a.domain === domain)
    if (existing) {
      existing.label = labelForDomain(domain).slice(0, LABEL_MAX)
      this.persist()
      return existing
    }
    const entry: ConnectedAccount = {
      domain,
      label: labelForDomain(domain).slice(0, LABEL_MAX),
      addedAt: new Date().toISOString(),
    }
    list.push(entry)
    this.persist()
    return entry
  }

  /** Remove a domain's entry (used on "Sign out"). Returns true if one existed. */
  remove(input: unknown): boolean {
    const domain = normalizeDomain(input)
    if (!domain) return false
    const list = this.load()
    const next = list.filter((a) => a.domain !== domain)
    if (next.length === list.length) return false
    this.accounts = next
    this.persist()
    return true
  }
}
