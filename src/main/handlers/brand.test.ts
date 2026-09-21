import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

/**
 * Handler-boundary tests for the Brand kit: register against a fake ipcMain,
 * capture the handlers, invoke them directly, and prove the boundary coercion —
 * bad colours are dropped (prior value survives), oversized logos are rejected,
 * a set patch round-trips through get. WOS_USERDATA_DIR points at a scratch dir.
 */

vi.mock('electron', () => ({
  default: { app: { getPath: () => os.tmpdir() } },
  app: { getPath: () => os.tmpdir() },
}))

import { registerBrandHandlers } from './brand'
import { IPC } from '../ipc-channels'

type Handler = (event: unknown, ...args: unknown[]) => unknown
let handlers: Map<string, Handler>
let dir: string

function fakeIpcMain(): { handle: (channel: string, fn: Handler) => void } {
  handlers = new Map()
  return { handle: (channel, fn) => handlers.set(channel, fn) }
}

async function call(channel: string, ...args: unknown[]): Promise<any> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return fn({}, ...args)
}

beforeAll(() => {
  // The brand store is a memoized singleton bound to WOS_USERDATA_DIR on first
  // use, so we fix one scratch dir for the whole file and register once.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-brand-h-'))
  process.env.WOS_USERDATA_DIR = dir
  registerBrandHandlers(fakeIpcMain() as never)
})

beforeEach(() => {
  // Reset to a known default brand before each test (independent of order).
  try { fs.rmSync(path.join(dir, 'brand.json'), { force: true }) } catch { /* none */ }
  try { fs.rmSync(path.join(dir, 'brand'), { recursive: true, force: true }) } catch { /* none */ }
})

afterAll(() => {
  delete process.env.WOS_USERDATA_DIR
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('brand handlers', () => {
  it('get returns a complete default brand when unset', async () => {
    const b = await call(IPC.BRAND_GET)
    expect(b.name).toBeTruthy()
    expect(b.palette.accent).toMatch(/^#/)
    expect(b.fonts.body).toBeTruthy()
  })

  it('set persists a valid patch and get reflects it', async () => {
    await call(IPC.BRAND_SET, { name: 'Acme', voice: 'Warm and direct.', palette: { accent: '#ff3366' } })
    const b = await call(IPC.BRAND_GET)
    expect(b.name).toBe('Acme')
    expect(b.voice).toBe('Warm and direct.')
    expect(b.palette.accent).toBe('#ff3366')
  })

  it('set drops a bad colour, keeping the prior value', async () => {
    await call(IPC.BRAND_SET, { palette: { accent: '#123456' } })
    await call(IPC.BRAND_SET, { palette: { accent: 'url(evil)' } })
    const b = await call(IPC.BRAND_GET)
    expect(b.palette.accent).toBe('#123456')
  })

  it('setLogo copies bytes into userData/brand and rejects oversized/empty input', async () => {
    const b64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64')
    const b = await call(IPC.BRAND_SET_LOGO, { filename: 'logo.png', content: b64 })
    expect(b.logoPath.startsWith(path.join(dir, 'brand'))).toBe(true)
    expect(fs.existsSync(b.logoPath)).toBe(true)

    await expect(call(IPC.BRAND_SET_LOGO, { filename: 'x.png', content: '' })).rejects.toThrow()
    const huge = Buffer.alloc(5 * 1024 * 1024, 1).toString('base64')
    await expect(call(IPC.BRAND_SET_LOGO, { filename: 'big.png', content: huge })).rejects.toThrow(/too large/i)
  })
})
