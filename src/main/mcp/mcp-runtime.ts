import { getConnector, isRemoteOAuth, requiredSecretNames } from './connectors'
import { buildMcpConfig, type HeadersHelperResolver } from './mcp-config'
import { remoteVaultKey } from './oauth/remote-vault'
import type { Vault } from '../secrets/vault'

/**
 * Ties the vault + connector catalog + config generator into the concrete
 * pieces the spawn needs: extra env vars (decrypted secrets), extra argv
 * (`--mcp-config <path> --strict-mcp-config`), and extra allowlist tools
 * (`mcp__<id>__*`).
 *
 * SECURITY: this is the ONE place a decrypted secret lands in the returned
 * `env`. The result's `env` is merged into `childEnv` at spawn time and then
 * the caller nulls its references. Secrets NEVER enter `args` — the `.mcp.json`
 * carries only `${VAR}` refs which Claude expands from `env` at MCP launch.
 */

export interface McpInjection {
  /** Extra env vars to merge into childEnv (decrypted secret values). */
  env: Record<string, string>
  /** Extra argv: `--mcp-config <path>` + `--strict-mcp-config`. */
  args: string[]
  /** Extra allowlist tools: `mcp__<id>__*` per enabled+ready connector. */
  allowTools: string[]
  /** Connector ids that actually wired in (enabled AND had their secrets). */
  wired: string[]
  /** Enabled connectors dropped because a required secret was missing. */
  skippedMissingSecret: string[]
}

const EMPTY: McpInjection = { env: {}, args: [], allowTools: [], wired: [], skippedMissingSecret: [] }

/**
 * Resolves an MCP injection for a run.
 *
 * A connector wires in only if it is enabled AND every required secret is
 * present in the vault (a connector with a missing key is skipped, never
 * launched half-configured). If nothing wires in, returns an empty injection
 * and the caller leaves the run untouched (unchanged behavior).
 *
 * `writeConfig` builds+writes the `.mcp.json`. Injected for testability so a
 * spy can assert the exact args/env without touching disk or the vault.
 */
export function resolveMcpInjection(
  enabledIds: string[],
  vault: Pick<Vault, 'get' | 'has'>,
  workspaceRoot: string,
  userDataDir: string,
  writeConfig = buildMcpConfig,
  headersHelper?: HeadersHelperResolver,
): McpInjection {
  if (enabledIds.length === 0) return EMPTY

  const env: Record<string, string> = {}
  const ready: string[] = []
  const skippedMissingSecret: string[] = []

  for (const id of enabledIds) {
    const connector = getConnector(id)
    if (!connector) continue

    if (isRemoteOAuth(connector)) {
      // A remote connector "wires in" only if the user has connected it (an
      // OAuth record is stored) AND we can resolve the headersHelper. NO secret
      // enters env — the CLI gets a fresh bearer from wos-mcp-token at connect.
      const key = remoteVaultKey(id)
      if (!key || !vault.has(key) || !headersHelper) { skippedMissingSecret.push(id); continue }
      ready.push(id)
      continue
    }

    const names = requiredSecretNames(id)
    // Decrypt every required secret up front; if any is missing, skip the whole
    // connector (never launch it with a partial/empty credential).
    const resolved: Record<string, string> = {}
    let missing = false
    for (const name of names) {
      const value = vault.get(name)
      if (value == null || value === '') { missing = true; break }
      resolved[name] = value
    }
    if (missing) { skippedMissingSecret.push(id); continue }
    Object.assign(env, resolved)
    ready.push(id)
  }

  if (ready.length === 0) {
    return { ...EMPTY, skippedMissingSecret }
  }

  const built = writeConfig(ready, workspaceRoot, userDataDir, headersHelper)
  return {
    env,
    // --strict-mcp-config: use ONLY this config, ignore any project/global
    // .mcp.json — the agent can't reach servers the user didn't enable here.
    args: ['--mcp-config', built.path, '--strict-mcp-config'],
    allowTools: built.allowTools,
    wired: ready,
    skippedMissingSecret,
  }
}
