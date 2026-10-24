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
  return path.join(venvDir(), process.platform === 'win32' ? 'Scripts' : 'bin')
}

/** Windows `wos-gen` shims: a .cmd for PowerShell/Command Prompt and a POSIX one for Git Bash. */
function windowsShimSources(genPath: string): { cmd: string; sh: string } {
  const venv = venvDir()
  const cmd = [
    '@echo off',
    'rem wos-gen - Workspace OS office document generator. Auto-generated; do not edit.',
    'setlocal',
    `set "VENV=${venv}"`,
    `set "GEN=${genPath}"`,
    'set "PY=%VENV%\\Scripts\\python.exe"',
    'if exist "%PY%" goto run',
    'set "SYS="',
    // The py launcher comes with python.org and WinGet Python; a bare `python` may be the Store alias.
    'where py >nul 2>nul && set "SYS=py -3"',
    'if defined SYS goto mkvenv',
    'where python >nul 2>nul && set "SYS=python"',
    'if defined SYS goto mkvenv',
    'echo ERROR: Python 3 is required for document generation but was not found. Install it with: winget install --id Python.Python.3.13 --exact 1>&2',
    'exit /b 3',
    ':mkvenv',
    'echo Setting up the document generator (one-time, ~15s)... 1>&2',
    '%SYS% -m venv "%VENV%" 1>&2 || (echo ERROR: could not create the Python environment. 1>&2 & exit /b 3)',
    '"%PY%" -m pip install --quiet --disable-pip-version-check --upgrade pip 1>&2',
    '"%PY%" -m pip install --quiet --disable-pip-version-check python-pptx openpyxl python-docx 1>&2 || (echo ERROR: could not install document libraries, check your network. 1>&2 & exit /b 3)',
    ':run',
    'if "%~1"=="--provision" exit /b 0',
    '"%PY%" "%GEN%" %*',
    '',
  ].join('\r\n')
  const fwd = (x: string): string => x.replace(/\\/g, '/')
  const cmdPath = fwd(path.join(docgenBinDir(), 'wos-gen.cmd'))
  // Git Bash: hand over to the .cmd so provisioning lives in one place.
  const sh = `#!/bin/sh\n# wos-gen - Workspace OS office document generator. Auto-generated; do not edit.\nexec cmd.exe //d //c "$(cygpath -w '${cmdPath}')" "$@"\n`
  return { cmd, sh }
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
    const shimPath = path.join(binDir, process.platform === 'win32' ? 'wos-gen.cmd' : 'wos-gen')
    if (process.platform === 'win32') {
      const { cmd, sh } = windowsShimSources(genPath)
      fs.writeFileSync(shimPath, cmd)
      fs.writeFileSync(path.join(binDir, 'wos-gen'), sh, { mode: 0o755 })
    } else {
      fs.writeFileSync(shimPath, shimSource(genPath), { mode: 0o755 })
      fs.chmodSync(shimPath, 0o755)
    }

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
  if (fs.existsSync(path.join(docgenVenvBinDir(), process.platform === 'win32' ? 'python.exe' : 'python3'))) return // already warm
  try {
    // stdin='pipe' (not 'ignore'): 'ignore' on stdin can fail with EBADF in a
    // Finder-launched packaged app. fd1/fd2 ignored is fine.
    // A .cmd needs cmd.exe on Windows (Node will not spawn it directly).
    const [cmd, args] = process.platform === 'win32'
      ? ['cmd.exe', ['/d', '/s', '/c', `"${shimPath}" --provision`]]
      : [shimPath, ['--provision']]
    const child = spawn(cmd, args, {
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsVerbatimArguments: process.platform === 'win32',
      windowsHide: true,
    })
    child.stdin?.end()
    child.unref()
  } catch {
    // best-effort — the shim will provision on first real use anyway
  }
}
