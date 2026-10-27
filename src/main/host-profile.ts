import crypto from 'crypto'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { userDataDir } from './userdata-path'

/**
 * Host-specific behaviour, decided once per process: WSL workarounds and the
 * stock-engine CSV fix. On native Linux, macOS and Windows every "auto" value
 * resolves to the app's normal behaviour, so none of this changes them.
 *
 * Precedence: environment variable > `<userData>/host-settings.json` > auto.
 * See docs/LINUX-WSL.md for the settings and why each exists.
 */

export type Toggle = 'auto' | 'on' | 'off'

export interface HostSettings {
  /** Hardware acceleration. auto = off under WSL (WSLg shows a black window), on elsewhere. */
  gpu?: Toggle
  /** Load CSV through LOK's Batch option. auto = on when the engine is the distro's stock LibreOffice. */
  csvSilentLoad?: Toggle
  /** Where a Windows-drive workspace keeps `.workspace-os`. auto = external under WSL. */
  windowsDriveState?: 'auto' | 'external' | 'in-folder'
  /** Snapshot a Windows-drive workspace before each agent run. Default false. */
  windowsDriveCheckpoints?: boolean
  /** How deep to scan a Windows-drive workspace for files an agent run created. Default 1. */
  windowsDriveArtifactDepth?: number
  /** Watch a Windows-drive workspace for file changes. Default false. */
  windowsDriveWatch?: boolean
  /**
   * Windows and Linux: the main window's frame. 'standard' (default) keeps the
   * system title bar; 'clean' hides it and shows minimise, maximise and close
   * when the pointer reaches the top edge. macOS ignores it. Applies at the
   * next start. Set from Settings → Appearance → Window.
   */
  windowStyle?: WindowStyle
  /** Per-workspace settings, keyed by the folder's absolute path. Apply on every platform. */
  workspaces?: Record<string, WorkspaceSettings>
}

export type WindowStyle = 'standard' | 'clean'

export interface WorkspaceSettings {
  /**
   * Folder, relative to the workspace, that holds the app's content folders
   * (Cases/, Work/, Wiki/, Apps/) instead of the workspace root. Default: the root.
   */
  contentRoot?: string
  /**
   * Claude Code hooks during the app's agent and chat runs. 'off' (default, the
   * app's own choice: personal hooks would add noise and side effects to every
   * run), 'project' (only the workspace's .claude/settings*.json hooks; user-level
   * settings are skipped and the user's MCP servers re-added from ~/.claude.json),
   * or 'all' (user and project hooks).
   */
  agentHooks?: AgentHooksMode
}

export type AgentHooksMode = 'off' | 'project' | 'all'

/** The app's default artifact scan depth (artifacts.ts). */
export const DEFAULT_ARTIFACT_DEPTH = 4
const DEFAULT_WINDOWS_DRIVE_ARTIFACT_DEPTH = 1
/** The stock engine location on Linux distributions (apt install libreoffice). */
export const DISTRO_ENGINE_DIR = '/usr/lib/libreoffice/program/'

export function hostSettingsPath(): string {
  return path.join(userDataDir(), 'host-settings.json')
}

let cached: HostSettings | null = null

/** Reads host-settings.json once. A missing or broken file means "all auto". */
export function hostSettings(): HostSettings {
  if (cached) return cached
  try {
    const raw = JSON.parse(fs.readFileSync(hostSettingsPath(), 'utf-8')) as unknown
    cached = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as HostSettings) : {}
  } catch {
    cached = {}
  }
  return cached
}

/** Test hook: forget the cached file. */
export function resetHostSettingsCache(): void {
  cached = null
}

/**
 * Writes one or more host settings, keeping every other key in the file as it
 * was (the file is also edited by hand). Rereads the file first, so a hand edit
 * made while the app runs is not lost.
 */
export function setHostSettings(patch: Partial<HostSettings>): void {
  let current: Record<string, unknown> = {}
  try {
    const raw = JSON.parse(fs.readFileSync(hostSettingsPath(), 'utf-8')) as unknown
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) current = raw as Record<string, unknown>
  } catch {
    /* missing or broken: start from nothing */
  }
  fs.mkdirSync(path.dirname(hostSettingsPath()), { recursive: true })
  fs.writeFileSync(hostSettingsPath(), JSON.stringify({ ...current, ...patch }, null, 2) + '\n', 'utf-8')
  cached = null
}

/** The window style setting: WOS_WINDOW_STYLE > host-settings.json > 'standard'. */
export function windowStyle(): WindowStyle {
  const env = process.env['WOS_WINDOW_STYLE']
  if (env === 'standard' || env === 'clean') return env
  return hostSettings().windowStyle === 'clean' ? 'clean' : 'standard'
}

let wslCached: boolean | null = null

/** True when running inside WSL (env var, or the kernel string as a fallback). */
export function isWsl(): boolean {
  if (process.platform !== 'linux') return false
  if (process.env['WSL_DISTRO_NAME']) return true
  if (wslCached === null) {
    try {
      wslCached = /microsoft/i.test(fs.readFileSync('/proc/version', 'utf-8'))
    } catch {
      wslCached = false
    }
  }
  return wslCached
}

/** Test hook: pin the /proc/version answer (null = detect again). */
export function setWslCacheForTest(value: boolean | null): void {
  wslCached = value
}

/** A folder on a Windows drive as WSL mounts it (/mnt/c, /mnt/d, …). False outside WSL. */
export function isWindowsDrivePath(p: string): boolean {
  return isWsl() && /^\/mnt\/[a-z](\/|$)/i.test(path.resolve(p))
}

function envToggle(name: string): Toggle | undefined {
  const v = process.env[name]
  if (v === undefined || v === '') return undefined
  return /^(1|on|true|yes)$/i.test(v) ? 'on' : /^(0|off|false|no)$/i.test(v) ? 'off' : undefined
}

function toggle(name: string, setting: Toggle | undefined, auto: () => boolean): boolean {
  const t = envToggle(name) ?? setting ?? 'auto'
  return t === 'auto' ? auto() : t === 'on'
}

/** Hardware acceleration on? (WOS_GPU / `gpu`) */
export function hardwareAcceleration(): boolean {
  return toggle('WOS_GPU', hostSettings().gpu, () => !isWsl())
}

/**
 * Load CSV with LOK's Batch option? (WOS_CSV_SILENT_LOAD / `csvSilentLoad`)
 * The stock engine lacks scripts/lok/csv-filteroptions-headless.patch, so its
 * CSV import dialog request deadlocks a headless load; Batch loads silently.
 */
export function csvSilentLoad(engineInstallDir: string): boolean {
  // Windows: every engine is a stock LibreOffice build (none carries the patch).
  return toggle('WOS_CSV_SILENT_LOAD', hostSettings().csvSilentLoad, () =>
    process.platform === 'win32' ||
    (process.platform === 'linux' && path.resolve(engineInstallDir) === path.resolve(DISTRO_ENGINE_DIR)))
}

/** Does this workspace keep its `.workspace-os` store outside the folder? (WOS_WINDOWS_DRIVE_STATE / `windowsDriveState`) */
export function stateIsExternal(root: string): boolean {
  if (!isWindowsDrivePath(root)) return false
  const mode = process.env['WOS_WINDOWS_DRIVE_STATE'] || hostSettings().windowsDriveState || 'auto'
  return mode !== 'in-folder'
}

/** Where the workspace store lives: `<root>/.workspace-os`, or a per-folder directory under userData. */
export function appStateDir(root: string): string {
  const resolved = path.resolve(root)
  if (!stateIsExternal(resolved)) return path.join(resolved, '.workspace-os')
  const slug = path.basename(resolved).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace'
  const id = crypto.createHash('sha1').update(resolved).digest('hex').slice(0, 12)
  return path.join(userDataDir(), 'workspaces', `${slug}-${id}`)
}

/** Snapshot before agent runs? Always on except for Windows-drive folders. (WOS_WINDOWS_DRIVE_CHECKPOINTS / `windowsDriveCheckpoints`) */
export function checkpointsEnabled(root: string): boolean {
  if (!isWindowsDrivePath(root)) return true
  const env = envToggle('WOS_WINDOWS_DRIVE_CHECKPOINTS')
  if (env) return env === 'on'
  return hostSettings().windowsDriveCheckpoints === true
}

/**
 * Watch this workspace for changes? Always on except for Windows-drive folders.
 * (WOS_WINDOWS_DRIVE_WATCH / `windowsDriveWatch`) On Linux, Node's recursive
 * fs.watch walks the whole tree synchronously on the main thread before it
 * filters anything; over 9P that froze the app for minutes, and inotify never
 * sees changes made from Windows anyway.
 */
export function treeWatchEnabled(root: string): boolean {
  if (!isWindowsDrivePath(root)) return true
  const env = envToggle('WOS_WINDOWS_DRIVE_WATCH')
  if (env) return env === 'on'
  return hostSettings().windowsDriveWatch === true
}

/** How deep the per-run artifact scan walks this workspace. (WOS_WINDOWS_DRIVE_ARTIFACT_DEPTH / `windowsDriveArtifactDepth`) */
export function artifactScanDepth(root: string): number {
  if (!isWindowsDrivePath(root)) return DEFAULT_ARTIFACT_DEPTH
  const env = Number.parseInt(process.env['WOS_WINDOWS_DRIVE_ARTIFACT_DEPTH'] ?? '', 10)
  if (Number.isInteger(env) && env >= -1) return env
  const s = hostSettings().windowsDriveArtifactDepth
  return Number.isInteger(s) && (s as number) >= -1 ? (s as number) : DEFAULT_WINDOWS_DRIVE_ARTIFACT_DEPTH
}

/** A safe workspace-relative folder ("" for the root), or null when the value is unusable. */
export function normalizeContentRoot(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string' || path.isAbsolute(value) || /^[a-z]:/i.test(value)) return null
  const parts = value.split(/[/\\]+/).filter((x) => x && x !== '.')
  if (parts.some((x) => x === '..' || x.startsWith('.'))) return null
  return parts.join('/')
}

/**
 * The workspace-relative folder holding Cases/, Work/, Wiki/ and Apps/ ("" = the
 * workspace root, the default). Set per folder in host-settings.json:
 * `"workspaces": { "/abs/folder": { "contentRoot": "Some/Folder" } }`.
 */
export function contentRootRel(root: string): string {
  const resolved = path.resolve(root)
  const rel = normalizeContentRoot(workspaceEntry(resolved)?.contentRoot)
  if (rel === null) {
    console.warn(`[host-profile] ignoring contentRoot for ${resolved}: must be a relative folder without .. or dot-folders`)
    return ''
  }
  return rel
}

/** Absolute folder that holds the content folders. */
export function contentRoot(root: string): string {
  const rel = contentRootRel(root)
  return rel ? path.join(path.resolve(root), ...rel.split('/')) : path.resolve(root)
}

/** Workspace-relative POSIX path of one content folder, e.g. "Cases" or "Projects/wos/Cases". */
export function contentRel(root: string, folder: string): string {
  const rel = contentRootRel(root)
  return rel ? `${rel}/${folder}` : folder
}

/** The system-prompt sentence naming a configured content root; '' when the content folders sit at the root. */
export function contentRootLine(root: string): string {
  const rel = contentRootRel(root)
  if (!rel) return ''
  return `In this workspace the app's own folders Cases/, Work/, Wiki/, Apps/ and Artifacts/ are inside ${rel}/ (for example ${rel}/Cases/). Wherever these instructions name one of those folders, use it under ${rel}/; never create them at the workspace root.`
}

function workspaceEntry(root: string): WorkspaceSettings | undefined {
  const resolved = path.resolve(root)
  const all = hostSettings().workspaces
  if (!all) return undefined
  const direct = all[resolved] ?? all[resolved + '/']
  if (direct || process.platform !== 'win32') return direct
  // Windows paths are case-insensitive and may be written with / or \ and a trailing separator.
  const key = (p: string): string => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase()
  const want = key(resolved)
  const hit = Object.keys(all).find((k) => key(k) === want)
  return hit ? all[hit] : undefined
}

/** Hooks mode for agent and chat runs in this workspace. (WOS_AGENT_HOOKS / `workspaces[root].agentHooks`) */
export function agentHooksMode(root: string | null): AgentHooksMode {
  const valid = (v: unknown): v is AgentHooksMode => v === 'off' || v === 'project' || v === 'all'
  const env = process.env['WOS_AGENT_HOOKS']
  if (valid(env)) return env
  const set = root ? workspaceEntry(root)?.agentHooks : undefined
  return valid(set) ? set : 'off'
}

/**
 * Claude Code arguments for the hooks mode, besides `--settings`:
 * 'project' loads project and local settings only and re-adds the user's MCP
 * servers by pointing --mcp-config at ~/.claude.json (no copy, so no secrets
 * written anywhere). Skipped when the run already has a strict MCP config.
 */
export function agentHooksArgs(mode: AgentHooksMode, strictMcp: boolean, home = os.homedir()): string[] {
  if (mode !== 'project') return []
  const userMcp = path.join(home, '.claude.json')
  return ['--setting-sources', 'project,local', ...(!strictMcp && fs.existsSync(userMcp) ? ['--mcp-config', userMcp] : [])]
}
