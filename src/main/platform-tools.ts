import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

/**
 * Where command-line tools live and how child processes find them, per
 * platform. On macOS and Linux every function returns what the call sites
 * used before (same directories, same order, ':' separator, login-shell
 * fallback); Windows gets its own directories, ';' and `where.exe`.
 */

const isWin = (): boolean => process.platform === 'win32'

/** Where Windows installs put CLIs (native installers, WinGet) besides PATH. */
export function windowsToolDirs(): string[] {
  const home = os.homedir()
  const local = process.env['LOCALAPPDATA'] || path.join(home, 'AppData', 'Local')
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files'
  // WinGet links portable packages (Claude Code) per user, or machine-wide when installed with --scope machine.
  return [path.join(home, '.local', 'bin'), path.join(local, 'Microsoft', 'WinGet', 'Links'), path.join(programFiles, 'WinGet', 'Links')]
}

/** The common tool directories appended after the app's own (`first`), then the inherited PATH. */
export function seededPath(first: string[]): string {
  const home = os.homedir()
  const common = isWin() ? windowsToolDirs() : [path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
  return [...first, ...common, process.env['PATH'] ?? ''].join(path.delimiter)
}

/**
 * A child environment with PATH set. Windows treats variable names
 * case-insensitively but a plain object copy keeps the original `Path` key, so
 * adding `PATH` would leave two; drop every case variant first.
 */
export function envWithPath(base: NodeJS.ProcessEnv | Record<string, string | undefined>, value: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue
    if (isWin() && k.toLowerCase() === 'path') continue
    out[k] = v
  }
  out['PATH'] = value
  return out
}

export interface FindToolOptions {
  /** Absolute candidates checked on macOS/Linux, in order, after the env override. */
  posixCandidates: string[]
  /** Ask the login shell (`command -v`) when no candidate exists. macOS/Linux only. */
  shellFallback?: boolean
}

/** Where WinGet unpacks portable packages for the current user. */
export function wingetPackagesDir(): string {
  const local = process.env['LOCALAPPDATA'] || path.join(os.homedir(), 'AppData', 'Local')
  return path.join(local, 'Microsoft', 'WinGet', 'Packages')
}

/**
 * `<name>.exe` at the top of a WinGet package folder, e.g. Claude Code's
 * Packages\Anthropic.ClaudeCode_<source>\claude.exe. Without Developer Mode or
 * admin rights WinGet cannot create the Links symlink; it adds the package
 * folder to the user PATH instead, which an app started before the install
 * does not see.
 */
export function findInWingetPackages(packagesDir: string, name: string): string | null {
  let entries: string[]
  try {
    entries = fs.readdirSync(packagesDir).sort()
  } catch {
    return null
  }
  for (const entry of entries) {
    const candidate = path.join(packagesDir, entry, `${name}.exe`)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Finds a CLI: the env override (e.g. CLAUDE_BIN) when it exists, else the
 * platform's usual places. On Windows only `.exe` files are returned: Node
 * refuses to spawn `.cmd`/`.bat` without a shell.
 */
export function findTool(name: string, envVar: string, opts: FindToolOptions): string | null {
  const override = process.env[envVar]
  if (override && fs.existsSync(override)) return override
  if (isWin()) {
    for (const dir of windowsToolDirs()) {
      const candidate = path.join(dir, `${name}.exe`)
      if (fs.existsSync(candidate)) return candidate
    }
    try {
      const out = execFileSync('where.exe', [name], { encoding: 'utf-8', windowsHide: true })
      const exe = out.split(/\r?\n/).map((s) => s.trim()).find((s) => /\.exe$/i.test(s))
      if (exe) return exe
    } catch {
      /* not on PATH */
    }
    return findInWingetPackages(wingetPackagesDir(), name)
  }
  for (const c of opts.posixCandidates) if (fs.existsSync(c)) return c
  if (opts.shellFallback) {
    try {
      const found = execFileSync(process.env['SHELL'] ?? '/bin/zsh', ['-lc', `command -v ${name}`], { encoding: 'utf-8' }).trim()
      if (found) return found
    } catch {
      /* fall through */
    }
  }
  return null
}

/**
 * cmd.exe arguments that run a .cmd file (Node will not spawn one directly).
 * Spawn `cmd.exe` with these and `windowsVerbatimArguments: true`; /s strips the
 * outer quotes, leaving each argument quoted. Arguments must not contain quotes.
 */
export function cmdFileArgs(cmdFile: string, args: string[]): string[] {
  const quoted = [cmdFile, ...args].map((a) => `"${a.replace(/"/g, '')}"`).join(' ')
  return ['/d', '/s', '/c', `"${quoted}"`]
}

/** Quote a value for a `set "K=V"` line in a .cmd file. */
const cmdValue = (v: string): string => v.replace(/%/g, '%%').replace(/"/g, '')

/**
 * Windows shims for a Node CLI bundle, run on the app's own executable as Node
 * (ELECTRON_RUN_AS_NODE=1), so no system Node.js is needed:
 * `<name>.cmd` for PowerShell and Command Prompt, and an extensionless POSIX
 * shim for Git Bash (Claude Code's Bash tool on Windows).
 */
export function writeWindowsNodeShims(binDir: string, name: string, cliPath: string, env: Record<string, string>, note: string): void {
  const electron = process.execPath
  const cmd = [
    '@echo off',
    `rem ${name} - ${note} Auto-generated; do not edit.`,
    'setlocal',
    ...Object.entries(env).map(([k, v]) => `set "${k}=${cmdValue(v)}"`),
    'set "ELECTRON_RUN_AS_NODE=1"',
    `"${electron}" "${cliPath}" %*`,
    '',
  ].join('\r\n')
  fs.writeFileSync(path.join(binDir, `${name}.cmd`), cmd)
  const fwd = (p: string): string => p.replace(/\\/g, '/')
  const sh = [
    '#!/bin/sh',
    `# ${name} - ${note} Auto-generated; do not edit.`,
    ...Object.entries(env).map(([k, v]) => `export ${k}="${fwd(v)}"`),
    'export ELECTRON_RUN_AS_NODE=1',
    `exec "${fwd(electron)}" "${fwd(cliPath)}" "$@"`,
    '',
  ].join('\n')
  fs.writeFileSync(path.join(binDir, name), sh, { mode: 0o755 })
}
