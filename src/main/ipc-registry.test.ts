import { describe, it, expect, vi } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { ipcHandle, registerCleanup, runAllCleanups, registeredChannels } from './ipc-registry'
import { IpcValidationError } from './ipc-validator'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

/** Minimal ipcMain stand-in that records handlers and lets tests invoke them. */
function fakeIpcMain(): { ipc: IpcMain; invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } {
  const handlers = new Map<string, Handler>()
  const ipc = {
    handle: (channel: string, fn: Handler) => {
      handlers.set(channel, fn)
    },
  } as unknown as IpcMain
  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> =>
    handlers.get(channel)!({} as IpcMainInvokeEvent, ...args)
  return { ipc, invoke }
}

describe('ipcHandle', () => {
  it('throws at registration time on a duplicate channel', () => {
    const { ipc } = fakeIpcMain()
    ipcHandle(ipc, 'test:dup', () => 1)
    expect(() => ipcHandle(ipc, 'test:dup', () => 2)).toThrow(/test:dup/)
  })

  it('records channels and returns them sorted', () => {
    const { ipc } = fakeIpcMain()
    ipcHandle(ipc, 'test:z-channel', () => null)
    ipcHandle(ipc, 'test:a-channel', () => null)
    const channels = registeredChannels()
    expect(channels).toContain('test:a-channel')
    expect(channels).toContain('test:z-channel')
    expect(channels).toEqual([...channels].sort())
  })

  it('passes arguments through and resolves the handler result', async () => {
    const { ipc, invoke } = fakeIpcMain()
    ipcHandle(ipc, 'test:echo', (_event, a, b) => [a, b])
    await expect(invoke('test:echo', 1, 'two')).resolves.toEqual([1, 'two'])
  })

  it('lets IpcValidationError propagate without logging', async () => {
    const { ipc, invoke } = fakeIpcMain()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ipcHandle(ipc, 'test:validation', () => {
      throw new IpcValidationError('bad input')
    })
    await expect(invoke('test:validation')).rejects.toBeInstanceOf(IpcValidationError)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('logs unexpected errors with the channel name and rethrows', async () => {
    const { ipc, invoke } = fakeIpcMain()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ipcHandle(ipc, 'test:boom', () => {
      throw new Error('kaboom')
    })
    await expect(invoke('test:boom')).rejects.toThrow('kaboom')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('test:boom'), expect.any(Error))
    spy.mockRestore()
  })
})

describe('cleanups', () => {
  it('runs every cleanup even when one throws, and never throws itself', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ran: string[] = []
    registerCleanup('first', () => {
      ran.push('first')
      throw new Error('first failed')
    })
    registerCleanup('second', async () => {
      ran.push('second')
    })
    registerCleanup('third', () => {
      ran.push('third')
    })

    await expect(runAllCleanups()).resolves.toBeUndefined()

    expect(ran).toEqual(['first', 'second', 'third'])
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('first'), expect.any(Error))
    spy.mockRestore()
  })

  it('drains the list so cleanups run only once', async () => {
    const fn = vi.fn()
    registerCleanup('once', fn)
    await runAllCleanups()
    await runAllCleanups()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
