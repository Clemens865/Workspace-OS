import { app } from 'electron'
import fs from 'fs'
import path from 'path'

/**
 * Installs the `wos-case` CLI shim onto the agent's PATH — the case sibling of
 * installMetricCli() / installCollectionCli().
 *
 * The agent creates/updates the workspace's cases by running `wos-case`, a POSIX
 * shim dropped into userData/bin (ALREADY on the agent PATH — see agent-pty.ts).
 * Unlike the metric/collection CLIs, cases live in the WORKSPACE, not userData,
 * so nothing is baked into the shim: it inherits `WOS_WORKSPACE` from the
 * terminal env the app already injects, and resolves `Cases/` under it at run
 * time. Idempotent; best-effort — failures are logged, never fatal.
 */

/** Source dir holding case-cli.cjs. Override with WOS_CASE_DIR (e2e/dev). */
function resourceDir(): string {
  const override = process.env['WOS_CASE_DIR']
  if (override) return override
  return app.isPackaged ? path.join(process.resourcesPath, 'wos-case') : path.join(app.getAppPath(), 'resources', 'wos-case')
}

/** POSIX shim that resolves Node and runs the CLI; WOS_WORKSPACE is inherited. */
function shimSource(cliPath: string): string {
  return `#!/bin/sh
# wos-case — Workspace OS case CLI. Auto-generated; do not edit.
CLI="${cliPath}"
NODE=""
for c in node /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
  if command -v "$c" >/dev/null 2>&1; then NODE="$(command -v "$c")"; break; fi
done
if [ -z "$NODE" ]; then
  echo "ERROR: Node.js is required for wos-case but was not found." >&2
  exit 3
fi
exec "$NODE" "$CLI" "$@"
`
}

export function installCaseCli(): void {
  try {
    const cliPath = path.join(resourceDir(), 'case-cli.cjs')
    if (!fs.existsSync(cliPath)) {
      console.warn('[case-cli] case-cli.cjs not found at', cliPath, '— skipping install')
      return
    }
    const binDir = path.join(app.getPath('userData'), 'bin')
    fs.mkdirSync(binDir, { recursive: true })
    const shimPath = path.join(binDir, 'wos-case')
    fs.writeFileSync(shimPath, shimSource(cliPath), { mode: 0o755 })
    fs.chmodSync(shimPath, 0o755)
  } catch (err) {
    console.warn('[case-cli] install failed:', (err as Error).message)
  }
}
