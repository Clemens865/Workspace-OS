import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cmdFileArgs, envWithPath, withTrailingSeparator, findInWingetPackages, findTool, seededPath, windowsToolDirs, writeWindowsNodeShims } from './platform-tools'

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

describe('withTrailingSeparator', () => {
  it('adds one separator only when missing', () => {
    expect(withTrailingSeparator('C:\\LO\\program\\')).toBe('C:\\LO\\program\\')
    expect(withTrailingSeparator('/usr/lib/libreoffice/program/')).toBe('/usr/lib/libreoffice/program/')
    expect(withTrailingSeparator('C:\\LO\\program')).toBe('C:\\LO\\program' + path.sep)
  })
})

describe('cmdFileArgs', () => {
  it('quotes the .cmd and every argument inside one /s /c string', () => {
    expect(cmdFileArgs('C:\\Users\\A B\\wos-gen.cmd', ['docx', '--out', 'C:\\t\\o.docx'])).toEqual([
      '/d', '/s', '/c', '""C:\\Users\\A B\\wos-gen.cmd" "docx" "--out" "C:\\t\\o.docx""',
    ])
  })
})

describe('WinGet package folders', () => {
  it('finds <name>.exe at the top of a package folder, and nothing deeper', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-winget-'))
    fs.mkdirSync(path.join(root, 'Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe'))
    fs.writeFileSync(path.join(root, 'Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe', 'claude.exe'), '')
    fs.mkdirSync(path.join(root, 'Other.Tool_x', 'bin'), { recursive: true })
    fs.writeFileSync(path.join(root, 'Other.Tool_x', 'bin', 'codex.exe'), '')
    expect(findInWingetPackages(root, 'claude')).toBe(path.join(root, 'Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe', 'claude.exe'))
    expect(findInWingetPackages(root, 'codex')).toBeNull()
    expect(findInWingetPackages(path.join(root, 'missing'), 'claude')).toBeNull()
    fs.rmSync(root, { recursive: true, force: true })
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
  it('runs a .cmd with spaced arguments through cmd.exe', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos cmd '))
    const cmd = path.join(dir, 'echo args.cmd')
    fs.writeFileSync(cmd, '@echo off\r\necho [%~1] [%~2]\r\n')
    const out = spawnSync('cmd.exe', cmdFileArgs(cmd, ['first arg', path.join(dir, 'x.docx')]), { encoding: 'utf8', windowsVerbatimArguments: true }).stdout
    expect(out.trim()).toBe(`[first arg] [${path.join(dir, 'x.docx')}]`)
    fs.rmSync(dir, { recursive: true, force: true })
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
