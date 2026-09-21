import { describe, it, expect } from 'vitest'
import {
  remoteVaultKey,
  serializeRecord,
  parseRecord,
  needsRefresh,
  NEAR_EXPIRY_MS,
  type RemoteOAuthRecord,
} from './remote-vault'

describe('remoteVaultKey', () => {
  it('is env-var-shaped so the vault accepts it', () => {
    expect(remoteVaultKey('sentry')).toBe('MCP_OAUTH_sentry')
    // The key must satisfy the vault's key-name rule (letters/underscore start).
    expect(remoteVaultKey('sentry')).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/)
  })
})

describe('serialize/parse record', () => {
  it('round-trips a full record', () => {
    const rec: RemoteOAuthRecord = {
      refreshToken: 'RT',
      tokenEndpoint: 'https://a/token',
      clientId: 'workspace-os',
      resource: 'https://mcp/x',
      accessToken: 'AT',
      accessTokenExpiresAt: 123,
    }
    expect(parseRecord(serializeRecord(rec))).toEqual(rec)
  })

  it('rejects malformed / incomplete blobs', () => {
    expect(parseRecord(null)).toBeNull()
    expect(parseRecord('not json')).toBeNull()
    expect(parseRecord(JSON.stringify({ refreshToken: 'RT' }))).toBeNull() // no token endpoint
    expect(parseRecord(JSON.stringify({ tokenEndpoint: 'x', clientId: 'y' }))).toBeNull() // no refresh
  })
})

describe('needsRefresh', () => {
  const base: RemoteOAuthRecord = { refreshToken: 'RT', tokenEndpoint: 'x', clientId: 'y' }
  it('true when there is no cached access token', () => {
    expect(needsRefresh(base)).toBe(true)
  })
  it('true when the cached token is within the near-expiry window', () => {
    const now = 1_000_000
    const rec = { ...base, accessToken: 'AT', accessTokenExpiresAt: now + NEAR_EXPIRY_MS - 1 }
    expect(needsRefresh(rec, now)).toBe(true)
  })
  it('false when the cached token is comfortably in the future', () => {
    const now = 1_000_000
    const rec = { ...base, accessToken: 'AT', accessTokenExpiresAt: now + NEAR_EXPIRY_MS + 60_000 }
    expect(needsRefresh(rec, now)).toBe(false)
  })
})
