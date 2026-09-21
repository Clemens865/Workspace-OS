import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Point the workspace root at a temp dir so validateFilePath has a concrete
// boundary to enforce for the refreshForFile traversal test.
let workspaceRoot = ''
vi.mock('../workspace-root', () => ({
  getWorkspaceRoot: () => workspaceRoot || null,
}))

// The metrics singleton reads app.getPath('userData'); give it a temp dir so
// the accepted-path case (which reaches metrics.list()) doesn't crash.
let userDataDir = ''
vi.mock('electron', () => ({
  default: { app: { getPath: () => userDataDir } },
  app: { getPath: () => userDataDir },
}))

import { registerMetricHandlers } from './metrics'
import { IpcValidationError } from '../ipc-validator'

/** A minimal IpcMain that records handlers so a test can invoke them directly. */
function fakeIpcMain(): { ipcMain: { handle: (c: string, h: (...a: unknown[]) => unknown) => void }; invoke: (c: string, ...a: unknown[]) => Promise<unknown> } {
  const handlers = new Map<string, (...a: unknown[]) => unknown>()
  return {
    ipcMain: { handle: (c, h) => void handlers.set(c, h) },
    invoke: async (c, ...a) => {
      const h = handlers.get(c)
      if (!h) throw new Error(`no handler for ${c}`)
      return h({}, ...a) // first arg is the ipc event (unused here)
    },
  }
}

describe('metric:refreshForFile path-traversal rejection', () => {
  let dir: string
  // Register the handlers ONCE — `ipcHandle` guards against duplicate channel
  // registration process-wide, so re-registering per test would throw.
  const f = fakeIpcMain()
  registerMetricHandlers(f.ipcMain as never)
  const invoke = f.invoke

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-metrics-h-'))
    workspaceRoot = dir
    userDataDir = dir // metrics.json lives here; empty until a metric is created
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('rejects a "../../etc/passwd" traversal path (escapes workspace root)', async () => {
    await expect(invoke('metric:refreshForFile', path.join(dir, '..', '..', 'etc', 'passwd'))).rejects.toBeInstanceOf(
      IpcValidationError
    )
  })

  it('rejects an absolute path outside the workspace root', async () => {
    await expect(invoke('metric:refreshForFile', '/etc/passwd')).rejects.toBeInstanceOf(IpcValidationError)
  })

  it('rejects an empty / non-string path', async () => {
    await expect(invoke('metric:refreshForFile', '')).rejects.toBeInstanceOf(IpcValidationError)
    await expect(invoke('metric:refreshForFile', 123)).rejects.toBeInstanceOf(IpcValidationError)
  })

  it('accepts an in-workspace path (no metrics sourced there → empty result)', async () => {
    const inside = path.join(dir, 'book.xlsx')
    fs.writeFileSync(inside, 'x')
    const res = await invoke('metric:refreshForFile', inside)
    expect(res).toEqual([])
  })
})
