import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

let workspaceRoot = ''
vi.mock('../workspace-root', () => ({
  getWorkspaceRoot: () => workspaceRoot || null,
}))

// The index is a native SQLite module: stood in for, so only the handlers are under test.
const index = vi.hoisted(() => ({
  indexNow: vi.fn(async (_paths: readonly string[]) => {}),
  resolveNote: vi.fn((_name: string, _from: string): string | null => null),
}))
vi.mock('./search', () => index)

import { registerNotesHandlers } from './notes'
import { IPC } from '../ipc-channels'
import { IpcValidationError } from '../ipc-validator'

const handlers = new Map<string, (...a: unknown[]) => unknown>()
const ipcMain = { handle: (c: string, h: (...a: unknown[]) => unknown) => void handlers.set(c, h) }
const invoke = async <T = { path: string; created: boolean }>(c: string, ...a: unknown[]): Promise<T> => {
  const h = handlers.get(c)
  if (!h) throw new Error(`no handler for ${c}`)
  return (await h({}, ...a)) as T
}

registerNotesHandlers(ipcMain as never)

let dir: string
beforeEach(() => {
  index.indexNow.mockClear()
  index.resolveNote.mockReset().mockReturnValue(null)
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-notes-'))
  workspaceRoot = dir
})
afterEach(() => {
  vi.useRealTimers()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('notes:daily', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 0, 5, 23, 30)) // local time, late evening
  })

  it('creates today’s note, named by the local date', async () => {
    const r = await invoke(IPC.NOTES_DAILY)
    expect(r).toEqual({ path: path.join(dir, 'Daily', '2026-01-05.md'), created: true })
    expect(fs.readFileSync(r.path, 'utf-8')).toBe('# 2026-01-05\n\n')
  })

  it('opens the existing note without touching it', async () => {
    const file = path.join(dir, 'Daily', '2026-01-05.md')
    fs.mkdirSync(path.dirname(file))
    fs.writeFileSync(file, 'what I wrote this morning')
    await expect(invoke(IPC.NOTES_DAILY)).resolves.toEqual({ path: file, created: false })
    expect(fs.readFileSync(file, 'utf-8')).toBe('what I wrote this morning')
  })

  it('needs an open workspace', async () => {
    workspaceRoot = ''
    await expect(invoke(IPC.NOTES_DAILY)).rejects.toBeInstanceOf(IpcValidationError)
  })

  it('refuses a Daily folder that leads outside the workspace', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-notes-out-'))
    // A junction needs no privilege on Windows and is a directory symlink elsewhere.
    fs.symlinkSync(outside, path.join(dir, 'Daily'), 'junction')
    await expect(invoke(IPC.NOTES_DAILY)).rejects.toBeInstanceOf(IpcValidationError)
    expect(fs.readdirSync(outside)).toEqual([])
    fs.rmSync(outside, { recursive: true, force: true })
  })
})

describe('notes:create-from-link', () => {
  const create = (name: unknown, from?: unknown) => invoke(IPC.NOTES_CREATE_FROM_LINK, name, from)

  it('creates the note beside the note that links to it', async () => {
    fs.mkdirSync(path.join(dir, 'ideas'))
    const from = path.join(dir, 'ideas', 'source.md')
    fs.writeFileSync(from, '[[Next Step]]')
    const r = await create(' Next Step ', from)
    expect(r).toEqual({ path: path.join(dir, 'ideas', 'Next Step.md'), created: true })
    expect(fs.readFileSync(r.path, 'utf-8')).toBe('# Next Step\n\n')
  })

  it('creates it at the top of the workspace when no note is named', async () => {
    await expect(create('Loose end')).resolves.toEqual({ path: path.join(dir, 'Loose end.md'), created: true })
    await expect(create('Other', null)).resolves.toMatchObject({ created: true })
  })

  it('indexes the note before answering, so the link resolves at once', async () => {
    const r = await create('Resolved now')
    expect(index.indexNow).toHaveBeenCalledWith([r.path])
  })

  it('never overwrites a note that is already there', async () => {
    const file = path.join(dir, 'Kept.md')
    fs.writeFileSync(file, 'mine')
    await expect(create('Kept')).resolves.toEqual({ path: file, created: false })
    expect(fs.readFileSync(file, 'utf-8')).toBe('mine')
  })

  it('opens the note the link already resolves to elsewhere', async () => {
    const there = path.join(dir, 'Only one.md')
    fs.writeFileSync(there, 'mine')
    index.resolveNote.mockReturnValue(there)
    fs.mkdirSync(path.join(dir, 'sub'))
    await expect(create('only one', path.join(dir, 'sub', 'x.md'))).resolves.toEqual({ path: there, created: false })
    expect(fs.readdirSync(path.join(dir, 'sub'))).toEqual([])
  })

  it('creates the note when the index still remembers a deleted one', async () => {
    index.resolveNote.mockReturnValue(path.join(dir, 'gone', 'Back.md'))
    await expect(create('Back')).resolves.toEqual({ path: path.join(dir, 'Back.md'), created: true })
  })

  it.each([
    42, '', '   ', '../escape', 'a/b', 'a\\b', '..', '.hidden', 'trailing.', 'a:b', 'what?', 'line\nbreak', 'a[b]', 'a#b', 'a|b',
    'CON', 'nul.txt', 'x'.repeat(201),
  ])('refuses the name %j', async (name) => {
    await expect(create(name)).rejects.toBeInstanceOf(IpcValidationError)
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('refuses a linking note outside the workspace', async () => {
    await expect(create('Fine', path.join(dir, '..', 'elsewhere', 'a.md'))).rejects.toBeInstanceOf(IpcValidationError)
    await expect(create('Fine', 7)).rejects.toBeInstanceOf(IpcValidationError)
    // The root itself is not a note: its folder is outside.
    await expect(create('Fine', dir)).rejects.toBeInstanceOf(IpcValidationError)
  })
})
