import { describe, it, expect } from 'vitest'
import { buildMcpConfigObject } from './mcp-config'
import { CONNECTORS, isRemoteOAuth, toolPrefix } from './connectors'

/** The new Wave connectors added on top of github/filesystem/postgres. */
const NEW_CONNECTORS = ['brave', 'slack', 'notion', 'tavily'] as const

describe('buildMcpConfigObject', () => {
  it('emits ${VAR} refs in env, never the literal secret value', () => {
    const { config, allowTools } = buildMcpConfigObject(['github'], '/ws')
    const gh = config.mcpServers['github']
    expect(gh.env).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_PERSONAL_ACCESS_TOKEN}' })
    // The whole serialized config must not contain anything resembling a value —
    // only the placeholder reference and the package name.
    const json = JSON.stringify(config)
    expect(json).toContain('${GITHUB_PERSONAL_ACCESS_TOKEN}')
    expect(json).toContain('@modelcontextprotocol/server-github')
    expect(allowTools).toEqual([toolPrefix('github')])
  })

  it('substitutes ${WORKSPACE_ROOT} for the filesystem connector; no env/secret', () => {
    const { config, allowTools } = buildMcpConfigObject(['filesystem'], '/Users/me/ws')
    const fsc = config.mcpServers['filesystem']
    expect(fsc.args).toContain('/Users/me/ws')
    expect(fsc.args).not.toContain('${WORKSPACE_ROOT}')
    expect(fsc.env).toBeUndefined() // no secret → no env block at all
    expect(allowTools).toEqual([toolPrefix('filesystem')])
  })

  it('postgres passes the connection string via ${VAR} env, not argv', () => {
    const { config } = buildMcpConfigObject(['postgres'], '/ws')
    const pg = config.mcpServers['postgres']
    expect(pg.env).toEqual({ DATABASE_URL: '${DATABASE_URL}' })
    // The connection string must never be a positional arg.
    expect(pg.args.join(' ')).not.toMatch(/postgres(ql)?:\/\//)
  })

  it('drops unknown connector ids silently', () => {
    const { config, enabled } = buildMcpConfigObject(['github', 'bogus'], '/ws')
    expect(Object.keys(config.mcpServers)).toEqual(['github'])
    expect(enabled).toEqual(['github'])
  })

  it('a literal secret value is NEVER present for any connector', () => {
    const { config } = buildMcpConfigObject(['github', 'postgres', 'filesystem'], '/ws')
    const json = JSON.stringify(config)
    // A ${VAR} ref always starts with ${ — assert there is no bare env value by
    // proving every env entry equals its own ${NAME} placeholder.
    for (const server of Object.values(config.mcpServers)) {
      for (const [k, v] of Object.entries(server.env ?? {})) {
        expect(v).toBe('${' + k + '}')
      }
    }
    expect(json).not.toMatch(/ghp_/)
  })

  it('every catalog entry is well-formed (id/command/args/secret metadata)', () => {
    for (const c of CONNECTORS) {
      expect(typeof c.id).toBe('string')
      expect(c.id.length).toBeGreaterThan(0)
      expect(c.displayName.length).toBeGreaterThan(0)
      expect(c.description.length).toBeGreaterThan(0)
      if (isRemoteOAuth(c)) {
        // Remote connectors don't launch a local process; they carry OAuth config.
        expect(c.remote?.url).toMatch(/^https:\/\//)
        continue
      }
      expect(c.command).toBe('npx')
      // -y first so npx never prompts inside the non-interactive broker.
      expect(c.args[0]).toBe('-y')
      expect(c.args.length).toBeGreaterThanOrEqual(2)
      for (const s of c.secrets) {
        expect(s.envVar).toMatch(/^[A-Z][A-Z0-9_]*$/) // env-var shaped
        expect(s.label.length).toBeGreaterThan(0)
        expect(s.hint.length).toBeGreaterThan(0)
      }
    }
    // Ids are unique.
    const ids = CONNECTORS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each([
    ['brave', '@brave/brave-search-mcp-server', ['BRAVE_API_KEY']],
    ['slack', '@modelcontextprotocol/server-slack', ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID']],
    ['notion', '@notionhq/notion-mcp-server', ['NOTION_TOKEN']],
    ['tavily', 'tavily-mcp', ['TAVILY_API_KEY']],
  ] as const)(
    'new connector %s: package in args, secrets as ${VAR} env only, right allowlist',
    (id, pkg, envVars) => {
      const { config, allowTools } = buildMcpConfigObject([id], '/ws')
      const server = config.mcpServers[id]
      // Package name is a literal arg (public, non-secret).
      expect(server.args).toContain(pkg)
      // Each required secret is an env ${VAR} placeholder — never a literal.
      const expectedEnv: Record<string, string> = {}
      for (const v of envVars) expectedEnv[v] = '${' + v + '}'
      expect(server.env).toEqual(expectedEnv)
      // The secret var names must NOT appear anywhere in argv.
      for (const v of envVars) {
        expect(server.args.join(' ')).not.toContain(v)
      }
      // Correct least-privilege allowlist.
      expect(allowTools).toEqual([toolPrefix(id)])
    },
  )

  it('no literal secret value ever appears for the new connectors', () => {
    const { config } = buildMcpConfigObject([...NEW_CONNECTORS], '/ws')
    for (const id of NEW_CONNECTORS) {
      const server = config.mcpServers[id]
      for (const [k, v] of Object.entries(server.env ?? {})) {
        expect(v).toBe('${' + k + '}') // pure placeholder, no value
      }
    }
  })

  // --- Remote OAuth connectors (Path B) ------------------------------------

  const helper = (id: string): string => `/abs/userData/bin/wos-mcp-token ${id}`

  it('sentry (remote-oauth) emits type:http + url + headersHelper — NO env, NO token', () => {
    const { config, allowTools } = buildMcpConfigObject(['sentry'], '/ws', helper)
    const entry = config.mcpServers['sentry'] as {
      type?: string; url?: string; headersHelper?: string; env?: unknown; command?: string
    }
    expect(entry.type).toBe('http') // REQUIRED — a bare url is skipped by the CLI
    expect(entry.url).toBe('https://mcp.sentry.dev/mcp')
    expect(entry.headersHelper).toBe('/abs/userData/bin/wos-mcp-token sentry')
    // No stdio fields, no env secret block at all.
    expect(entry.command).toBeUndefined()
    expect(entry.env).toBeUndefined()
    // The whole config carries no literal token and no env-secret ref.
    const json = JSON.stringify(config)
    expect(json).not.toMatch(/Bearer|refresh|\$\{/)
    expect(allowTools).toEqual([toolPrefix('sentry')])
  })

  it('the headersHelper path carries the connector id (not a token)', () => {
    const { config } = buildMcpConfigObject(['sentry'], '/ws', helper)
    const entry = config.mcpServers['sentry'] as { headersHelper?: string }
    expect(entry.headersHelper).toContain('wos-mcp-token')
    expect(entry.headersHelper).toContain('sentry')
    expect(entry.headersHelper).not.toMatch(/eyJ|Bearer|rt_/) // no token-looking content
  })

  it('skips a remote connector when no headersHelper resolver is given', () => {
    const { config, enabled } = buildMcpConfigObject(['sentry'], '/ws')
    expect(config.mcpServers['sentry']).toBeUndefined()
    expect(enabled).not.toContain('sentry')
  })
})
