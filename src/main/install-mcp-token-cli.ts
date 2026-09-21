import { app } from 'electron'
import fs from 'fs'
import path from 'path'

/**
 * Installs the `wos-mcp-token` CLI shim — the `headersHelper` for remote OAuth
 * MCP connectors. Sibling of installMetricCli().
 *
 * The `claude` CLI runs `wos-mcp-token <connectorId>` at MCP-connect time; the
 * CLI reads the connector's OAuth record from the SAME safeStorage-encrypted
 * vault the app uses and mints a fresh Bearer.
 *
 * CRUCIAL DIFFERENCE from wos-metric: this CLI must DECRYPT the vault, which
 * requires electron `safeStorage` (the OS keychain). Plain `node` cannot do
 * that. So the shim runs the bundle under THIS app's Electron binary with
 * `ELECTRON_RUN_AS_NODE=1` — a node runtime where `require('electron').safeStorage`
 * is the real keychain-backed object. WOS_USERDATA_DIR is baked in so the CLI
 * points at the same secrets.json.
 *
 * The bin dir (userData/bin) is ALREADY on the agent PATH (see handlers/agent.ts),
 * and headersHelperPath() returns the shim's absolute path for the .mcp.json.
 * Idempotent; best-effort — failures are logged, never fatal.
 */

/** Source dir holding mcp-token-cli.cjs. Override with WOS_MCP_TOKEN_DIR (e2e/dev). */
function resourceDir(): string {
  const override = process.env['WOS_MCP_TOKEN_DIR']
  if (override) return override
  return app.isPackaged
    ? path.join(process.resourcesPath, 'wos-mcp-token')
    : path.join(app.getAppPath(), 'resources', 'wos-mcp-token')
}

/** Absolute path of the installed shim — used as the .mcp.json headersHelper. */
export function mcpTokenBinPath(): string {
  return path.join(app.getPath('userData'), 'bin', 'wos-mcp-token')
}

/** The full headersHelper command for a connector: `<abs shim> <connectorId>`. */
export function headersHelperCommand(connectorId: string): string {
  return `${mcpTokenBinPath()} ${connectorId}`
}

/**
 * POSIX shim that runs the bundle under Electron-as-Node (so safeStorage works),
 * with the userData dir + CLI path baked in.
 */
function shimSource(cliPath: string, electronBin: string, userDataDir: string): string {
  return `#!/bin/sh
# wos-mcp-token — remote-OAuth MCP headersHelper. Auto-generated; do not edit.
CLI="${cliPath}"
ELECTRON="${electronBin}"
export WOS_USERDATA_DIR="${userDataDir}"
# Run under Electron's node runtime so require('electron').safeStorage decrypts
# the vault with the OS keychain. Never print secrets; on any failure the CLI
# prints {} and exits non-zero.
export ELECTRON_RUN_AS_NODE=1
exec "$ELECTRON" "$CLI" "$@"
`
}

export function installMcpTokenCli(): void {
  try {
    const cliPath = path.join(resourceDir(), 'mcp-token-cli.cjs')
    if (!fs.existsSync(cliPath)) {
      console.warn('[mcp-token-cli] mcp-token-cli.cjs not found at', cliPath, '— skipping install')
      return
    }
    const binDir = path.join(app.getPath('userData'), 'bin')
    fs.mkdirSync(binDir, { recursive: true })
    const shimPath = path.join(binDir, 'wos-mcp-token')
    fs.writeFileSync(shimPath, shimSource(cliPath, process.execPath, app.getPath('userData')), { mode: 0o755 })
    fs.chmodSync(shimPath, 0o755)
  } catch (err) {
    console.warn('[mcp-token-cli] install failed:', (err as Error).message)
  }
}
