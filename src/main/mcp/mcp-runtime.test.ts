import { describe, it, expect, vi } from 'vitest'
import { resolveMcpInjection } from './mcp-runtime'
import type { BuiltMcpConfig } from './mcp-config'

/** A vault stub keyed by an in-memory map — never touches disk/Electron. */
function vaultWith(secrets: Record<string, string>): {
  get: (n: string) => string | null
  has: (n: string) => boolean
} {
  return {
    get: (n: string) => (n in secrets ? secrets[n] : null),
    has: (n: string) => n in secrets,
  }
}

/** A writeConfig spy that records its call and returns a fixed built config. */
function configSpy(): {
  fn: (ids: string[], ws: string, dir: string) => BuiltMcpConfig
  calls: { ids: string[]; ws: string; dir: string }[]
} {
  const calls: { ids: string[]; ws: string; dir: string }[] = []
  const fn = (ids: string[], ws: string, dir: string): BuiltMcpConfig => {
    calls.push({ ids, ws, dir })
    return { path: '/userData/.mcp.json', allowTools: ids.map((i) => `mcp__${i}__*`), enabled: ids }
  }
  return { fn, calls }
}

describe('resolveMcpInjection', () => {
  it('no enabled connectors → empty injection, config not written', () => {
    const spy = configSpy()
    const out = resolveMcpInjection([], vaultWith({}), '/ws', '/userData', spy.fn)
    expect(out.args).toEqual([])
    expect(out.allowTools).toEqual([])
    expect(out.wired).toEqual([])
    expect(spy.calls).toHaveLength(0)
  })

  it('injects the secret into env and the config path into args — NEVER into argv', () => {
    const spy = configSpy()
    const secret = 'ghp_LIVE_SECRET_VALUE'
    const out = resolveMcpInjection(
      ['github'],
      vaultWith({ GITHUB_PERSONAL_ACCESS_TOKEN: secret }),
      '/ws',
      '/userData',
      spy.fn,
    )
    // Secret lands ONLY in env.
    expect(out.env).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: secret })
    // args carry the config path + strict flag, and NOT the secret.
    expect(out.args).toEqual(['--mcp-config', '/userData/.mcp.json', '--strict-mcp-config'])
    expect(out.args.join(' ')).not.toContain(secret)
    expect(out.allowTools).toEqual(['mcp__github__*'])
    expect(out.wired).toEqual(['github'])
  })

  it('skips an enabled connector whose required secret is missing (never launches half-configured)', () => {
    const spy = configSpy()
    const out = resolveMcpInjection(['github'], vaultWith({}), '/ws', '/userData', spy.fn)
    expect(out.wired).toEqual([])
    expect(out.skippedMissingSecret).toEqual(['github'])
    expect(out.args).toEqual([]) // nothing ready → no config written
    expect(spy.calls).toHaveLength(0)
  })

  it('filesystem (no secret) wires in with no env', () => {
    const spy = configSpy()
    const out = resolveMcpInjection(['filesystem'], vaultWith({}), '/ws', '/userData', spy.fn)
    expect(out.env).toEqual({})
    expect(out.wired).toEqual(['filesystem'])
    expect(out.args).toEqual(['--mcp-config', '/userData/.mcp.json', '--strict-mcp-config'])
    expect(spy.calls[0].ids).toEqual(['filesystem'])
  })

  it('mixes ready + missing: only ready connectors are written', () => {
    const spy = configSpy()
    const out = resolveMcpInjection(
      ['github', 'filesystem', 'postgres'],
      vaultWith({ GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_x' }), // postgres DATABASE_URL missing
      '/ws',
      '/userData',
      spy.fn,
    )
    expect(out.wired.sort()).toEqual(['filesystem', 'github'])
    expect(out.skippedMissingSecret).toEqual(['postgres'])
    expect(spy.calls[0].ids.sort()).toEqual(['filesystem', 'github'])
  })

  it('the real vault.get spy is called for each required name', () => {
    const get = vi.fn((n: string) => (n === 'GITHUB_PERSONAL_ACCESS_TOKEN' ? 'ghp_x' : null))
    const has = vi.fn((n: string) => n === 'GITHUB_PERSONAL_ACCESS_TOKEN')
    resolveMcpInjection(['github'], { get, has }, '/ws', '/userData', configSpy().fn)
    expect(get).toHaveBeenCalledWith('GITHUB_PERSONAL_ACCESS_TOKEN')
  })

  // --- New Wave connectors: each puts its secret in env (not argv), emits its
  // own mcp__<id>__* allowlist, and is skipped when its secret is missing. ---

  it.each([
    ['brave', { BRAVE_API_KEY: 'brave_LIVE_KEY' }],
    ['notion', { NOTION_TOKEN: 'ntn_LIVE_TOKEN' }],
    ['tavily', { TAVILY_API_KEY: 'tvly_LIVE_KEY' }],
    ['slack', { SLACK_BOT_TOKEN: 'xoxb_LIVE', SLACK_TEAM_ID: 'T0LIVE' }],
  ] as const)(
    '%s: secret lands ONLY in env, args carry config path not the secret, right allowlist',
    (id, secrets) => {
      const spy = configSpy()
      const out = resolveMcpInjection([id], vaultWith({ ...secrets }), '/ws', '/userData', spy.fn)
      expect(out.env).toEqual(secrets)
      expect(out.args).toEqual(['--mcp-config', '/userData/.mcp.json', '--strict-mcp-config'])
      // No secret value leaks into argv.
      for (const value of Object.values(secrets)) {
        expect(out.args.join(' ')).not.toContain(value)
      }
      expect(out.allowTools).toEqual([`mcp__${id}__*`])
      expect(out.wired).toEqual([id])
    },
  )

  it.each([
    ['brave', {}],
    ['notion', {}],
    ['tavily', {}],
    ['slack', { SLACK_BOT_TOKEN: 'xoxb_only' }], // team id still missing → skip
  ] as const)('%s: skipped when a required secret is missing (never half-configured)', (id, secrets) => {
    const spy = configSpy()
    const out = resolveMcpInjection([id], vaultWith({ ...secrets }), '/ws', '/userData', spy.fn)
    expect(out.wired).toEqual([])
    expect(out.skippedMissingSecret).toEqual([id])
    expect(out.args).toEqual([])
    expect(spy.calls).toHaveLength(0)
  })

  it('slack wires in only when BOTH bot token and team id are present', () => {
    const spy = configSpy()
    const out = resolveMcpInjection(
      ['slack'],
      vaultWith({ SLACK_BOT_TOKEN: 'xoxb_x', SLACK_TEAM_ID: 'T123' }),
      '/ws',
      '/userData',
      spy.fn,
    )
    expect(out.env).toEqual({ SLACK_BOT_TOKEN: 'xoxb_x', SLACK_TEAM_ID: 'T123' })
    expect(out.wired).toEqual(['slack'])
  })

  // --- Remote OAuth connector (sentry): NO env secret; wires in only when
  // connected (a MCP_OAUTH_<id> record is stored) AND a headersHelper is given. ---

  const helper = (id: string): string => `/bin/wos-mcp-token ${id}`

  it('sentry wires in with NO env when connected + headersHelper present, allowlists mcp__sentry__*', () => {
    const spy = configSpy()
    const out = resolveMcpInjection(
      ['sentry'],
      vaultWith({ MCP_OAUTH_sentry: '{"refreshToken":"RT","tokenEndpoint":"x","clientId":"y"}' }),
      '/ws',
      '/userData',
      spy.fn,
      helper,
    )
    expect(out.env).toEqual({}) // the refresh token NEVER lands in env
    expect(out.wired).toEqual(['sentry'])
    expect(out.allowTools).toEqual(['mcp__sentry__*'])
    // The writeConfig spy is invoked for sentry and given the headersHelper.
    expect(spy.calls[0].ids).toEqual(['sentry'])
  })

  it('sentry is skipped when not connected (no stored OAuth record)', () => {
    const spy = configSpy()
    const out = resolveMcpInjection(['sentry'], vaultWith({}), '/ws', '/userData', spy.fn, helper)
    expect(out.wired).toEqual([])
    expect(out.skippedMissingSecret).toEqual(['sentry'])
    expect(spy.calls).toHaveLength(0)
  })

  it('sentry is skipped when no headersHelper resolver is available', () => {
    const spy = configSpy()
    const out = resolveMcpInjection(
      ['sentry'],
      vaultWith({ MCP_OAUTH_sentry: '{"refreshToken":"RT","tokenEndpoint":"x","clientId":"y"}' }),
      '/ws',
      '/userData',
      spy.fn,
      // headersHelper omitted
    )
    expect(out.wired).toEqual([])
    expect(out.skippedMissingSecret).toEqual(['sentry'])
  })
})
