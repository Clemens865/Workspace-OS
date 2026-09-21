import { app } from 'electron'
import fs from 'fs'
import path from 'path'

/**
 * Installs the `wos-collection` CLI shim onto the agent's PATH — the collection
 * sibling of installMetricCli() (install-metric-cli.ts) / installComponentCli()
 * (component-cli.ts) / installDocgen() (docgen.ts).
 *
 * The agent (claude CLI) reads/creates/refreshes/syncs live collections by
 * running `wos-collection`, a POSIX shim we drop into userData/bin. That bin dir
 * is ALREADY on the agent PATH (see handlers/agent.ts + agent-pty.ts, which
 * prepend docgenBinDir()), so installing the shim is all that's needed — no PATH
 * change.
 *
 * The shim resolves `node` and runs a single self-contained CJS bundle
 * (resources/wos-collection/collection-cli.cjs, built by
 * scripts/build-collection-cli.mjs and shipped OUTSIDE the asar via
 * extraResources, exactly like metric-cli). The CLI reuses the app's engine-free
 * stores + writers/readers against the SAME userData JSON files (dir baked into
 * the shim via WOS_USERDATA_DIR). Idempotent; best-effort — failures are logged,
 * never fatal.
 */

/** Source dir holding collection-cli.cjs. Override with WOS_COLLECTION_DIR (e2e/dev). */
function resourceDir(): string {
  const override = process.env['WOS_COLLECTION_DIR']
  if (override) return override
  return app.isPackaged
    ? path.join(process.resourcesPath, 'wos-collection')
    : path.join(app.getAppPath(), 'resources', 'wos-collection')
}

/** POSIX shim that resolves Node and runs the CLI with the userData dir baked in. */
function shimSource(cliPath: string, userDataDir: string): string {
  return `#!/bin/sh
# wos-collection — Workspace OS live-collection CLI. Auto-generated; do not edit.
CLI="${cliPath}"
export WOS_USERDATA_DIR="${userDataDir}"
NODE=""
for c in node /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
  if command -v "$c" >/dev/null 2>&1; then NODE="$(command -v "$c")"; break; fi
done
if [ -z "$NODE" ]; then
  echo "ERROR: Node.js is required for wos-collection but was not found." >&2
  exit 3
fi
exec "$NODE" "$CLI" "$@"
`
}

export function installCollectionCli(): void {
  try {
    const cliPath = path.join(resourceDir(), 'collection-cli.cjs')
    if (!fs.existsSync(cliPath)) {
      console.warn('[collection-cli] collection-cli.cjs not found at', cliPath, '— skipping install')
      return
    }
    const binDir = path.join(app.getPath('userData'), 'bin')
    fs.mkdirSync(binDir, { recursive: true })
    const shimPath = path.join(binDir, 'wos-collection')
    fs.writeFileSync(shimPath, shimSource(cliPath, app.getPath('userData')), { mode: 0o755 })
    fs.chmodSync(shimPath, 0o755)
  } catch (err) {
    console.warn('[collection-cli] install failed:', (err as Error).message)
  }
}
