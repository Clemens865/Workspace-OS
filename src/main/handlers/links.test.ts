import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Point the workspace root at a temp dir so validateFilePath has a concrete
// boundary to enforce for the links:* handlers' coercion tests.
let workspaceRoot = ''
vi.mock('../workspace-root', () => ({
  getWorkspaceRoot: () => workspaceRoot || null,
}))

// ensureIndex() opens a SQLite file under app.getPath('userData') — give it a
// temp dir so the accepted-path case (which reaches the index) doesn't crash.
let userDataDir = ''
vi.mock('electron', () => ({
  default: { app: { getPath: () => userDataDir } },
  app: { getPath: () => userDataDir },
}))

import { registerSearchHandlers, shutdownSearch } from './search'
import { IPC } from '../ipc-channels'
import { IpcValidationError } from '../ipc-validator'

/** A minimal IpcMain that records handlers so a test can invoke them directly. */
function fakeIpcMain(): {
  ipcMain: { handle: (c: string, h: (...a: unknown[]) => unknown) => void }
  invoke: (c: string, ...a: unknown[]) => Promise<unknown>
} {
  const handlers = new Map<string, (...a: unknown[]) => unknown>()
  return {
    ipcMain: { handle: (c, h) => void handlers.set(c, h) },
    invoke: async (c, ...a) => {
      const h = handlers.get(c)
      if (!h) throw new Error(`no handler for ${c}`)
      return h({}, ...a)
    },
  }
}

describe('links:* handler path coercion', () => {
  let dir: string
  // The index DB is a module singleton created on first use from userDataDir —
  // keep it in one stable dir for the whole suite; the workspace root varies.
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-links-db-'))
  userDataDir = dbDir
  // Register ONCE — ipcHandle guards against duplicate channel registration.
  const f = fakeIpcMain()
  registerSearchHandlers(f.ipcMain as never)
  const invoke = f.invoke

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-links-h-'))
    workspaceRoot = dir
    userDataDir = dbDir
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })
  afterAll(async () => {
    await shutdownSearch()
    fs.rmSync(dbDir, { recursive: true, force: true })
  })

  it('rejects a non-string path (backlinks)', async () => {
    await expect(invoke(IPC.LINKS_BACKLINKS, 123)).rejects.toBeInstanceOf(IpcValidationError)
    await expect(invoke(IPC.LINKS_BACKLINKS, '')).rejects.toBeInstanceOf(IpcValidationError)
  })

  it('rejects a traversal path that escapes the workspace root (backlinks)', async () => {
    await expect(
      invoke(IPC.LINKS_BACKLINKS, path.join(dir, '..', '..', 'etc', 'passwd')),
    ).rejects.toBeInstanceOf(IpcValidationError)
    await expect(invoke(IPC.LINKS_BACKLINKS, '/etc/passwd')).rejects.toBeInstanceOf(IpcValidationError)
  })

  it('rejects an out-of-root path for outgoing links', async () => {
    await expect(invoke(IPC.LINKS_OUTGOING, '/etc/hosts')).rejects.toBeInstanceOf(IpcValidationError)
  })

  it('rejects a non-string name for resolve', async () => {
    await expect(invoke(IPC.LINKS_RESOLVE, 42)).rejects.toBeInstanceOf(IpcValidationError)
    await expect(invoke(IPC.LINKS_RESOLVE, '')).rejects.toBeInstanceOf(IpcValidationError)
  })

  it('accepts an in-workspace path (no links there → empty result)', async () => {
    const inside = path.join(dir, 'note.md')
    await expect(invoke(IPC.LINKS_BACKLINKS, inside)).resolves.toEqual([])
    await expect(invoke(IPC.LINKS_OUTGOING, inside)).resolves.toEqual([])
    await expect(invoke(IPC.LINKS_RELATED, inside)).resolves.toEqual([])
  })

  it('rejects an out-of-root path for related notes', async () => {
    await expect(invoke(IPC.LINKS_RELATED, '/etc/hosts')).rejects.toBeInstanceOf(IpcValidationError)
    await expect(invoke(IPC.LINKS_RELATED, 123)).rejects.toBeInstanceOf(IpcValidationError)
  })

  it('resolves a name (null when no file matches)', async () => {
    await expect(invoke(IPC.LINKS_RESOLVE, 'Nonexistent')).resolves.toBeNull()
  })

  it('lists stubs (empty on a fresh index)', async () => {
    await expect(invoke(IPC.LINKS_STUBS)).resolves.toEqual([])
  })

  it('returns a graph shape (no input to validate)', async () => {
    await expect(invoke(IPC.LINKS_GRAPH)).resolves.toEqual({
      nodes: expect.any(Array),
      edges: expect.any(Array),
      truncated: expect.any(Boolean),
    })
  })
})
