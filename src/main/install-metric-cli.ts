import { app } from 'electron'
import fs from 'fs'
import path from 'path'

/**
 * Installs the `wos-metric` CLI shim onto the agent's PATH — the metric sibling
 * of installComponentCli() (component-cli.ts) / installDocgen() (docgen.ts).
 *
 * The agent (claude CLI) reads/updates/propagates live metrics by running
 * `wos-metric`, a POSIX shim we drop into userData/bin. That bin dir is ALREADY
 * on the agent PATH (see handlers/agent.ts + agent-pty.ts, which prepend
 * docgenBinDir()), so installing the shim is all that's needed — no PATH change.
 *
 * The shim resolves `node` and runs a single self-contained CJS bundle
 * (resources/wos-metric/metric-cli.cjs, built by scripts/build-metric-cli.mjs
 * and shipped OUTSIDE the asar via extraResources, exactly like component-cli).
 * The CLI reuses the app's engine-free stores + writers against the SAME
 * userData JSON files (dir baked into the shim via WOS_USERDATA_DIR).
 * Idempotent; best-effort — failures are logged, never fatal.
 */

/** Source dir holding metric-cli.cjs. Override with WOS_METRIC_DIR (e2e/dev). */
function resourceDir(): string {
  const override = process.env['WOS_METRIC_DIR']
  if (override) return override
  return app.isPackaged
    ? path.join(process.resourcesPath, 'wos-metric')
    : path.join(app.getAppPath(), 'resources', 'wos-metric')
}

/** POSIX shim that resolves Node and runs the CLI with the userData dir baked in. */
function shimSource(cliPath: string, userDataDir: string): string {
  return `#!/bin/sh
# wos-metric — Workspace OS live-metric CLI. Auto-generated; do not edit.
CLI="${cliPath}"
export WOS_USERDATA_DIR="${userDataDir}"
NODE=""
for c in node /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
  if command -v "$c" >/dev/null 2>&1; then NODE="$(command -v "$c")"; break; fi
done
if [ -z "$NODE" ]; then
  echo "ERROR: Node.js is required for wos-metric but was not found." >&2
  exit 3
fi
exec "$NODE" "$CLI" "$@"
`
}

export function installMetricCli(): void {
  try {
    const cliPath = path.join(resourceDir(), 'metric-cli.cjs')
    if (!fs.existsSync(cliPath)) {
      console.warn('[metric-cli] metric-cli.cjs not found at', cliPath, '— skipping install')
      return
    }
    const binDir = path.join(app.getPath('userData'), 'bin')
    fs.mkdirSync(binDir, { recursive: true })
    const shimPath = path.join(binDir, 'wos-metric')
    fs.writeFileSync(shimPath, shimSource(cliPath, app.getPath('userData')), { mode: 0o755 })
    fs.chmodSync(shimPath, 0o755)
  } catch (err) {
    console.warn('[metric-cli] install failed:', (err as Error).message)
  }
}
