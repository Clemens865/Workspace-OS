/**
 * Static catalog of Wave-1, headless-friendly MCP connectors.
 *
 * "Headless-friendly" = the connector authenticates with an env-var secret (or
 * no secret), NOT an interactive browser OAuth flow — so it works inside the
 * non-interactive `claude -p` broker. OAuth connectors are a later wave.
 *
 * Pure data + pure helpers (no Electron / fs) so this stays unit-testable.
 *
 * Each connector's tools are gated to `mcp__<id>__*`: when a connector is
 * enabled we add exactly that prefix to the agent's allowlist (least privilege
 * — only enabled connectors' tools are ever allowed).
 */

/** A secret this connector needs, by the env-var name the MCP server reads. */
export interface ConnectorSecret {
  /** Env var the MCP server reads AND the vault key name (kept identical). */
  envVar: string
  /** Human label for the "Add key" field. */
  label: string
  /** Short help shown under the field (where to get the token). */
  hint: string
}

/**
 * Connector KIND:
 *  - 'stdio-apikey' (default): a local stdio MCP server launched by `npx`,
 *    authenticated with an env-var secret (or none). Wave-1 shape.
 *  - 'remote-oauth': a remote OAuth-2.1 MCP server over Streamable-HTTP. We run
 *    the PKCE loopback flow ourselves and feed the CLI a fresh bearer via a
 *    `headersHelper` (wos-mcp-token). No env secret; the `.mcp.json` entry is
 *    `{ type:"http", url, headersHelper }`.
 */
export type ConnectorKind = 'stdio-apikey' | 'remote-oauth'

/** Configured OAuth endpoints for a remote-oauth connector (skips discovery). */
export interface RemoteOAuthConfig {
  /** The remote MCP endpoint (Streamable-HTTP). */
  url: string
  /** When set, these endpoints are used verbatim (no RFC 9728/8414 discovery). */
  authorizationEndpoint?: string
  tokenEndpoint?: string
  /** RFC 8707 resource/audience (defaults to `url` if omitted). */
  resource?: string
  /** OAuth scopes to request (empty = server default). */
  scopes?: string[]
  /**
   * Public OAuth client id. When omitted the flow relies on discovery /
   * dynamic-client-registration upstream; may be set via env at connect time.
   */
  clientId?: string
}

export interface Connector {
  /** Stable id — also the MCP server key and the `mcp__<id>__` tool prefix. */
  id: string
  displayName: string
  description: string
  /** Connector kind (defaults to 'stdio-apikey' when absent). */
  kind?: ConnectorKind
  /** The launcher binary (always `npx` for stdio connectors). Unused for remote. */
  command: string
  /**
   * Args template. `${WORKSPACE_ROOT}` is substituted with the real workspace
   * path at config-build time; secrets are NEVER interpolated here (they ride
   * `env`), so args stay free of literal credentials.
   */
  args: string[]
  /** Secrets required before this connector can be enabled. Empty = none. */
  secrets: ConnectorSecret[]
  /** Present only for kind 'remote-oauth' — the OAuth/endpoint config. */
  remote?: RemoteOAuthConfig
}

/** The connector's kind, defaulting to the Wave-1 stdio+API-key shape. */
export function connectorKind(c: Connector): ConnectorKind {
  return c.kind ?? 'stdio-apikey'
}

/** True when the connector authenticates via our own remote OAuth flow. */
export function isRemoteOAuth(c: Connector): boolean {
  return connectorKind(c) === 'remote-oauth'
}

/**
 * The catalog. Package names + env-var names verified against upstream docs
 * (2026-07):
 *  - @modelcontextprotocol/server-github     (env GITHUB_PERSONAL_ACCESS_TOKEN)
 *  - @modelcontextprotocol/server-filesystem (positional root arg, no secret)
 *  - @modelcontextprotocol/server-postgres   (connection-string via DATABASE_URL)
 *  - @brave/brave-search-mcp-server          (env BRAVE_API_KEY; stdio default)
 *  - @modelcontextprotocol/server-slack      (env SLACK_BOT_TOKEN + SLACK_TEAM_ID)
 *  - @notionhq/notion-mcp-server             (env NOTION_TOKEN — integration token)
 *  - tavily-mcp                              (env TAVILY_API_KEY)
 *
 * REMOTE OAuth (Path B — this wave):
 *  - Sentry: the maintained path (mcp.sentry.dev/mcp) is OAuth-2.1 remote-only.
 *    We run the PKCE loopback flow ourselves and feed the CLI a fresh bearer via
 *    the wos-mcp-token headersHelper. See the 'sentry' entry below.
 *
 *  - Linear (mcp.linear.app/mcp) and Asana (mcp.asana.com/v2/mcp) — both
 *    Streamable-HTTP + OAuth with dynamic client registration — ride the same
 *    path (added 2026-09 with the Connectors page).
 */
export const CONNECTORS: readonly Connector[] = [
  {
    id: 'github',
    displayName: 'GitHub',
    description: 'Read/search repos, issues and PRs with a Personal Access Token.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    secrets: [
      {
        envVar: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'GitHub Personal Access Token',
        hint: 'Create at github.com/settings/tokens (classic or fine-grained).',
      },
    ],
  },
  {
    id: 'filesystem',
    displayName: 'Filesystem',
    description: 'Structured file access scoped to the open workspace folder.',
    command: 'npx',
    // Scoped to the workspace root — the placeholder is substituted at build time.
    args: ['-y', '@modelcontextprotocol/server-filesystem', '${WORKSPACE_ROOT}'],
    secrets: [],
  },
  {
    id: 'postgres',
    displayName: 'Postgres',
    description: 'Query a Postgres database (read-only) via a connection string.',
    command: 'npx',
    // The connection string is a SECRET and must not sit in argv. The server
    // also accepts it via the DATABASE_URL env var, which is how we pass it.
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    secrets: [
      {
        envVar: 'DATABASE_URL',
        label: 'Postgres connection string',
        hint: 'postgresql://user:pass@host:5432/dbname — stored encrypted, passed via env.',
      },
    ],
  },
  {
    id: 'brave',
    displayName: 'Brave Search',
    description: 'Web, news, image and local search via the Brave Search API.',
    command: 'npx',
    // Brave's official server defaults to stdio; the API key rides BRAVE_API_KEY.
    args: ['-y', '@brave/brave-search-mcp-server', '--transport', 'stdio'],
    secrets: [
      {
        envVar: 'BRAVE_API_KEY',
        label: 'Brave Search API key',
        hint: 'Create a key at api-dashboard.search.brave.com (free tier available).',
      },
    ],
  },
  {
    id: 'slack',
    displayName: 'Slack',
    description: 'Read channels, post messages and search a Slack workspace with a bot token.',
    command: 'npx',
    // Official reference server (archived but stable at 2025.4.25). A maintained
    // fork exists as @zencoderai/slack-mcp-server with identical env vars if
    // upstream ever needs swapping. Both credentials ride env, never argv.
    args: ['-y', '@modelcontextprotocol/server-slack'],
    secrets: [
      {
        envVar: 'SLACK_BOT_TOKEN',
        label: 'Slack Bot User OAuth Token',
        hint: 'Starts xoxb- — from api.slack.com/apps → OAuth & Permissions.',
      },
      {
        envVar: 'SLACK_TEAM_ID',
        label: 'Slack Team ID',
        hint: 'Starts T… — your workspace/team id (e.g. T0123ABC).',
      },
    ],
  },
  {
    id: 'notion',
    displayName: 'Notion',
    description: 'Read and update Notion pages and databases with an internal integration token.',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    secrets: [
      {
        // Notion's official server reads NOTION_TOKEN (the integration secret).
        envVar: 'NOTION_TOKEN',
        label: 'Notion integration token',
        hint: 'Starts ntn_ — create an internal integration at notion.so/my-integrations and share the pages with it.',
      },
    ],
  },
  {
    id: 'tavily',
    displayName: 'Tavily',
    description: 'Web search, extract, map and crawl tuned for LLM research via the Tavily API.',
    command: 'npx',
    args: ['-y', 'tavily-mcp'],
    secrets: [
      {
        envVar: 'TAVILY_API_KEY',
        label: 'Tavily API key',
        hint: 'Starts tvly- — create a key at app.tavily.com (free tier available).',
      },
    ],
  },
  {
    // Remote OAuth-2.1 MCP server (Streamable-HTTP). No env secret: we run the
    // PKCE loopback flow ourselves, store the refresh token in the vault, and
    // feed the CLI a fresh bearer via the wos-mcp-token headersHelper. The
    // .mcp.json entry is `{ type:"http", url, headersHelper }` — see mcp-config.
    id: 'sentry',
    displayName: 'Sentry',
    description: 'Search issues, releases and errors in your Sentry org via the official remote MCP server (OAuth).',
    kind: 'remote-oauth',
    command: '', // unused for remote connectors
    args: [], // unused for remote connectors
    secrets: [],
    remote: {
      url: 'https://mcp.sentry.dev/mcp',
      // Endpoints are discovered at connect time (RFC 9728 → RFC 8414). Leaving
      // them unset here keeps us resilient to Sentry rotating its auth server.
      resource: 'https://mcp.sentry.dev/mcp',
      scopes: [],
    },
  },
  {
    // Official Linear remote server: Streamable-HTTP + OAuth 2.1 with dynamic
    // client registration (linear.app/docs/mcp, verified 2026-09). Same shape
    // as Sentry; endpoints discovered at connect time.
    id: 'linear',
    displayName: 'Linear',
    description: 'Read and update issues, projects and cycles in your Linear workspace (OAuth).',
    kind: 'remote-oauth',
    command: '',
    args: [],
    secrets: [],
    remote: {
      url: 'https://mcp.linear.app/mcp',
      resource: 'https://mcp.linear.app/mcp',
      scopes: [],
    },
  },
  {
    // Official Asana V2 remote server: Streamable-HTTP + OAuth
    // (developers.asana.com/docs/using-asanas-mcp-server, verified 2026-09).
    // The older /sse endpoint is retired; only v2 is listed.
    id: 'asana',
    displayName: 'Asana',
    description: 'Read and update tasks, projects and goals in your Asana workspace (OAuth).',
    kind: 'remote-oauth',
    command: '',
    args: [],
    secrets: [],
    remote: {
      url: 'https://mcp.asana.com/v2/mcp',
      resource: 'https://mcp.asana.com/v2/mcp',
      scopes: [],
    },
  },
] as const

const CONNECTOR_BY_ID = new Map(CONNECTORS.map((c) => [c.id, c]))

export function getConnector(id: string): Connector | undefined {
  return CONNECTOR_BY_ID.get(id)
}

export function isConnectorId(id: unknown): id is string {
  return typeof id === 'string' && CONNECTOR_BY_ID.has(id)
}

/** The tool allowlist prefix for a connector: `mcp__<id>__*`. */
export function toolPrefix(id: string): string {
  return `mcp__${id}__*`
}

/** Env-var names a connector needs (also the vault key names). */
export function requiredSecretNames(id: string): string[] {
  return getConnector(id)?.secrets.map((s) => s.envVar) ?? []
}
