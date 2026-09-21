import { app } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'

/**
 * Component generation backing the `office-component` Claude skill. The agent
 * (claude CLI) creates reusable PowerPoint components by running `wos-component`,
 * a Node shim we drop on its PATH (the same userData/bin the doc-gen shim uses).
 * It writes into the app's component store, so generated components appear in the
 * Components panel. Local-only — no API calls.
 */

function resourceDir(): string {
  const override = process.env['WOS_COMPONENT_DIR']
  if (override) return override
  return app.isPackaged
    ? path.join(process.resourcesPath, 'office-component')
    : path.join(app.getAppPath(), 'resources', 'office-component')
}

function componentsStorePath(): string {
  return path.join(app.getPath('userData'), 'components.json')
}

/** POSIX shim that resolves Node and runs the CLI with the store path baked in. */
function shimSource(cliPath: string, storePath: string): string {
  return `#!/bin/sh
# wos-component — Workspace OS component generator. Auto-generated; do not edit.
CLI="${cliPath}"
export WOS_COMPONENTS_PATH="${storePath}"
NODE=""
for c in node /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
  if command -v "$c" >/dev/null 2>&1; then NODE="$(command -v "$c")"; break; fi
done
if [ -z "$NODE" ]; then
  echo "ERROR: Node.js is required for wos-component but was not found." >&2
  exit 3
fi
exec "$NODE" "$CLI" "$@"
`
}

/** Idempotent startup install: write the shim + refresh the skill. Best-effort. */
export function installComponentCli(): void {
  try {
    const resDir = resourceDir()
    const cliPath = path.join(resDir, 'component-cli.cjs')
    if (!fs.existsSync(cliPath)) {
      console.warn('[component-cli] component-cli.cjs not found at', cliPath, '— skipping install')
      return
    }

    const binDir = path.join(app.getPath('userData'), 'bin')
    fs.mkdirSync(binDir, { recursive: true })
    const shimPath = path.join(binDir, 'wos-component')
    fs.writeFileSync(shimPath, shimSource(cliPath, componentsStorePath()), { mode: 0o755 })
    fs.chmodSync(shimPath, 0o755)

    const skillDir = path.join(os.homedir(), '.claude', 'skills', 'office-component')
    fs.mkdirSync(skillDir, { recursive: true })
    for (const f of ['SKILL.md', 'component-cli.cjs']) {
      const src = path.join(resDir, f)
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(skillDir, f))
    }
  } catch (err) {
    console.warn('[component-cli] install failed:', (err as Error).message)
  }
}
