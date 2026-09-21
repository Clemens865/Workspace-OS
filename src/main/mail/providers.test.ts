import { describe, it, expect } from 'vitest'
import { lookupProvider, providerById, listProviderPresets } from './providers'

/**
 * `lookupProvider` is the pure heart of one-click multi-provider setup: an email
 * address → the correct IMAP/SMTP host/port/security + an auth note. We assert
 * every curated provider (incl. domain aliases) and the heuristic guess for an
 * unknown domain. No network, no I/O — this table is exhaustively verifiable.
 */

describe('lookupProvider — curated providers', () => {
  it('resolves Gmail (app-pw + OAuth, SMTP 465 implicit TLS)', () => {
    const p = lookupProvider('alice@gmail.com')!
    expect(p.id).toBe('gmail')
    expect(p.imap).toEqual({ host: 'imap.gmail.com', port: 993, security: 'ssl' })
    expect(p.smtp).toEqual({ host: 'smtp.gmail.com', port: 465, security: 'ssl' })
    expect(p.appPasswordRequired).toBe(true)
    expect(p.supportsOAuth).toBe(true)
    expect(p.guessed).toBe(false)
    expect(p.authNote).toMatch(/app password/i)
  })

  it('maps the googlemail.com alias to Gmail', () => {
    expect(lookupProvider('bob@googlemail.com')!.id).toBe('gmail')
  })

  it('resolves iCloud (SMTP 587 STARTTLS, app-specific password required)', () => {
    const p = lookupProvider('me@icloud.com')!
    expect(p.id).toBe('icloud')
    expect(p.imap).toEqual({ host: 'imap.mail.me.com', port: 993, security: 'ssl' })
    expect(p.smtp).toEqual({ host: 'smtp.mail.me.com', port: 587, security: 'starttls' })
    expect(p.appPasswordRequired).toBe(true)
    expect(p.supportsOAuth).toBe(false)
    expect(p.authNote).toMatch(/app-specific password/i)
  })

  it('maps the me.com and mac.com aliases to iCloud', () => {
    expect(lookupProvider('a@me.com')!.id).toBe('icloud')
    expect(lookupProvider('a@mac.com')!.id).toBe('icloud')
  })

  it('resolves Outlook (SMTP 587 STARTTLS) and requires OAuth (basic auth disabled 2024)', () => {
    const p = lookupProvider('a@outlook.com')!
    expect(p.id).toBe('outlook')
    expect(p.imap).toEqual({ host: 'outlook.office365.com', port: 993, security: 'ssl' })
    expect(p.smtp).toEqual({ host: 'smtp-mail.outlook.com', port: 587, security: 'starttls' })
    expect(p.supportsOAuth).toBe(true)
  })

  it('maps the hotmail.com and live.com aliases to Outlook', () => {
    expect(lookupProvider('a@hotmail.com')!.id).toBe('outlook')
    expect(lookupProvider('a@live.com')!.id).toBe('outlook')
    expect(lookupProvider('a@msn.com')!.id).toBe('outlook')
  })

  it('resolves Yahoo (SMTP 465 implicit TLS, app-pw required)', () => {
    const p = lookupProvider('a@yahoo.com')!
    expect(p.id).toBe('yahoo')
    expect(p.imap).toEqual({ host: 'imap.mail.yahoo.com', port: 993, security: 'ssl' })
    expect(p.smtp).toEqual({ host: 'smtp.mail.yahoo.com', port: 465, security: 'ssl' })
    expect(p.appPasswordRequired).toBe(true)
  })

  it('resolves Fastmail (SMTP 465, app-pw)', () => {
    const p = lookupProvider('a@fastmail.com')!
    expect(p.id).toBe('fastmail')
    expect(p.imap).toEqual({ host: 'imap.fastmail.com', port: 993, security: 'ssl' })
    expect(p.smtp).toEqual({ host: 'smtp.fastmail.com', port: 465, security: 'ssl' })
  })

  it('resolves GMX', () => {
    const p = lookupProvider('a@gmx.net')!
    expect(p.id).toBe('gmx')
    expect(p.imap.host).toBe('imap.gmx.com')
    expect(p.smtp).toEqual({ host: 'mail.gmx.com', port: 465, security: 'ssl' })
  })

  it('resolves Zoho', () => {
    const p = lookupProvider('a@zoho.com')!
    expect(p.id).toBe('zoho')
    expect(p.imap.host).toBe('imap.zoho.com')
    expect(p.smtp.host).toBe('smtp.zoho.com')
  })

  it('resolves AOL', () => {
    const p = lookupProvider('a@aol.com')!
    expect(p.id).toBe('aol')
    expect(p.imap.host).toBe('imap.aol.com')
  })

  it('is case-insensitive on the domain', () => {
    expect(lookupProvider('Alice@GMAIL.COM')!.id).toBe('gmail')
  })
})

describe('lookupProvider — heuristic guess', () => {
  it('guesses imap.<domain>:993 SSL / smtp.<domain>:587 STARTTLS for an unknown domain', () => {
    const p = lookupProvider('someone@acme-corp.example')!
    expect(p.guessed).toBe(true)
    expect(p.id).toBe('guess')
    expect(p.imap).toEqual({ host: 'imap.acme-corp.example', port: 993, security: 'ssl' })
    expect(p.smtp).toEqual({ host: 'smtp.acme-corp.example', port: 587, security: 'starttls' })
    expect(p.authNote).toMatch(/guessed/i)
  })

  it('returns null for input without a usable domain', () => {
    expect(lookupProvider('not-an-email')).toBeNull()
    expect(lookupProvider('a@localhost')).toBeNull() // no dot in domain
    expect(lookupProvider('')).toBeNull()
  })
})

describe('providerById / listProviderPresets', () => {
  it('returns a curated provider by id', () => {
    expect(providerById('icloud')!.smtp.port).toBe(587)
    expect(providerById('nope')).toBeNull()
  })

  it('lists presets in table order, all non-guessed', () => {
    const presets = listProviderPresets()
    expect(presets.length).toBeGreaterThanOrEqual(8)
    expect(presets.every((p) => !p.guessed)).toBe(true)
    expect(presets[0].id).toBe('gmail')
  })
})
