import { app } from 'electron'
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

/**
 * Office document generation backing the `office-docgen` Claude skill.
 *
 * The agent (claude CLI) creates real .pptx/.xlsx/.docx by running `wos-gen`,
 * a shim we drop on its PATH. The shim resolves Python with a *hybrid* strategy:
 * a cached managed venv (built from the user's system python3 on first use),
 * with a clear error if no Python 3 is available. This keeps generation on the
 * user's subscription (the agent just runs a local CLI) with no API calls.
 */

/** Source dir holding gen.py + SKILL.md. Override with WOS_DOCGEN_DIR (e2e/dev). */
export function docgenResourceDir(): string {
  const override = process.env['WOS_DOCGEN_DIR']
  if (override) return override
  return app.isPackaged
    ? path.join(process.resourcesPath, 'office-docgen')
    : path.join(app.getAppPath(), 'resources', 'office-docgen')
}

/** Directory we add to the agent's PATH so it can find `wos-gen`. */
export function docgenBinDir(): string {
  return path.join(app.getPath('userData'), 'bin')
}

function venvDir(): string {
  return path.join(app.getPath('userData'), 'pyenv')
}

/**
 * The managed venv's bin dir. Prepended to the agent's PATH so that `python3`
 * (and `pip`) resolve to the interpreter that has python-pptx/openpyxl/
 * python-docx — letting installed Python skills (e.g. the Yorizon skills)
 * import the office libraries.
 */
export function docgenVenvBinDir(): string {
  return path.join(venvDir(), 'bin')
}

/** The POSIX shell shim. Paths are app-controlled and quoted, so safe. */
function shimSource(genPath: string): string {
  const venv = venvDir()
  return `#!/bin/sh
# wos-gen — Workspace OS office document generator. Auto-generated; do not edit.
VENV="${venv}"
GEN="${genPath}"
PY="$VENV/bin/python3"
if [ ! -x "$PY" ]; then
  SYS=""
  for c in python3 python3.13 python3.12 python3.11 /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
    if command -v "$c" >/dev/null 2>&1; then SYS="$(command -v "$c")"; break; fi
  done
  if [ -z "$SYS" ]; then
    echo "ERROR: Python 3 is required for document generation but was not found. Install Python 3 (e.g. 'brew install python') and try again." >&2
    exit 3
  fi
  echo "Setting up the document generator (one-time, ~15s)…" >&2
  "$SYS" -m venv "$VENV" >&2 2>&1 || { echo "ERROR: could not create the Python environment." >&2; exit 3; }
  "$VENV/bin/python3" -m pip install --quiet --disable-pip-version-check --upgrade pip >&2 2>&1
  "$VENV/bin/python3" -m pip install --quiet --disable-pip-version-check python-pptx openpyxl python-docx >&2 2>&1 \\
    || { echo "ERROR: could not install document libraries (check your network)." >&2; exit 3; }
fi
# '--provision' just ensures the environment exists (used to warm it at startup).
if [ "$1" = "--provision" ]; then exit 0; fi
exec "$PY" "$GEN" "$@"
`
}

/**
 * Idempotent startup install: (1) write the `wos-gen` shim into userData/bin,
 * (2) refresh the office-docgen skill into ~/.claude/skills so the agent can
 * discover it. Best-effort — failures are logged, never fatal.
 */
export function installDocgen(): void {
  try {
    const resDir = docgenResourceDir()
    const genPath = path.join(resDir, 'gen.py')
    if (!fs.existsSync(genPath)) {
      console.warn('[docgen] gen.py not found at', genPath, '— skipping install')
      return
    }

    // 1. wos-gen shim on PATH.
    const binDir = docgenBinDir()
    fs.mkdirSync(binDir, { recursive: true })
    const shimPath = path.join(binDir, 'wos-gen')
    fs.writeFileSync(shimPath, shimSource(genPath), { mode: 0o755 })
    fs.chmodSync(shimPath, 0o755)

    // 2. Install the skill (SKILL.md + gen.py + pptx_design.py) into the user's
    //    global skills. gen.py imports pptx_design.py as a sibling, so both must
    //    land together for the skill copy to run standalone.
    const skillDir = path.join(os.homedir(), '.claude', 'skills', 'office-docgen')
    fs.mkdirSync(skillDir, { recursive: true })
    for (const f of ['SKILL.md', 'gen.py', 'pptx_design.py']) {
      const src = path.join(resDir, f)
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(skillDir, f))
    }

    // 3. Warm the Python env in the background so the first skill/doc request
    //    isn't blocked by venv creation + pip install.
    provisionVenvInBackground(shimPath)
  } catch (err) {
    console.warn('[docgen] install failed:', (err as Error).message)
  }
}

/** Builds the managed venv ahead of time (detached, best-effort) if absent. */
function provisionVenvInBackground(shimPath: string): void {
  if (fs.existsSync(path.join(docgenVenvBinDir(), 'python3'))) return // already warm
  try {
    // stdin='pipe' (not 'ignore'): 'ignore' on stdin can fail with EBADF in a
    // Finder-launched packaged app. fd1/fd2 ignored is fine.
    const child = spawn(shimPath, ['--provision'], {
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    child.stdin?.end()
    child.unref()
  } catch {
    // best-effort — the shim will provision on first real use anyway
  }
}
