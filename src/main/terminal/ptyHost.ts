import fs from 'fs'
import os from 'os'
import path from 'path'
import { getWorkspaceRoot } from '../workspace-root'
import { getContextEnv } from '../context/workspaceContext'
import { docgenBinDir, docgenVenvBinDir } from '../docgen'
import { log } from '../crash-reporter'

/**
 * PTY host for the integrated Terminal Dock.
 *
 * node-pty is a NATIVE module. The parent handles `rebuild:electron` for
 * packaging, so a top-level `require('node-pty')` here would load the native
 * binary the moment this file is imported — which breaks `vitest` (node ABI,
 * no rebuilt binary). We therefore LAZY-require node-pty INSIDE `createSession`,
 * guarded by a try/catch, so unit tests can import this module (and swap the
 * loader via `__setPtyLoader`) without ever touching the native binary.
 */

export interface PtyProc {
  pid: number
  onData: (cb: (data: string) => void) => void
  onExit: (cb: (e: { exitCode: number }) => void) => void
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
}

interface PtyModule {
  spawn: (
    file: string,
    args: string[],
    opts: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv },
  ) => PtyProc
}

/** Lazy loader — overridable in tests so no native binary is required. */
let loader: () => PtyModule = () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('node-pty') as PtyModule
}

/** Where node-pty's package dir lives, so the spawn-helper check can find the
 *  same files node-pty itself will pick. Packaged apps keep native files outside
 *  the asar, hence the same `app.asar` → `app.asar.unpacked` rewrite node-pty
 *  applies to its helper path. `null` = unknown (mocked loader): skip the check. */
let ptyDirResolver: () => string | null = () => {
  try {
    return path
      .dirname(require.resolve('node-pty/package.json'))
      .replace('app.asar', 'app.asar.unpacked')
  } catch {
    return null
  }
}

/** Test seam: swap the node-pty loader for a mock (keeps vitest native-free).
 *  Pass `dirResolver` to also exercise the spawn-helper check against a dir. */
export function __setPtyLoader(fn: () => PtyModule, dirResolver: () => string | null = () => null): void {
  loader = fn
  ptyDirResolver = dirResolver
}

export interface HelperReport {
  /** Dir relative to node-pty, in node-pty's own search order. */
  dir: string
  path: string
  exists: boolean
  executable: boolean
  /** True when the execute bit was missing and we restored it. */
  fixed: boolean
}

/** node-pty's native search order (lib/utils.js loadNativeModule). It loads the
 *  first `pty.node` that dlopens and execs the `spawn-helper` BESIDE that file. */
const NATIVE_DIRS = ['build/Release', 'build/Debug', `prebuilds/${process.platform}-${process.arch}`]

/**
 * node-pty does not exec the shell directly: it posix_spawns a tiny `spawn-helper`
 * next to its pty.node, and that helper does setsid/chdir/exec. If the helper
 * file has lost its execute bit, node-pty throws the bare `posix_spawnp failed.`
 * with no path in it (seen 2026-09-15 on a second Mac running the shipped dmg,
 * where node-pty had fallen back to its `prebuilds/` copy, which ships as 644).
 *
 * Check every copy node-pty might pick and restore the bit when the file is
 * writable. Pure over `ptyDir` so it is unit-testable against a temp dir.
 */
export function checkSpawnHelpers(ptyDir: string): HelperReport[] {
  if (process.platform === 'win32') return []
  const out: HelperReport[] = []
  for (const dir of NATIVE_DIRS) {
    const p = path.join(ptyDir, dir, 'spawn-helper')
    let exists = false
    let executable = false
    let fixed = false
    try {
      const st = fs.statSync(p)
      exists = st.isFile()
      executable = exists && (st.mode & 0o111) !== 0
    } catch {
      /* not present in this dir */
    }
    if (exists && !executable) {
      try {
        fs.chmodSync(p, 0o755)
        executable = (fs.statSync(p).mode & 0o111) !== 0
        fixed = executable
      } catch {
        /* read-only volume or not ours: leave it, the report says so */
      }
    }
    out.push({ dir, path: p, exists, executable, fixed })
  }
  return out
}

function describeHelpers(report: HelperReport[]): string {
  if (report.length === 0) return 'unchecked'
  return report
    .map((h) => {
      const state = !h.exists ? 'missing' : !h.executable ? 'NOT-EXECUTABLE' : h.fixed ? 'fixed' : 'ok'
      return `${h.dir}=${state}`
    })
    .join(', ')
}

interface Session {
  proc: PtyProc
  onData: (data: string) => void
  onExit: (code: number) => void
}

const sessions = new Map<string, Session>()

/** Builds an IDE-grade PATH so `claude`, `python3`, `wos-gen` etc. resolve even
 *  when the app was launched from Finder (thin PATH). Mirrors handlers/shell.ts. */
function seedPath(): string {
  const home = os.homedir()
  return [
    docgenVenvBinDir(),
    docgenBinDir(),
    path.join(home, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    process.env['PATH'] ?? '',
  ].join(':')
}

export interface CreateOptions {
  /** Override cwd; defaults to the harness folder → workspace root → home. */
  cwd?: string
  cols?: number
  rows?: number
}

export interface Handlers {
  onData: (data: string) => void
  onExit: (code: number) => void
}

/**
 * Spawn a shell PTY carrying the live workspace harness in its env
 * (WOS_WORKSPACE / WOS_SURFACE / WOS_FOLDER / WOS_OPEN_FILE / WOS_CAN_DO).
 * Returns the pid, or throws if node-pty's native binary isn't available.
 */
export function createSession(
  id: string,
  handlers: Handlers,
  opts: CreateOptions = {},
): { pid: number } {
  if (sessions.has(id)) throw new Error(`terminal session already exists: ${id}`)

  let pty: PtyModule
  try {
    pty = loader()
  } catch (err) {
    throw new Error(
      `node-pty is not available (run \`npm run rebuild:electron\`): ${(err as Error).message}`,
    )
  }

  // Before the first spawn, make sure the helper node-pty will exec is actually
  // executable. Cheap (three stats), and it turns a bare "posix_spawnp failed."
  // into either a silent self-heal or a diagnosable error.
  const ptyDir = ptyDirResolver()
  const helpers = ptyDir ? checkSpawnHelpers(ptyDir) : []
  for (const h of helpers) {
    if (h.fixed) log('warn', `terminal: restored the execute bit on ${h.path}`)
  }

  const isWin = process.platform === 'win32'
  const shell = isWin ? 'powershell.exe' : process.env['SHELL'] ?? '/bin/zsh'
  // `||` throughout: the context env uses '' for "unset", and a '' cwd makes the
  // helper's chdir fail silently so the shell opens in `/`.
  const cwd =
    opts.cwd || getContextEnv().WOS_FOLDER || getWorkspaceRoot() || process.env['HOME'] || os.homedir()

  let proc: PtyProc
  try {
    proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd,
      env: { ...process.env, ...getContextEnv(), PATH: seedPath() },
    })
  } catch (err) {
    // node-pty's own message carries no path. Add everything the next bug
    // report needs: which shell and cwd we asked for, where node-pty lives,
    // and the state of every spawn-helper copy it could have picked.
    const cwdState = fs.existsSync(cwd) ? '' : ' (missing)'
    const detail = `shell=${shell} cwd=${cwd}${cwdState} node-pty=${ptyDir ?? 'unknown'} spawn-helper: ${describeHelpers(helpers)}`
    log('error', `terminal spawn failed: ${detail}`, err)
    throw new Error(`terminal spawn failed: ${(err as Error).message} | ${detail}`)
  }

  const session: Session = { proc, onData: handlers.onData, onExit: handlers.onExit }
  sessions.set(id, session)

  proc.onData((data) => session.onData(data))
  proc.onExit(({ exitCode }) => {
    sessions.delete(id)
    session.onExit(exitCode)
  })

  return { pid: proc.pid }
}

export function write(id: string, data: string): void {
  sessions.get(id)?.proc.write(data)
}

export function resize(id: string, cols: number, rows: number): void {
  sessions.get(id)?.proc.resize(cols, rows)
}

export function kill(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  try {
    s.proc.kill()
  } catch {
    /* already dead */
  }
  sessions.delete(id)
}

/** Kills every live PTY — run on app quit so terminals never outlive the app. */
export function shutdownTerminals(): void {
  for (const id of [...sessions.keys()]) kill(id)
}

/** Test helper. */
export function sessionCount(): number {
  return sessions.size
}
