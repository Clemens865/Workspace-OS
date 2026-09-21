import { app } from 'electron'
import fs from 'fs'
import path from 'path'

/**
 * Installs the `wos-action` CLI shim onto the agent's PATH — the AGENT→ACTION
 * bridge client, sibling of installMetricCli() / installCollectionCli().
 *
 * The agent (claude CLI) EXECUTES per-surface Workspace-OS actions by running
 * `wos-action`, a POSIX shim we drop into userData/bin. That bin dir is ALREADY
 * on the agent PATH (see handlers/agent.ts, which prepends docgenBinDir()), so
 * installing the shim is all that's needed — no PATH change.
 *
 * Unlike wos-mcp-token, this CLI is PURE NODE (no safeStorage, no app stores):
 * it just opens the unix socket whose path arrives via the WOS_AGENT_SOCK env
 * var the agent spawn sets. So the shim resolves plain `node` (like wos-metric)
 * and runs the self-contained action-cli.cjs. Idempotent; best-effort.
 */

/** Source dir holding action-cli.cjs. Override with WOS_ACTION_DIR (e2e/dev). */
function resourceDir(): string {
  const override = process.env['WOS_ACTION_DIR']
  if (override) return override
  return app.isPackaged
    ? path.join(process.resourcesPath, 'wos-action')
    : path.join(app.getAppPath(), 'resources', 'wos-action')
}

/** POSIX shim that resolves Node and runs the CLI. Paths are app-controlled. */
function shimSource(cliPath: string): string {
  return `#!/bin/sh
# wos-action — Workspace OS agent→action CLI. Auto-generated; do not edit.
CLI="${cliPath}"
NODE=""
for c in node /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
  if command -v "$c" >/dev/null 2>&1; then NODE="$(command -v "$c")"; break; fi
done
if [ -z "$NODE" ]; then
  echo "ERROR: Node.js is required for wos-action but was not found." >&2
  exit 3
fi
exec "$NODE" "$CLI" "$@"
`
}

export function installActionCli(): void {
  try {
    const cliPath = path.join(resourceDir(), 'action-cli.cjs')
    if (!fs.existsSync(cliPath)) {
      console.warn('[action-cli] action-cli.cjs not found at', cliPath, '— skipping install')
      return
    }
    const binDir = path.join(app.getPath('userData'), 'bin')
    fs.mkdirSync(binDir, { recursive: true })
    const shimPath = path.join(binDir, 'wos-action')
    fs.writeFileSync(shimPath, shimSource(cliPath), { mode: 0o755 })
    fs.chmodSync(shimPath, 0o755)
  } catch (err) {
    console.warn('[action-cli] install failed:', (err as Error).message)
  }
}
