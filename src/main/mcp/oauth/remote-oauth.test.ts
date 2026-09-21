import { describe, it, expect, vi } from 'vitest'
import {
  parseProtectedResource,
  parseAuthServerMetadata,
  discoverEndpoints,
  buildAuthUrl,
  refreshAccessToken,
  type OAuthFetch,
} from './remote-oauth'

describe('remote-oauth metadata parsing (fixtures)', () => {
  it('parses an RFC 9728 protected-resource doc → auth server + resource', () => {
    const doc = {
      resource: 'https://mcp.sentry.dev/mcp',
      authorization_servers: ['https://sentry.io'],
    }
    expect(parseProtectedResource(doc)).toEqual({
      authServer: 'https://sentry.io',
      resource: 'https://mcp.sentry.dev/mcp',
    })
  })

  it('rejects a protected-resource doc with no authorization_servers', () => {
    expect(parseProtectedResource({ resource: 'x' })).toBeNull()
    expect(parseProtectedResource(null)).toBeNull()
    expect(parseProtectedResource('nope')).toBeNull()
  })

  it('parses an RFC 8414 auth-server doc → endpoints', () => {
    const doc = {
      authorization_endpoint: 'https://sentry.io/oauth/authorize',
      token_endpoint: 'https://sentry.io/oauth/token',
    }
    expect(parseAuthServerMetadata(doc)).toEqual({
      authorizationEndpoint: 'https://sentry.io/oauth/authorize',
      tokenEndpoint: 'https://sentry.io/oauth/token',
    })
  })

  it('rejects an auth-server doc missing endpoints', () => {
    expect(parseAuthServerMetadata({ token_endpoint: 'x' })).toBeNull()
    expect(parseAuthServerMetadata({})).toBeNull()
  })
})

describe('discoverEndpoints (RFC 9728 → RFC 8414 chain)', () => {
  it('follows protected-resource → auth-server metadata and yields endpoints', async () => {
    const fetchFn: OAuthFetch = vi.fn(async (url: string) => {
      if (url.endsWith('/.well-known/oauth-protected-resource')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            resource: 'https://mcp.sentry.dev/mcp',
            authorization_servers: ['https://sentry.io'],
          }),
        }
      }
      if (url.endsWith('/.well-known/oauth-authorization-server')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authorization_endpoint: 'https://sentry.io/oauth/authorize',
            token_endpoint: 'https://sentry.io/oauth/token',
          }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })

    const res = await discoverEndpoints('https://mcp.sentry.dev/mcp', fetchFn)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.authorizationEndpoint).toBe('https://sentry.io/oauth/authorize')
    expect(res.value.tokenEndpoint).toBe('https://sentry.io/oauth/token')
    expect(res.value.resource).toBe('https://mcp.sentry.dev/mcp')
  })

  it('errors cleanly when the protected-resource doc is missing', async () => {
    const fetchFn: OAuthFetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
    const res = await discoverEndpoints('https://mcp.sentry.dev/mcp', fetchFn)
    expect(res.ok).toBe(false)
  })
})

describe('buildAuthUrl', () => {
  it('carries PKCE S256 + resource indicator + optional scopes', () => {
    const url = buildAuthUrl({
      authorizationEndpoint: 'https://sentry.io/oauth/authorize',
      clientId: 'workspace-os',
      redirectUri: 'http://127.0.0.1:51234',
      codeChallenge: 'CHAL',
      state: 'STATE',
      scopes: ['org:read'],
      resource: 'https://mcp.sentry.dev/mcp',
    })
    const u = new URL(url)
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('code_challenge')).toBe('CHAL')
    expect(u.searchParams.get('state')).toBe('STATE')
    expect(u.searchParams.get('resource')).toBe('https://mcp.sentry.dev/mcp')
    expect(u.searchParams.get('scope')).toBe('org:read')
  })
})

describe('refreshAccessToken', () => {
  it('binds the resource and returns a normalized token set', async () => {
    const fetchFn: OAuthFetch = vi.fn(async (_url, init) => {
      expect(init.body).toContain('grant_type=refresh_token')
      expect(init.body).toContain('resource=')
      return { ok: true, status: 200, json: async () => ({ access_token: 'AT', expires_in: 1200 }) }
    })
    const res = await refreshAccessToken(
      { tokenEndpoint: 'https://sentry.io/oauth/token', refreshToken: 'RT', clientId: 'workspace-os', resource: 'https://mcp.sentry.dev/mcp' },
      fetchFn,
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.accessToken).toBe('AT')
    expect(res.value.expiresAt).toBeGreaterThan(Date.now())
  })
})
