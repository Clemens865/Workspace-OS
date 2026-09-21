import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import type { spawn } from 'child_process'
import { CodexRpc } from './codexRpc'

function setup() {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), exitCode: null, signalCode: null })
  const notifications = vi.fn(), requests = vi.fn(), close = vi.fn(), diagnostics = vi.fn()
  const rpc = new CodexRpc({ spawnProcess: (() => child) as unknown as typeof spawn, onNotification: notifications, onRequest: requests, onClose: close, onDiagnostic: diagnostics })
  return { rpc, child, notifications, requests, close, diagnostics }
}
describe('Codex owned RPC transport', () => {
  it('correlates concurrent replies, errors and structured permission requests', async () => {
    const s = setup()
    const a = s.rpc.request('first'), b = s.rpc.request('second')
    const rejected = expect(b).rejects.toThrow('denied')
    s.child.stdout.write('{"id":2,"error":{"message":"denied"}}\n{"id":1,"result":{"ok":true}}\n{"id":"approval-1","method":"item/fileChange/requestApproval","params":{"reason":"edit"}}\n')
    expect(await a).toEqual({ ok: true }); await rejected
    expect(s.requests).toHaveBeenCalledWith('approval-1', 'item/fileChange/requestApproval', { reason: 'edit' })
    s.rpc.close(); s.child.emit('close', 0)
    expect(s.close).toHaveBeenCalledTimes(1)
  })
  it('preserves UTF-8 split between buffers and the final unterminated event', () => {
    const s = setup(), bytes = Buffer.from('{"method":"delta","params":{"text":"Grüße 🦊"}}')
    for (const byte of bytes) s.child.stdout.write(Buffer.from([byte]))
    s.child.emit('close', 0)
    expect(s.notifications).toHaveBeenCalledWith('delta', { text: 'Grüße 🦊' })
  })
  it('rejects all pending calls on process failure and refuses reuse', async () => {
    const s = setup(), pending = s.rpc.request('slow')
    const rejected = expect(pending).rejects.toThrow('broken')
    s.child.emit('error', new Error('broken'))
    await rejected
    await expect(s.rpc.request('later')).rejects.toThrow('closed')
    s.rpc.close(); s.child.emit('close', 1)
  })
})
