import { describe, it, expect, beforeEach, vi } from 'vitest'
import os from 'os'

// ptyHost pulls in workspace-root + docgen, which import electron's `app`.
// Mock it so the module tree imports under the node (vitest) ABI — and, crucially,
// so importing ptyHost NEVER loads node-pty's native binary (it's lazy-required
// inside createSession and swapped here via __setPtyLoader).
vi.mock('electron', () => ({
  default: { app: { getPath: () => os.tmpdir() } },
  app: { getPath: () => os.tmpdir() },
}))

import fs from 'fs'
import path from 'path'

import {
  __setPtyLoader,
  checkSpawnHelpers,
  createSession,
  write,
  resize,
  kill,
  shutdownTerminals,
  sessionCount,
} from './ptyHost'

/** A fake node-pty package dir with the helper copies node-pty may pick. */
function makePtyDir(layout: Record<string, number | null>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-pty-'))
  for (const [sub, mode] of Object.entries(layout)) {
    if (mode === null) continue
    const p = path.join(dir, sub, 'spawn-helper')
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, '#!/bin/sh\n')
    fs.chmodSync(p, mode)
  }
  return dir
}

const prebuilt = `prebuilds/${process.platform}-${process.arch}`

/** A fake node-pty process capturing the wiring — no native module involved. */
function makeFakePty() {
  const state = {
    written: [] as string[],
    resized: [] as [number, number][],
    killed: false,
    dataCb: null as null | ((d: string) => void),
    exitCb: null as null | ((e: { exitCode: number }) => void),
    spawnedWith: null as null | { file: string; cwd: string; env: NodeJS.ProcessEnv },
  }
  const module = {
    spawn: (file: string, _args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => {
      state.spawnedWith = { file, cwd: opts.cwd, env: opts.env }
      return {
        pid: 4242,
        onData: (cb: (d: string) => void) => (state.dataCb = cb),
        onExit: (cb: (e: { exitCode: number }) => void) => (state.exitCb = cb),
        write: (d: string) => state.written.push(d),
        resize: (c: number, r: number) => state.resized.push([c, r]),
        kill: () => (state.killed = true),
      }
    },
  }
  return { state, module }
}

describe('ptyHost', () => {
  beforeEach(() => {
    shutdownTerminals()
  })

  it('createSession spawns via the (mocked) loader and returns the pid', () => {
    const { state, module } = makeFakePty()
    __setPtyLoader(() => module)
    const dataOut: string[] = []
    const res = createSession('s1', { onData: (d) => dataOut.push(d), onExit: () => {} })
    expect(res.pid).toBe(4242)
    expect(sessionCount()).toBe(1)
    // Harness env travels with the shell.
    expect(state.spawnedWith?.env.WOS_CAN_DO).toContain('run-shell')
    // Data streams through to the handler.
    state.dataCb?.('hello')
    expect(dataOut).toEqual(['hello'])
  })

  it('write and resize forward to the process', () => {
    const { state, module } = makeFakePty()
    __setPtyLoader(() => module)
    createSession('s2', { onData: () => {}, onExit: () => {} })
    write('s2', 'ls\n')
    resize('s2', 120, 40)
    expect(state.written).toEqual(['ls\n'])
    expect(state.resized).toEqual([[120, 40]])
  })

  it('exit callback fires and drops the session', () => {
    const { state, module } = makeFakePty()
    __setPtyLoader(() => module)
    let code: number | null = null
    createSession('s3', { onData: () => {}, onExit: (c) => (code = c) })
    state.exitCb?.({ exitCode: 0 })
    expect(code).toBe(0)
    expect(sessionCount()).toBe(0)
  })

  it('kill terminates the process and removes the session', () => {
    const { state, module } = makeFakePty()
    __setPtyLoader(() => module)
    createSession('s4', { onData: () => {}, onExit: () => {} })
    kill('s4')
    expect(state.killed).toBe(true)
    expect(sessionCount()).toBe(0)
  })

  it('surfaces a helpful error when node-pty is unavailable', () => {
    __setPtyLoader(() => {
      throw new Error('binary missing')
    })
    expect(() => createSession('s5', { onData: () => {}, onExit: () => {} })).toThrow(
      /node-pty is not available/,
    )
  })

  it('rejects a duplicate session id', () => {
    const { module } = makeFakePty()
    __setPtyLoader(() => module)
    createSession('dup', { onData: () => {}, onExit: () => {} })
    expect(() => createSession('dup', { onData: () => {}, onExit: () => {} })).toThrow(/already exists/)
  })
})

describe('spawn-helper check', () => {
  beforeEach(() => {
    shutdownTerminals()
  })

  it('restores a missing execute bit on the prebuilt fallback helper', () => {
    // The shipped layout: build/Release is 755, prebuilds/* is 644.
    const dir = makePtyDir({ 'build/Release': 0o755, [prebuilt]: 0o644 })
    const report = checkSpawnHelpers(dir)
    const primary = report.find((h) => h.dir === 'build/Release')
    const fallback = report.find((h) => h.dir === prebuilt)
    expect(primary).toMatchObject({ exists: true, executable: true, fixed: false })
    expect(fallback).toMatchObject({ exists: true, executable: true, fixed: true })
    expect(fs.statSync(fallback!.path).mode & 0o111).not.toBe(0)
    // A second pass finds nothing to do.
    expect(checkSpawnHelpers(dir).every((h) => !h.fixed)).toBe(true)
  })

  it('reports helpers that are absent without inventing them', () => {
    const dir = makePtyDir({ 'build/Release': 0o755 })
    const report = checkSpawnHelpers(dir)
    expect(report.find((h) => h.dir === prebuilt)).toMatchObject({ exists: false, executable: false })
    expect(fs.existsSync(path.join(dir, prebuilt, 'spawn-helper'))).toBe(false)
  })

  it('a spawn failure names the shell, cwd and helper state instead of a bare message', () => {
    const dir = makePtyDir({ 'build/Release': 0o644, [prebuilt]: null })
    __setPtyLoader(
      () => ({
        spawn: () => {
          throw new Error('posix_spawnp failed.')
        },
      }),
      () => dir,
    )
    let message = ''
    try {
      createSession('s6', { onData: () => {}, onExit: () => {} }, { cwd: '/nonexistent/wos-cwd' })
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toMatch(/posix_spawnp failed/)
    expect(message).toMatch(/cwd=\/nonexistent\/wos-cwd \(missing\)/)
    expect(message).toContain(`node-pty=${dir}`)
    // The 644 helper was repaired before the spawn, and the report says so.
    expect(message).toMatch(/build\/Release=fixed/)
    expect(message).toMatch(new RegExp(`${prebuilt.replace(/[/\\-]/g, '\\$&')}=missing`))
    expect(sessionCount()).toBe(0)
  })

  it('runs the check even when the loader is mocked, only if a dir resolver is given', () => {
    const { state, module } = makeFakePty()
    const dir = makePtyDir({ 'build/Release': 0o644 })
    __setPtyLoader(() => module, () => dir)
    createSession('s7', { onData: () => {}, onExit: () => {} })
    expect(state.spawnedWith).not.toBeNull()
    expect(fs.statSync(path.join(dir, 'build/Release/spawn-helper')).mode & 0o111).not.toBe(0)
  })
})
