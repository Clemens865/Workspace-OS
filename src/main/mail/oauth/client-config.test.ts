import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  resolveGoogleClientId,
  isGoogleOAuthConfigured,
  resolveMicrosoftClientId,
  isMicrosoftOAuthConfigured,
  saveClientId,
  looksLikeClientId,
  pickClientId,
  SHIPPED_CLIENT_ID,
} from './client-config'

/**
 * The client-id resolver, in three tiers: env var, else a <provider>-oauth.json
 * in userData, else the id we ship. No secret is involved — an installed-app
 * client id is public by design and carries no client secret.
 *
 * These tests are written against SHIPPED_CLIENT_ID rather than against `null`
 * on purpose: shipping an id is a one-constant change, and a suite that has to
 * be rewritten on that day would be testing the constant instead of the rule.
 * The rule itself is proven exhaustively on the pure `pickClientId`.
 */

describe('resolveGoogleClientId', () => {
  let dir: string
  const ENV_KEY = 'GOOGLE_OAUTH_CLIENT_ID'
  const original = process.env[ENV_KEY]

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-oauth-'))
    delete process.env[ENV_KEY]
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
    if (original === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = original
  })

  it('falls back to the shipped default when nothing is configured', () => {
    expect(resolveGoogleClientId(dir)).toBe(SHIPPED_CLIENT_ID.google)
    expect(isGoogleOAuthConfigured(dir)).toBe(SHIPPED_CLIENT_ID.google !== null)
  })

  it('reads the env var first (trimmed)', () => {
    process.env[ENV_KEY] = '  CID.apps.googleusercontent.com  '
    expect(resolveGoogleClientId(dir)).toBe('CID.apps.googleusercontent.com')
    expect(isGoogleOAuthConfigured(dir)).toBe(true)
  })

  it('falls back to google-oauth.json in userData', () => {
    fs.writeFileSync(path.join(dir, 'google-oauth.json'), JSON.stringify({ clientId: 'FILE.apps.googleusercontent.com' }))
    expect(resolveGoogleClientId(dir)).toBe('FILE.apps.googleusercontent.com')
  })

  it('env var takes precedence over the file', () => {
    process.env[ENV_KEY] = 'ENV.apps.googleusercontent.com'
    fs.writeFileSync(path.join(dir, 'google-oauth.json'), JSON.stringify({ clientId: 'FILE' }))
    expect(resolveGoogleClientId(dir)).toBe('ENV.apps.googleusercontent.com')
  })

  it('ignores a malformed config file rather than throwing', () => {
    fs.writeFileSync(path.join(dir, 'google-oauth.json'), 'not json {')
    expect(resolveGoogleClientId(dir)).toBe(SHIPPED_CLIENT_ID.google)
  })
})

describe('resolveMicrosoftClientId', () => {
  let dir: string
  const ENV_KEY = 'MICROSOFT_OAUTH_CLIENT_ID'
  const original = process.env[ENV_KEY]

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-ms-oauth-'))
    delete process.env[ENV_KEY]
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
    if (original === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = original
  })

  it('falls back to the shipped default when nothing is configured', () => {
    expect(resolveMicrosoftClientId(dir)).toBe(SHIPPED_CLIENT_ID.microsoft)
    expect(isMicrosoftOAuthConfigured(dir)).toBe(SHIPPED_CLIENT_ID.microsoft !== null)
  })

  it('reads the env var first (trimmed)', () => {
    process.env[ENV_KEY] = '  app-client-id-1234  '
    expect(resolveMicrosoftClientId(dir)).toBe('app-client-id-1234')
    expect(isMicrosoftOAuthConfigured(dir)).toBe(true)
  })

  it('falls back to microsoft-oauth.json in userData', () => {
    fs.writeFileSync(path.join(dir, 'microsoft-oauth.json'), JSON.stringify({ clientId: 'FILE-APP-ID' }))
    expect(resolveMicrosoftClientId(dir)).toBe('FILE-APP-ID')
  })

  it('env var takes precedence over the file', () => {
    process.env[ENV_KEY] = 'ENV-APP-ID'
    fs.writeFileSync(path.join(dir, 'microsoft-oauth.json'), JSON.stringify({ clientId: 'FILE' }))
    expect(resolveMicrosoftClientId(dir)).toBe('ENV-APP-ID')
  })

  it('does NOT read the Google config file (separate provider)', () => {
    fs.writeFileSync(path.join(dir, 'google-oauth.json'), JSON.stringify({ clientId: 'GID' }))
    expect(resolveMicrosoftClientId(dir)).toBe(SHIPPED_CLIENT_ID.microsoft)
  })

  it('ignores a malformed config file rather than throwing', () => {
    fs.writeFileSync(path.join(dir, 'microsoft-oauth.json'), 'not json {')
    expect(resolveMicrosoftClientId(dir)).toBe(SHIPPED_CLIENT_ID.microsoft)
  })
})

/* --- WOS: the three-tier precedence rule, proven independently of what we ship --- */

describe('pickClientId', () => {
  const ENV = 'ENV-ID'
  const FILE = 'FILE-ID'
  const SHIPPED = 'SHIPPED-ID'

  it('prefers the env var over everything', () => {
    expect(pickClientId(ENV, FILE, SHIPPED)).toBe(ENV)
  })

  it('prefers a per-user saved id over the shipped default', () => {
    expect(pickClientId(undefined, FILE, SHIPPED)).toBe(FILE)
  })

  it('falls back to the shipped default when the user set nothing', () => {
    expect(pickClientId(undefined, null, SHIPPED)).toBe(SHIPPED)
  })

  it('is null only when no tier supplies one', () => {
    expect(pickClientId(undefined, null, null)).toBeNull()
  })

  it('treats blank at any tier as absent, so an empty override cannot blank out the shipped id', () => {
    expect(pickClientId('   ', null, SHIPPED)).toBe(SHIPPED)
    expect(pickClientId(undefined, '   ', SHIPPED)).toBe(SHIPPED)
    expect(pickClientId('', '', '')).toBeNull()
  })

  it('trims each tier', () => {
    expect(pickClientId(`  ${ENV}\n`, null, null)).toBe(ENV)
    expect(pickClientId(undefined, `  ${FILE}  `, null)).toBe(FILE)
    expect(pickClientId(undefined, null, ` ${SHIPPED} `)).toBe(SHIPPED)
  })
})

/* --- WOS: paste-a-client-id path (saveClientId + validation) --- */

const GUID = '11111111-2222-3333-4444-555555555555'

describe('looksLikeClientId', () => {
  it('accepts an Azure application id (a GUID)', () => {
    expect(looksLikeClientId('microsoft', GUID)).toBe(true)
    expect(looksLikeClientId('microsoft', GUID.toUpperCase())).toBe(true)
  })

  it('rejects a paste that is clearly not a client id', () => {
    // The common mistakes: pasting the tenant name, an email, or a secret.
    expect(looksLikeClientId('microsoft', 'someone@hotmail.com')).toBe(false)
    expect(looksLikeClientId('microsoft', 'not-a-guid')).toBe(false)
    expect(looksLikeClientId('microsoft', '')).toBe(false)
    expect(looksLikeClientId('microsoft', '   ')).toBe(false)
  })

  it('accepts a Google desktop client id and rejects a bare number', () => {
    expect(looksLikeClientId('google', '123-abc.apps.googleusercontent.com')).toBe(true)
    expect(looksLikeClientId('google', '123456')).toBe(false)
    // A Google id is not a GUID and vice versa — the check is per provider.
    expect(looksLikeClientId('google', GUID)).toBe(false)
  })

  it('tolerates surrounding whitespace, which paste often adds', () => {
    expect(looksLikeClientId('microsoft', `  ${GUID}  `)).toBe(true)
  })
})

describe('saveClientId', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-oauth-save-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('makes the provider configured, so the sign-in button appears', () => {
    saveClientId(dir, 'microsoft', GUID)
    expect(isMicrosoftOAuthConfigured(dir)).toBe(true)
    expect(resolveMicrosoftClientId(dir)).toBe(GUID)
  })

  it('a saved id overrides the shipped default — this is how a user brings their own', () => {
    saveClientId(dir, 'microsoft', GUID)
    expect(resolveMicrosoftClientId(dir)).toBe(GUID)
    expect(resolveMicrosoftClientId(dir)).not.toBe(SHIPPED_CLIENT_ID.microsoft)
  })

  it('trims what it stores', () => {
    saveClientId(dir, 'microsoft', `  ${GUID}\n`)
    expect(resolveMicrosoftClientId(dir)).toBe(GUID)
  })

  it('keeps providers in separate files', () => {
    saveClientId(dir, 'microsoft', GUID)
    expect(resolveGoogleClientId(dir)).toBeNull()
    saveClientId(dir, 'google', '123-abc.apps.googleusercontent.com')
    expect(resolveMicrosoftClientId(dir)).toBe(GUID)
  })

  it('overwrites a previous id rather than appending', () => {
    saveClientId(dir, 'microsoft', GUID)
    const other = '99999999-8888-7777-6666-555555555555'
    saveClientId(dir, 'microsoft', other)
    expect(resolveMicrosoftClientId(dir)).toBe(other)
  })

  it('writes the file 0600 — it is per-user config, not world-readable', () => {
    saveClientId(dir, 'microsoft', GUID)
    const mode = fs.statSync(path.join(dir, 'microsoft-oauth.json')).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('creates the directory when it does not exist yet', () => {
    const nested = path.join(dir, 'does', 'not', 'exist')
    saveClientId(nested, 'microsoft', GUID)
    expect(resolveMicrosoftClientId(nested)).toBe(GUID)
  })
})

describe('resolution order', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-oauth-order-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); delete process.env.MICROSOFT_OAUTH_CLIENT_ID })

  it('lets the env var win over the saved file', () => {
    saveClientId(dir, 'microsoft', GUID)
    process.env.MICROSOFT_OAUTH_CLIENT_ID = '99999999-8888-7777-6666-555555555555'
    expect(resolveMicrosoftClientId(dir)).toBe('99999999-8888-7777-6666-555555555555')
  })
})
