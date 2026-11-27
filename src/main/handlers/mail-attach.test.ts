import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

/** "Attach a file from the workspace": what the boundary lets into a draft. */

const workspace = vi.hoisted(() => ({ root: '' }))
vi.mock('../workspace-root', async (original) => ({
  ...(await original<typeof import('../workspace-root')>()),
  getWorkspaceRoot: () => workspace.root || null,
}))

vi.mock('electron', () => ({
  default: { app: { getPath: () => os.tmpdir() } },
  app: { getPath: () => os.tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
}))

import { registerMailHandlers } from './mail'
import { IPC } from '../ipc-channels'
import { IpcValidationError } from '../ipc-validator'

const handlers = new Map<string, (...a: unknown[]) => unknown>()
registerMailHandlers({ handle: (c: string, h: (...a: unknown[]) => unknown) => void handlers.set(c, h) } as never)

interface Attached {
  ok: boolean
  value?: { filename: string; content: string }
  error?: { message: string }
}
const attach = async (file: unknown, bytes: unknown = 0, count: unknown = 0): Promise<Attached> =>
  (await handlers.get(IPC.MAIL_ATTACH_WORKSPACE_FILE)!({}, file, bytes, count)) as Attached

const MB = 1024 * 1024

describe('MAIL_ATTACH_WORKSPACE_FILE', () => {
  let outside: string
  beforeEach(() => {
    workspace.root = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-attach-'))
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-attach-out-'))
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret')
  })
  afterEach(() => {
    fs.rmSync(workspace.root, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  })
  const put = (name: string, size: number | string): string => {
    const file = path.join(workspace.root, name)
    fs.writeFileSync(file, typeof size === 'string' ? size : Buffer.alloc(size))
    return file
  }

  it('reads a workspace file as a draft attachment', async () => {
    const out = await attach(put('report.txt', 'hello world'))
    expect(out).toEqual({ ok: true, value: { filename: 'report.txt', content: Buffer.from('hello world').toString('base64') } })
  })

  it('refuses a path outside the workspace', async () => {
    await expect(attach(path.join(outside, 'secret.txt'))).rejects.toBeInstanceOf(IpcValidationError)
    await expect(attach(path.join(workspace.root, '..', path.basename(outside), 'secret.txt'))).rejects.toBeInstanceOf(IpcValidationError)
    await expect(attach(7)).rejects.toBeInstanceOf(IpcValidationError)
  })

  it('refuses a link inside the workspace that leads outside', async () => {
    // A junction needs no privilege on Windows and is a directory symlink elsewhere.
    fs.symlinkSync(outside, path.join(workspace.root, 'door'), 'junction')
    await expect(attach(path.join(workspace.root, 'door', 'secret.txt'))).rejects.toBeInstanceOf(IpcValidationError)
  })

  it('refuses when no workspace is open', async () => {
    const file = put('a.txt', 'a')
    workspace.root = ''
    await expect(attach(file)).rejects.toBeInstanceOf(IpcValidationError)
    workspace.root = path.dirname(file)
  })

  it('answers plainly for a folder or a missing file', async () => {
    expect(await attach(workspace.root)).toMatchObject({ ok: false, error: { message: expect.stringContaining('not a file') } })
    expect(await attach(path.join(workspace.root, 'gone.txt'))).toMatchObject({ ok: false, error: { message: expect.stringContaining('could not be read') } })
  })

  it('enforces the 25 MB total, counting what is already attached', async () => {
    expect(await attach(put('big.bin', 25 * MB + 1))).toMatchObject({ ok: false, error: { message: expect.stringContaining('25 MB') } })
    const small = put('small.bin', 2 * MB)
    expect((await attach(small, 24 * MB)).ok).toBe(false)
    expect((await attach(small, 23 * MB)).ok).toBe(true)
    // A nonsense total cannot raise the limit.
    expect((await attach(put('full.bin', 25 * MB + 1), -100 * MB)).ok).toBe(false)
  })

  it('enforces the limit of 50 attachments', async () => {
    const file = put('a.txt', 'a')
    expect((await attach(file, 0, 49)).ok).toBe(true)
    expect(await attach(file, 0, 50)).toMatchObject({ ok: false, error: { message: expect.stringContaining('50') } })
  })
})
