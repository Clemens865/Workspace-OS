import { describe, it, expect, vi } from 'vitest'
import { resolveAutoconfig, parseIspdb, type AutoconfigFetch } from './autoconfig'

/**
 * Autoconfig resolution: curated table → Mozilla ISPDB → heuristic guess. The
 * fetch is INJECTED so no network is touched: a fixture XML proves ISPDB parsing,
 * and a 404 / thrown fetch proves the silent fall-through to the guess. No
 * secrets appear anywhere (we resolve public server metadata only).
 */

// A trimmed but realistic ISPDB clientConfig document (public server metadata).
const ISPDB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<clientConfig version="1.1">
  <emailProvider id="example.org">
    <domain>example.org</domain>
    <displayName>Example Mail</displayName>
    <incomingServer type="imap">
      <hostname>imap.example.org</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>smtp.example.org</hostname>
      <port>587</port>
      <socketType>STARTTLS</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </outgoingServer>
  </emailProvider>
</clientConfig>`

const okFetch = (xml: string): AutoconfigFetch =>
  vi.fn(async () => ({ ok: true, status: 200, text: async () => xml }))

describe('resolveAutoconfig — table wins first', () => {
  it('resolves a curated provider WITHOUT fetching', async () => {
    const fetchFn = vi.fn() as unknown as AutoconfigFetch
    const res = await resolveAutoconfig('alice@gmail.com', fetchFn)
    expect(res).not.toBeNull()
    expect(res!.source).toBe('table')
    expect(res!.provider.id).toBe('gmail')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('resolveAutoconfig — ISPDB fixture (unknown domain)', () => {
  it('parses IMAP/SMTP settings from the ISPDB XML', async () => {
    const res = await resolveAutoconfig('user@example.org', okFetch(ISPDB_XML))
    expect(res).not.toBeNull()
    expect(res!.source).toBe('ispdb')
    expect(res!.provider.imap).toEqual({ host: 'imap.example.org', port: 993, security: 'ssl' })
    expect(res!.provider.smtp).toEqual({ host: 'smtp.example.org', port: 587, security: 'starttls' })
  })

  it('hits the domain-specific ISPDB URL', async () => {
    const fetchFn = okFetch(ISPDB_XML)
    await resolveAutoconfig('user@example.org', fetchFn)
    const url = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain('autoconfig.thunderbird.net/v1.1/example.org')
  })
})

describe('resolveAutoconfig — fallback to heuristic guess', () => {
  it('falls back to the guess on a 404', async () => {
    const fetchFn: AutoconfigFetch = vi.fn(async () => ({ ok: false, status: 404, text: async () => '' }))
    const res = await resolveAutoconfig('user@unknown-domain.example', fetchFn)
    expect(res!.source).toBe('guess')
    expect(res!.provider.guessed).toBe(true)
    expect(res!.provider.imap).toEqual({ host: 'imap.unknown-domain.example', port: 993, security: 'ssl' })
    expect(res!.provider.smtp).toEqual({ host: 'smtp.unknown-domain.example', port: 587, security: 'starttls' })
  })

  it('falls back to the guess when fetch throws', async () => {
    const fetchFn: AutoconfigFetch = vi.fn(async () => { throw new Error('network down') })
    const res = await resolveAutoconfig('user@unknown-domain.example', fetchFn)
    expect(res!.source).toBe('guess')
  })

  it('falls back to the guess when the XML is unparseable', async () => {
    const res = await resolveAutoconfig('user@unknown-domain.example', okFetch('<not-a-config/>'))
    expect(res!.source).toBe('guess')
  })

  it('returns null for input without a usable domain', async () => {
    expect(await resolveAutoconfig('bogus', okFetch(ISPDB_XML))).toBeNull()
  })
})

describe('parseIspdb — direct', () => {
  it('returns null when a required server block is missing', () => {
    const onlyImap = ISPDB_XML.replace(/<outgoingServer[\s\S]*?<\/outgoingServer>/i, '')
    expect(parseIspdb(onlyImap, 'example.org')).toBeNull()
  })

  it('defaults an odd socketType to STARTTLS', () => {
    const weird = ISPDB_XML.replace('<socketType>SSL</socketType>', '<socketType>plain</socketType>')
    const p = parseIspdb(weird, 'example.org')!
    expect(p.imap.security).toBe('starttls')
  })
})
