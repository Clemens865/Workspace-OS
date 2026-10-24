import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appStateDir, artifactScanDepth, checkpointsEnabled, csvSilentLoad, DISTRO_ENGINE_DIR, hardwareAcceleration,
  agentHooksArgs, agentHooksMode, contentRel, contentRoot, contentRootLine, contentRootRel, normalizeContentRoot,
  hostSettingsPath, isWindowsDrivePath, resetHostSettingsCache, setWslCacheForTest, stateIsExternal, treeWatchEnabled,
} from './host-profile'

const realPlatform = process.platform
const asPlatform = (p: NodeJS.Platform): void => { Object.defineProperty(process, 'platform', { value: p }) }
let userData: string

function host(kind: 'wsl' | 'linux' | 'darwin'): void {
  asPlatform(kind === 'darwin' ? 'darwin' : 'linux')
  vi.stubEnv('WSL_DISTRO_NAME', kind === 'wsl' ? 'Ubuntu' : '')
  setWslCacheForTest(kind === 'wsl')
}
function settings(json: object): void {
  fs.writeFileSync(hostSettingsPath(), JSON.stringify(json))
  resetHostSettingsCache()
}

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-host-'))
  vi.stubEnv('WOS_USERDATA_DIR', userData)
  for (const k of ['WOS_GPU', 'WOS_CSV_SILENT_LOAD', 'WOS_WINDOWS_DRIVE_STATE', 'WOS_WINDOWS_DRIVE_CHECKPOINTS', 'WOS_WINDOWS_DRIVE_ARTIFACT_DEPTH', 'WOS_WINDOWS_DRIVE_WATCH', 'WOS_AGENT_HOOKS']) vi.stubEnv(k, '')
  resetHostSettingsCache()
})
afterEach(() => {
  asPlatform(realPlatform)
  vi.unstubAllEnvs()
  setWslCacheForTest(null)
  resetHostSettingsCache()
  fs.rmSync(userData, { recursive: true, force: true })
})

describe('native Linux: no workaround applies', () => {
  it('keeps the app defaults, even for a /mnt path', () => {
    host('linux')
    expect(hardwareAcceleration()).toBe(true)
    expect(isWindowsDrivePath('/mnt/d/vault')).toBe(false)
    expect(stateIsExternal('/mnt/d/vault')).toBe(false)
    expect(appStateDir('/mnt/d/vault')).toBe('/mnt/d/vault/.workspace-os')
    expect(checkpointsEnabled('/mnt/d/vault')).toBe(true)
    expect(artifactScanDepth('/mnt/d/vault')).toBe(4)
    expect(treeWatchEnabled('/mnt/d/vault')).toBe(true)
  })
  it('ignores Windows-drive settings', () => {
    host('linux')
    settings({ windowsDriveState: 'external', windowsDriveCheckpoints: false, windowsDriveArtifactDepth: 0, windowsDriveWatch: false })
    expect(treeWatchEnabled('/mnt/d/vault')).toBe(true)
    expect(appStateDir('/mnt/d/vault')).toBe('/mnt/d/vault/.workspace-os')
    expect(checkpointsEnabled('/mnt/d/vault')).toBe(true)
    expect(artifactScanDepth('/mnt/d/vault')).toBe(4)
  })
  it('uses silent CSV load only with the stock distro engine', () => {
    host('linux')
    expect(csvSilentLoad(DISTRO_ENGINE_DIR)).toBe(true)
    expect(csvSilentLoad('/opt/patched-lo/program/')).toBe(false)
  })
})

describe('Windows: stock engine', () => {
  it('loads CSV silently by default (no Windows build carries the patch)', () => {
    asPlatform('win32')
    vi.stubEnv('WSL_DISTRO_NAME', '')
    setWslCacheForTest(false)
    expect(csvSilentLoad('C:\\Program Files\\LibreOffice\\program\\')).toBe(true)
    settings({ csvSilentLoad: 'off' })
    expect(csvSilentLoad('C:\\Program Files\\LibreOffice\\program\\')).toBe(false)
  })
})

describe('macOS: unchanged', () => {
  it('keeps GPU, in-folder state and snapshots', () => {
    host('darwin')
    expect(hardwareAcceleration()).toBe(true)
    expect(csvSilentLoad(DISTRO_ENGINE_DIR)).toBe(false)
    expect(stateIsExternal('/mnt/d/x')).toBe(false)
  })
})

describe('WSL', () => {
  it('turns GPU off and moves Windows-drive state out of the folder by default', () => {
    host('wsl')
    expect(hardwareAcceleration()).toBe(false)
    expect(isWindowsDrivePath('/mnt/d/Notes/vault')).toBe(true)
    const dir = appStateDir('/mnt/d/Notes/vault')
    expect(dir.startsWith(path.join(userData, 'workspaces', 'vault-'))).toBe(true)
    expect(appStateDir('/mnt/d/Notes/vault')).toBe(dir) // stable per folder
    expect(appStateDir('/mnt/d/Other/vault')).not.toBe(dir)
    expect(checkpointsEnabled('/mnt/d/Notes/vault')).toBe(false)
    expect(artifactScanDepth('/mnt/d/Notes/vault')).toBe(1)
    expect(treeWatchEnabled('/mnt/d/Notes/vault')).toBe(false)
    expect(treeWatchEnabled('/home/me/ws')).toBe(true)
  })
  it('leaves Linux-disk folders alone', () => {
    host('wsl')
    expect(appStateDir('/home/me/ws')).toBe('/home/me/ws/.workspace-os')
    expect(checkpointsEnabled('/home/me/ws')).toBe(true)
    expect(artifactScanDepth('/home/me/ws')).toBe(4)
    expect(isWindowsDrivePath('/mnt/wslg/share')).toBe(false)
  })
  it('honours host-settings.json', () => {
    host('wsl')
    settings({ gpu: 'on', windowsDriveState: 'in-folder', windowsDriveCheckpoints: true, windowsDriveArtifactDepth: -1, windowsDriveWatch: true })
    expect(treeWatchEnabled('/mnt/d/v')).toBe(true)
    expect(hardwareAcceleration()).toBe(true)
    expect(appStateDir('/mnt/d/v')).toBe('/mnt/d/v/.workspace-os')
    expect(checkpointsEnabled('/mnt/d/v')).toBe(true)
    expect(artifactScanDepth('/mnt/d/v')).toBe(-1)
  })
  it('lets environment variables override the file', () => {
    host('wsl')
    settings({ gpu: 'on', windowsDriveCheckpoints: true })
    vi.stubEnv('WOS_GPU', '0')
    vi.stubEnv('WOS_WINDOWS_DRIVE_CHECKPOINTS', 'off')
    vi.stubEnv('WOS_WINDOWS_DRIVE_ARTIFACT_DEPTH', '2')
    expect(hardwareAcceleration()).toBe(false)
    expect(checkpointsEnabled('/mnt/d/v')).toBe(false)
    expect(artifactScanDepth('/mnt/d/v')).toBe(2)
  })
  it('treats a broken settings file as all-auto', () => {
    host('wsl')
    fs.writeFileSync(hostSettingsPath(), '{ not json')
    resetHostSettingsCache()
    expect(hardwareAcceleration()).toBe(false)
    expect(stateIsExternal('/mnt/c/x')).toBe(true)
  })
})

describe('content root (all platforms)', () => {
  it('defaults to the workspace root, with no prompt line', () => {
    host('linux')
    expect(contentRootRel('/home/me/ws')).toBe('')
    expect(contentRoot('/home/me/ws')).toBe('/home/me/ws')
    expect(contentRel('/home/me/ws', 'Cases')).toBe('Cases')
    expect(contentRootLine('/home/me/ws')).toBe('')
  })
  it('puts the content folders under the configured folder, per workspace', () => {
    for (const kind of ['linux', 'wsl', 'darwin'] as const) {
      host(kind)
      settings({ workspaces: { '/data/vault': { contentRoot: '50-PROJECTS/workspace-os/' } } })
      expect(contentRoot('/data/vault')).toBe('/data/vault/50-PROJECTS/workspace-os')
      expect(contentRel('/data/vault', 'Apps')).toBe('50-PROJECTS/workspace-os/Apps')
      expect(contentRootLine('/data/vault')).toMatch(/inside 50-PROJECTS\/workspace-os\//)
      expect(contentRoot('/data/other')).toBe('/data/other')
    }
  })
  it('rejects unsafe values and falls back to the root', () => {
    expect(normalizeContentRoot('../escape')).toBeNull()
    expect(normalizeContentRoot('/abs/path')).toBeNull()
    expect(normalizeContentRoot('C:\\x')).toBeNull()
    expect(normalizeContentRoot('a/.hidden')).toBeNull()
    expect(normalizeContentRoot('./a//b/')).toBe('a/b')
    host('linux')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    settings({ workspaces: { '/data/vault': { contentRoot: '../x' } } })
    expect(contentRoot('/data/vault')).toBe('/data/vault')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('agent hooks (all platforms)', () => {
  it('stays off by default and for unknown values', () => {
    host('linux')
    expect(agentHooksMode('/data/vault')).toBe('off')
    expect(agentHooksMode(null)).toBe('off')
    settings({ workspaces: { '/data/vault': { agentHooks: 'sometimes' } } })
    expect(agentHooksMode('/data/vault')).toBe('off')
  })
  it('follows the workspace entry, and the env var over it', () => {
    host('darwin')
    settings({ workspaces: { '/data/vault': { agentHooks: 'project' } } })
    expect(agentHooksMode('/data/vault')).toBe('project')
    expect(agentHooksMode('/data/other')).toBe('off')
    vi.stubEnv('WOS_AGENT_HOOKS', 'all')
    expect(agentHooksMode('/data/other')).toBe('all')
  })
  it('builds the project-only arguments, re-adding user MCP servers unless the run is strict', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-home-'))
    fs.writeFileSync(path.join(home, '.claude.json'), '{"mcpServers":{}}')
    expect(agentHooksArgs('off', false, home)).toEqual([])
    expect(agentHooksArgs('all', false, home)).toEqual([])
    expect(agentHooksArgs('project', false, home)).toEqual(['--setting-sources', 'project,local', '--mcp-config', path.join(home, '.claude.json')])
    expect(agentHooksArgs('project', true, home)).toEqual(['--setting-sources', 'project,local'])
    fs.rmSync(home, { recursive: true, force: true })
    expect(agentHooksArgs('project', false, home)).toEqual(['--setting-sources', 'project,local'])
  })
})
