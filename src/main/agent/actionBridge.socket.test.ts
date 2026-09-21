import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import net from 'net'
import fs from 'fs'
import os from 'os'
import path from 'path'

// A mutable fake window: its webContents.send echoes the run back to main as a
// successful result (as the real renderer executor would), so the socket→
// renderer→socket round-trip is exercised end-to-end without a real renderer.
const sends: { channel: string; payload: { reqId: string; actionId: string; args?: unknown } }[] = []
let echoOk = true
// When set, replies are held instead of echoed immediately, so a test can
// resolve them OUT OF ORDER to prove per-reqId correlation under concurrency.
let deferReplies = false
const deferred: { reqId: string; args?: unknown }[] = []
const fakeWin = {
  isDestroyed: () => false,
  webContents: {
    send: (channel: string, payload: { reqId: string; actionId: string; args?: unknown }) => {
      sends.push({ channel, payload })
      if (deferReplies) {
        deferred.push({ reqId: payload.reqId, args: payload.args })
        return
      }
      // Echo asynchronously, like an IPC reply from the renderer.
      setImmediate(() => resolveActionResult(payload.reqId, echoOk, echoOk ? undefined : 'boom'))
    },
  },
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-sock-'))
vi.mock('electron', () => ({
  app: { getPath: () => tmp },
  BrowserWindow: {
    getFocusedWindow: () => fakeWin,
    getAllWindows: () => [fakeWin],
  },
}))

import {
  startActionBridge,
  stopActionBridge,
  agentSockPath,
  resolveActionResult,
} from './actionBridge'
import { setContext } from '../context/workspaceContext'
import { grants } from './grants'

// Every `run` now needs a run identity (per-run grants); this test is the dock.
const token = grants.issue('socket-test', 'all', 'socket-test')

/** Send one JSON request over the socket and resolve the one-line JSON reply. */
function roundtrip(req: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(agentSockPath())
    let buf = ''
    sock.setEncoding('utf-8')
    sock.on('connect', () => sock.write(JSON.stringify(req) + '\n'))
    sock.on('data', (c: string) => {
      buf += c
      const nl = buf.indexOf('\n')
      if (nl !== -1) {
        resolve(JSON.parse(buf.slice(0, nl)))
        sock.end()
      }
    })
    sock.on('error', reject)
  })
}

describe('actionBridge socket protocol', () => {
  beforeEach(() => {
    sends.length = 0
    deferred.length = 0
    echoOk = true
    deferReplies = false
    setContext({
      root: '/ws',
      surface: 'files',
      folder: '/ws',
      openFile: null,
      actions: [{ id: 'files.new-folder', agentHint: 'create a new folder' }],
      allActionIds: ['files.new-folder', 'browser.deepRead'],
    })
    startActionBridge()
  })
  afterEach(() => stopActionBridge())

  it('creates the socket with 0600 perms', async () => {
    // listen() + chmod are async; wait for the socket file, then check perms.
    for (let i = 0; i < 50 && !fs.existsSync(agentSockPath()); i++) {
      await new Promise((r) => setTimeout(r, 10))
    }
    // Give the chmod in the listen callback a tick to apply.
    await new Promise((r) => setTimeout(r, 20))
    const mode = fs.statSync(agentSockPath()).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('serves `list` over the socket', async () => {
    const reply = (await roundtrip({ cmd: 'list' })) as { ok: boolean; result: { all: string[] } }
    expect(reply.ok).toBe(true)
    expect(reply.result.all).toEqual(['files.new-folder', 'browser.deepRead'])
  })

  it('round-trips a `run` through the (fake) renderer and back', async () => {
    const reply = await roundtrip({ cmd: 'run', token, actionId: 'files.new-folder' })
    expect(reply).toEqual({ ok: true })
    expect(sends).toHaveLength(1)
    expect(sends[0].payload.actionId).toBe('files.new-folder')
  })

  it('reports a renderer failure back to the socket client', async () => {
    echoOk = false
    const reply = await roundtrip({ cmd: 'run', token, actionId: 'files.new-folder' })
    expect(reply).toEqual({ ok: false, error: 'boom' })
  })

  it('rejects an unknown id before reaching the renderer', async () => {
    const reply = await roundtrip({ cmd: 'run', token, actionId: 'mail.send' })
    expect(reply).toEqual({ ok: false, error: 'unknown action: mail.send' })
    expect(sends).toHaveLength(0)
  })

  // ── Concurrency (Stage 3: parallel research) ───────────────────────────────
  // N subagents drive their own tabs at once. Prove the bridge keeps each
  // request's reply correlated to ITS caller even when replies arrive out of
  // order, and that a slow request never blocks a fast one.

  it('correlates concurrent runs — out-of-order replies do NOT cross-wire', async () => {
    deferReplies = true
    // Fire three concurrent runs, each tagged by a distinct tab id in args so we
    // can assert each socket got back the reply meant for IT (not another's).
    const p0 = roundtrip({ cmd: 'run', token, actionId: 'browser.deepRead', args: { tab: 'A' } })
    const p1 = roundtrip({ cmd: 'run', token, actionId: 'browser.deepRead', args: { tab: 'B' } })
    const p2 = roundtrip({ cmd: 'run', token, actionId: 'browser.deepRead', args: { tab: 'C' } })

    // Wait until all three round-trips have reached the (fake) renderer.
    for (let i = 0; i < 100 && deferred.length < 3; i++) await new Promise((r) => setTimeout(r, 5))
    expect(deferred).toHaveLength(3)
    // Each got a UNIQUE reqId — no collision even fired back-to-back.
    expect(new Set(sends.map((s) => s.payload.reqId)).size).toBe(3)

    // Resolve them in REVERSE order, each returning its own tab id as the result.
    const byTab = (t: string): { reqId: string; args?: unknown } =>
      deferred.find((d) => (d.args as { tab?: string })?.tab === t)!
    for (const t of ['C', 'B', 'A']) {
      const d = byTab(t)
      resolveActionResult(d.reqId, true, undefined, { tab: t })
    }

    const [r0, r1, r2] = (await Promise.all([p0, p1, p2])) as { ok: boolean; result: { tab: string } }[]
    // The caller that asked for A got A back, B got B, C got C — no cross-wiring.
    expect(r0.result.tab).toBe('A')
    expect(r1.result.tab).toBe('B')
    expect(r2.result.tab).toBe('C')
  })

  it('a slow run does not block a concurrent fast run', async () => {
    deferReplies = true
    const slow = roundtrip({ cmd: 'run', token, actionId: 'browser.deepRead', args: { tab: 'slow' } })
    const fast = roundtrip({ cmd: 'run', token, actionId: 'browser.deepRead', args: { tab: 'fast' } })

    for (let i = 0; i < 100 && deferred.length < 2; i++) await new Promise((r) => setTimeout(r, 5))
    expect(deferred).toHaveLength(2)

    // Resolve ONLY the fast one; the slow one stays pending.
    const fastReq = deferred.find((d) => (d.args as { tab?: string })?.tab === 'fast')!
    resolveActionResult(fastReq.reqId, true, undefined, { tab: 'fast' })

    const fastReply = (await fast) as { ok: boolean; result: { tab: string } }
    expect(fastReply.result.tab).toBe('fast') // resolved while `slow` is still open

    // Now drain the slow one so the socket closes cleanly.
    const slowReq = deferred.find((d) => (d.args as { tab?: string })?.tab === 'slow')!
    resolveActionResult(slowReq.reqId, true, undefined, { tab: 'slow' })
    const slowReply = (await slow) as { ok: boolean; result: { tab: string } }
    expect(slowReply.result.tab).toBe('slow')
  })

  it('rejects malformed JSON', async () => {
    const reply = await new Promise((resolve, reject) => {
      const sock = net.createConnection(agentSockPath())
      let buf = ''
      sock.setEncoding('utf-8')
      sock.on('connect', () => sock.write('not json\n'))
      sock.on('data', (c: string) => {
        buf += c
        if (buf.includes('\n')) { resolve(JSON.parse(buf.trim())); sock.end() }
      })
      sock.on('error', reject)
    })
    expect(reply).toEqual({ ok: false, error: 'invalid JSON request' })
  })
})
