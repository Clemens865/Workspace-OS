import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envWithPath, findTool, seededPath, windowsToolDirs, writeWindowsNodeShims } from './platform-tools'

afterEach(() => vi.unstubAllEnvs())

describe.runIf(process.platform !== 'win32')('macOS and Linux keep the former behaviour', () => {
  it('seeds the same directories in the same order with ":"', () => {
    vi.stubEnv('PATH', '/usr/bin:/bin')
    const home = os.homedir()
    expect(seededPath(['/a', '/b'])).toBe(['/a', '/b', path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin:/bin'].join(':'))
  })
  it('only replaces PATH in the child environment', () => {
    expect(envWithPath({ A: '1', PATH: 'old', Path: 'kept' }, 'new')).toEqual({ A: '1', PATH: 'new', Path: 'kept' })
  })
  it('finds the env override, then the candidates', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-tool-'))
    const bin = path.join(dir, 'tool')
    fs.writeFileSync(bin, '')
    expect(findTool('wos-no-such-tool', 'WOS_NO_SUCH_ENV', { posixCandidates: [bin] })).toBe(bin)
    vi.stubEnv('WOS_TOOL_OVERRIDE', bin)
    expect(findTool('wos-no-such-tool', 'WOS_TOOL_OVERRIDE', { posixCandidates: [] })).toBe(bin)
    expect(findTool('wos-no-such-tool', 'WOS_NO_SUCH_ENV', { posixCandidates: [path.join(dir, 'missing')] })).toBeNull()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe.runIf(process.platform === 'win32')('Windows', () => {
  it('seeds the Windows tool directories with ";"', () => {
    vi.stubEnv('PATH', 'C:\\Windows')
    expect(seededPath(['C:\\a'])).toBe(['C:\\a', ...windowsToolDirs(), 'C:\\Windows'].join(';'))
  })
  it('looks in the per-user and machine-wide WinGet links', () => {
    vi.stubEnv('LOCALAPPDATA', 'C:\\Users\\me\\AppData\\Local')
    vi.stubEnv('ProgramFiles', 'C:\\Program Files')
    expect(windowsToolDirs()).toEqual(expect.arrayContaining([
      'C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Links',
      'C:\\Program Files\\WinGet\\Links',
    ]))
  })
  it('replaces every case variant of PATH', () => {
    expect(envWithPath({ A: '1', Path: 'old' }, 'new')).toEqual({ A: '1', PATH: 'new' })
  })
  it('finds an .exe on PATH through where.exe', () => {
    expect(findTool('cmd', 'WOS_NO_SUCH_ENV', { posixCandidates: [] })?.toLowerCase()).toMatch(/\\cmd\.exe$/)
    expect(findTool('wos-no-such-tool', 'WOS_NO_SUCH_ENV', { posixCandidates: [] })).toBeNull()
  })
  it('writes a .cmd and a Git Bash shim that run the bundle on the app executable', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-shim-'))
    writeWindowsNodeShims(dir, 'wos-demo', 'C:\\app\\demo-cli.cjs', { WOS_USERDATA_DIR: 'C:\\Users\\me\\data' }, 'Demo CLI.')
    const cmd = fs.readFileSync(path.join(dir, 'wos-demo.cmd'), 'utf8')
    expect(cmd).toContain('set "ELECTRON_RUN_AS_NODE=1"')
    expect(cmd).toContain('set "WOS_USERDATA_DIR=C:\\Users\\me\\data"')
    expect(cmd).toContain(`"${process.execPath}" "C:\\app\\demo-cli.cjs" %*`)
    const sh = fs.readFileSync(path.join(dir, 'wos-demo'), 'utf8')
    expect(sh).toContain('export ELECTRON_RUN_AS_NODE=1')
    expect(sh).toContain('"C:/app/demo-cli.cjs" "$@"')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
