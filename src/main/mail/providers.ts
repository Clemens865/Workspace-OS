/**
 * Static provider table + a pure `lookupProvider(email)` for one-click account
 * setup. Given an email address we resolve the IMAP/SMTP host/port/security and
 * an auth note (app-specific password required? OAuth available?) so the Add
 * Account dialog can fill every server field and show the right hint.
 *
 * This module is DELIBERATELY pure and I/O-free — it is exhaustively unit-tested
 * and never touches the network. Unknown domains fall back to a documented
 * heuristic (imap.<domain>:993 / smtp.<domain>:587) flagged `guessed: true`.
 *
 * SECURITY: nothing here handles secrets. It maps a public domain to public
 * connection metadata only.
 */

/** Transport security for one server leg. */
export type MailSecurity =
  | 'ssl' // implicit TLS on connect (IMAP 993, SMTP 465)
  | 'starttls' // plaintext connect upgraded via STARTTLS (SMTP 587/25)

/** One server leg (IMAP or SMTP). */
export interface ProviderServer {
  host: string
  port: number
  security: MailSecurity
}

/** A resolved provider: both server legs + human/auth guidance. */
export interface ProviderInfo {
  /** Stable id (also the UI preset key). */
  id: string
  /** Display label for the preset button / hint. */
  label: string
  imap: ProviderServer
  smtp: ProviderServer
  /** True when the login must be an app-specific password (2FA accounts). */
  appPasswordRequired: boolean
  /** True when an OAuth sign-in path exists for this provider (Gmail today). */
  supportsOAuth: boolean
  /** Short, human sentence shown under the password field. Never a secret. */
  authNote: string
  /** True when this came from the heuristic, NOT the curated table. */
  guessed: boolean
}

/** A curated table entry (before the id/label/guessed decoration). */
interface ProviderDef {
  id: string
  label: string
  /** Domains that map to this provider (lowercased). */
  domains: string[]
  imap: ProviderServer
  smtp: ProviderServer
  appPasswordRequired: boolean
  supportsOAuth: boolean
  authNote: string
}

const ssl = (host: string, port: number): ProviderServer => ({ host, port, security: 'ssl' })
const starttls = (host: string, port: number): ProviderServer => ({ host, port, security: 'starttls' })

/**
 * The curated provider table. Ports/security reflect each provider's documented
 * settings as of 2026: IMAP 993 implicit TLS is universal here; SMTP is either
 * 465 (implicit TLS) or 587 (STARTTLS) — the distinction the send path depends on.
 */
const TABLE: ProviderDef[] = [
  {
    id: 'gmail',
    label: 'Gmail',
    domains: ['gmail.com', 'googlemail.com'],
    imap: ssl('imap.gmail.com', 993),
    smtp: ssl('smtp.gmail.com', 465),
    appPasswordRequired: true,
    supportsOAuth: true,
    authNote:
      'Gmail requires an App Password (not your normal password), or sign in with Google below.',
  },
  {
    id: 'icloud',
    label: 'iCloud',
    domains: ['icloud.com', 'me.com', 'mac.com'],
    imap: ssl('imap.mail.me.com', 993),
    smtp: starttls('smtp.mail.me.com', 587),
    appPasswordRequired: true,
    supportsOAuth: false,
    authNote:
      'iCloud Mail requires an app-specific password. Create one at appleid.apple.com → Sign-In and Security → App-Specific Passwords.',
  },
  {
    id: 'outlook',
    label: 'Outlook',
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'office365.com', 'hotmail.co.uk', 'live.co.uk'],
    imap: ssl('outlook.office365.com', 993),
    smtp: starttls('smtp-mail.outlook.com', 587),
    appPasswordRequired: false,
    supportsOAuth: true,
    authNote:
      'Outlook / Hotmail / Live now require “Sign in with Microsoft” below — Microsoft disabled password and app-password sign-in for IMAP/SMTP in 2024.',
  },
  {
    id: 'yahoo',
    label: 'Yahoo',
    domains: ['yahoo.com', 'yahoo.co.uk', 'ymail.com', 'rocketmail.com'],
    imap: ssl('imap.mail.yahoo.com', 993),
    smtp: ssl('smtp.mail.yahoo.com', 465),
    appPasswordRequired: true,
    supportsOAuth: false,
    authNote:
      'Yahoo Mail requires an app password. Generate one at Yahoo Account Security → Generate app password.',
  },
  {
    id: 'aol',
    label: 'AOL',
    domains: ['aol.com'],
    imap: ssl('imap.aol.com', 993),
    smtp: ssl('smtp.aol.com', 465),
    appPasswordRequired: true,
    supportsOAuth: false,
    authNote:
      'AOL Mail requires an app password (AOL Account Security → Generate app password).',
  },
  {
    id: 'fastmail',
    label: 'Fastmail',
    domains: ['fastmail.com', 'fastmail.fm', 'messagingengine.com'],
    imap: ssl('imap.fastmail.com', 993),
    smtp: ssl('smtp.fastmail.com', 465),
    appPasswordRequired: true,
    supportsOAuth: false,
    authNote:
      'Fastmail requires an app password (Settings → Privacy & Security → App Passwords).',
  },
  {
    id: 'gmx',
    label: 'GMX',
    domains: ['gmx.com', 'gmx.net', 'gmx.de', 'gmx.at', 'gmx.ch'],
    imap: ssl('imap.gmx.com', 993),
    smtp: ssl('mail.gmx.com', 465),
    appPasswordRequired: false,
    supportsOAuth: false,
    authNote:
      'GMX requires IMAP/POP access to be enabled first (GMX settings → POP3/IMAP). Then use your normal password.',
  },
  {
    id: 'zoho',
    label: 'Zoho',
    domains: ['zoho.com', 'zohomail.com', 'zoho.eu'],
    imap: ssl('imap.zoho.com', 993),
    smtp: ssl('smtp.zoho.com', 465),
    appPasswordRequired: false,
    supportsOAuth: false,
    authNote:
      'Zoho Mail: if 2FA is on, generate an app-specific password (Zoho Account → Security → App Passwords); otherwise use your normal password.',
  },
]

/** Lowercase the domain part of an email; '' when there is no usable domain. */
function domainOf(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 0) return ''
  return email.slice(at + 1).trim().toLowerCase()
}

/** Decorate a curated def into the public ProviderInfo (guessed: false). */
function toInfo(def: ProviderDef): ProviderInfo {
  return {
    id: def.id,
    label: def.label,
    imap: { ...def.imap },
    smtp: { ...def.smtp },
    appPasswordRequired: def.appPasswordRequired,
    supportsOAuth: def.supportsOAuth,
    authNote: def.authNote,
    guessed: false,
  }
}

/** The curated presets, in display order, for the dialog's preset row. */
export function listProviderPresets(): ProviderInfo[] {
  return TABLE.map(toInfo)
}

/** Look up a curated provider by its stable id (preset-button click). */
export function providerById(id: string): ProviderInfo | null {
  const def = TABLE.find((d) => d.id === id)
  return def ? toInfo(def) : null
}

/**
 * Resolve an email address to a provider. Returns a curated entry when the
 * domain (or one of its aliases) is known; otherwise a heuristic guess
 * (imap.<domain>:993 SSL / smtp.<domain>:587 STARTTLS) flagged `guessed: true`.
 * Returns null only when the input has no usable domain.
 */
export function lookupProvider(email: string): ProviderInfo | null {
  const domain = domainOf(email)
  if (!domain || !domain.includes('.')) return null

  for (const def of TABLE) {
    if (def.domains.includes(domain)) return toInfo(def)
  }

  // Unknown domain → documented heuristic. IMAP implicit-TLS on 993 is the near
  // universal default; SMTP submission on 587 with STARTTLS is the safer guess
  // (many hosts don't listen on 465). Flagged so the UI can say "please verify".
  return {
    id: 'guess',
    label: domain,
    imap: ssl(`imap.${domain}`, 993),
    smtp: starttls(`smtp.${domain}`, 587),
    appPasswordRequired: false,
    supportsOAuth: false,
    authNote:
      'We guessed these servers from your domain — please verify the host/port with your provider. If 2-factor auth is on, you may need an app-specific password.',
    guessed: true,
  }
}
