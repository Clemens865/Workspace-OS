import fs from 'fs'
import path from 'path'
import {
  CONNECTORS,
  getConnector,
  isRemoteOAuth,
  toolPrefix,
  type Connector,
} from './connectors'

/**
 * Generates the `.mcp.json` Claude Code reads via `--mcp-config`.
 *
 * SECURITY invariant: the config contains ONLY `${VAR}` references in each
 * server's `env` — NEVER a literal secret value. Claude Code expands `${VAR}`
 * from the child process environment at MCP-server launch time, and we inject
 * the decrypted secret into that env (see handlers/agent.ts). So the secret's
 * only on-disk home stays the encrypted vault; the config file is safe even if
 * read. The `.mcp.json` is still written `mode 0o600` and is gitignored.
 *
 * The object builder ({@link buildMcpConfigObject}) is pure (no fs) so tests can
 * assert "no literal secret, only ${VAR}" without touching disk.
 */

/** A single stdio MCP server entry (npx-launched, env-var secret). */
interface StdioServerEntry {
  command: string
  args: string[]
  env?: Record<string, string>
}

/**
 * A single REMOTE (Streamable-HTTP) MCP server entry. `type:"http"` is REQUIRED
 * — a bare `url` with no `type` is skipped by the CLI. `headersHelper` is an
 * absolute command the CLI runs at connect time to obtain auth headers; we
 * point it at our wos-mcp-token, which mints a fresh bearer from the vault. NO
 * token is ever written here — only the helper PATH (+ the connector id arg).
 */
interface HttpServerEntry {
  type: 'http'
  url: string
  headersHelper: string
}

type McpServerEntry = StdioServerEntry | HttpServerEntry

interface McpConfigObject {
  mcpServers: Record<string, McpServerEntry>
}

/**
 * Resolves the absolute `headersHelper` command for a remote connector:
 * `<abs path to wos-mcp-token> <connectorId>`. Injected so the pure builder can
 * be tested without the install layer.
 */
export type HeadersHelperResolver = (connectorId: string) => string

export interface BuiltMcpConfig {
  /** Path to the written `.mcp.json`. Pass to `claude --mcp-config <path>`. */
  path: string
  /** `mcp__<server>__*` allowlist entries for the enabled connectors. */
  allowTools: string[]
  /** The enabled connector ids actually written (unknown ids dropped). */
  enabled: string[]
}

/** Substitutes `${WORKSPACE_ROOT}` in an arg template. Secrets are NOT here. */
function resolveArgs(connector: Connector, workspaceRoot: string): string[] {
  return connector.args.map((a) => a.replace('${WORKSPACE_ROOT}', workspaceRoot))
}

/**
 * Builds the config object for the given enabled connector ids. Each required
 * secret becomes an `env` entry mapping its env var to a `${VAR}` reference —
 * a placeholder, never the value. Unknown ids are silently skipped.
 */
export function buildMcpConfigObject(
  enabledIds: string[],
  workspaceRoot: string,
  headersHelper?: HeadersHelperResolver,
): { config: McpConfigObject; allowTools: string[]; enabled: string[] } {
  const mcpServers: Record<string, McpServerEntry> = {}
  const allowTools: string[] = []
  const enabled: string[] = []

  for (const id of enabledIds) {
    const connector = getConnector(id)
    if (!connector) continue

    if (isRemoteOAuth(connector)) {
      // A remote connector needs a resolvable headersHelper AND a url. Without
      // the resolver (or url) we cannot wire it safely — skip rather than emit a
      // token-less/broken entry.
      const url = connector.remote?.url
      if (!headersHelper || !url) continue
      // type:"http" is REQUIRED (a bare url is skipped by the CLI). The
      // headersHelper is an absolute PATH + the id — NEVER a literal token.
      mcpServers[id] = { type: 'http', url, headersHelper: headersHelper(id) }
      allowTools.push(toolPrefix(id))
      enabled.push(id)
      continue
    }

    const entry: StdioServerEntry = {
      command: connector.command,
      args: resolveArgs(connector, workspaceRoot),
    }
    if (connector.secrets.length > 0) {
      // ${VAR} reference ONLY — Claude expands it from the child env at launch.
      entry.env = Object.fromEntries(
        connector.secrets.map((s) => [s.envVar, `\${${s.envVar}}`]),
      )
    }
    mcpServers[id] = entry
    allowTools.push(toolPrefix(id))
    enabled.push(id)
  }

  return { config: { mcpServers }, allowTools, enabled }
}

/**
 * Writes the `.mcp.json` to `userDataDir` (mode 0o600) and returns its path plus
 * the `mcp__<server>__*` allowlist entries. If no connectors resolve, writes an
 * empty-servers config and returns no allow entries (caller then skips wiring).
 */
export function buildMcpConfig(
  enabledIds: string[],
  workspaceRoot: string,
  userDataDir: string,
  headersHelper?: HeadersHelperResolver,
): BuiltMcpConfig {
  const { config, allowTools, enabled } = buildMcpConfigObject(enabledIds, workspaceRoot, headersHelper)
  const outPath = path.join(userDataDir, '.mcp.json')
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 })
  try { fs.chmodSync(outPath, 0o600) } catch { /* best-effort */ }
  return { path: outPath, allowTools, enabled }
}

/** All catalog ids (for validating/enumerating). */
export function allConnectorIds(): string[] {
  return CONNECTORS.map((c) => c.id)
}
