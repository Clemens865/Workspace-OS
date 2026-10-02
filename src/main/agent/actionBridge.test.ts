import { describe, it, expect, vi } from 'vitest'
import os from 'os'

// electron is imported by actionBridge (app.getPath, BrowserWindow). Stub it so
// the pure protocol logic (handleRequest) is unit-testable in node.
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
}))

import { handleRequest, type ActionReply } from './actionBridge'

const ctx = {
  actions: [{ id: 'files.new-folder', agentHint: 'create a new folder' }],
  allActionIds: ['files.new-folder', 'document.export-pdf'],
  surface: 'files',
  root: '/ws',
  folder: '/ws',
  openFile: null,
}

describe('actionBridge.handleRequest', () => {
  it('answers `context` from the live workspace context', async () => {
    const reply = await handleRequest(
      { cmd: 'context' },
      { context: () => ctx, invoke: async () => ({ ok: true }) },
    )
    expect(reply).toEqual({ ok: true, result: { surface: 'files', root: '/ws', folder: '/ws', openFile: null } })
  })

  it('answers `list` with available actions + the full id set', async () => {
    const reply = await handleRequest(
      { cmd: 'list' },
      { context: () => ctx, invoke: async () => ({ ok: true }) },
    )
    expect(reply).toEqual({
      ok: true,
      result: { available: ctx.actions, all: ctx.allActionIds },
    })
  })

  it('forwards a known `run` id to the renderer invoker', async () => {
    const invoke = vi.fn(async (): Promise<ActionReply> => ({ ok: true }))
    const reply = await handleRequest(
      { cmd: 'run', actionId: 'files.new-folder', args: { x: 1 } },
      { context: () => ctx, invoke },
    )
    expect(invoke).toHaveBeenCalledWith('files.new-folder', { x: 1 })
    expect(reply).toEqual({ ok: true })
  })

  it('passes the granted run id along, so the app knows whose action it is', async () => {
    const invoke = vi.fn(async (): Promise<ActionReply> => ({ ok: true }))
    await handleRequest(
      { cmd: 'run', actionId: 'files.new-folder', args: { x: 1 }, token: 't' },
      { context: () => ctx, invoke, grants: () => ({ runId: 'run-42', scope: 'all', label: 'Ada' }) },
    )
    expect(invoke).toHaveBeenCalledWith('files.new-folder', { x: 1 }, 'run-42')
  })

  it('RELAYS a run `result` from the renderer verbatim (browser extract)', async () => {
    // The key change: a run reply now carries `result` (extracted data / a
    // screenshot path) end-to-end so `wos-action run` prints it for the agent.
    const invoke = vi.fn(async (): Promise<ActionReply> => ({
      ok: true,
      result: { ok: true, mode: 'text', data: { text: 'hello' } },
    }))
    const reply = await handleRequest(
      { cmd: 'run', actionId: 'files.new-folder', args: { mode: 'text' } },
      { context: () => ctx, invoke },
    )
    expect(reply).toEqual({ ok: true, result: { ok: true, mode: 'text', data: { text: 'hello' } } })
  })

  it('REJECTS an unknown action id without touching the renderer', async () => {
    const invoke = vi.fn(async (): Promise<ActionReply> => ({ ok: true }))
    const reply = await handleRequest(
      { cmd: 'run', actionId: 'mail.send', args: {} },
      { context: () => ctx, invoke },
    )
    expect(invoke).not.toHaveBeenCalled()
    expect(reply).toEqual({ ok: false, error: 'unknown action: mail.send' })
  })

  it('rejects a `run` with no actionId', async () => {
    const reply = await handleRequest(
      { cmd: 'run' },
      { context: () => ctx, invoke: async () => ({ ok: true }) },
    )
    expect(reply).toEqual({ ok: false, error: 'run requires an actionId' })
  })

  it('rejects an unknown command', async () => {
    const reply = await handleRequest(
      // @ts-expect-error — exercising the invalid-cmd guard
      { cmd: 'delete' },
      { context: () => ctx, invoke: async () => ({ ok: true }) },
    )
    expect(reply).toEqual({ ok: false, error: 'unknown cmd: delete' })
  })

  it('propagates a renderer failure verbatim (timeout / action error)', async () => {
    const reply = await handleRequest(
      { cmd: 'run', actionId: 'document.export-pdf' },
      { context: () => ctx, invoke: async () => ({ ok: false, error: 'action timed out' }) },
    )
    expect(reply).toEqual({ ok: false, error: 'action timed out' })
  })
})

/**
 * Actions handled in MAIN rather than forwarded to the renderer.
 *
 * Both `cases.*` and `calendar.*` are promised to agents by the capability
 * catalog, and both are file IO with no UI. If the bridge stopped routing them
 * the agent would get "unknown action" for something its own instructions told
 * it to use — the dead-offer failure, one level below the UI where nobody would
 * see it.
 */
describe('main-handled action namespaces', () => {
  const deps = (extra: Record<string, unknown> = {}) => ({
    context: () => ({ actions: [], allActionIds: ['browser.click'], surface: null, root: null, folder: null, openFile: null }),
    invoke: async () => ({ ok: true as const }),
    ...extra,
  })

  it('routes cases.* to the case handler, not the renderer', async () => {
    let seen = ''
    const r = await handleRequest(
      { cmd: 'run', actionId: 'cases.note', args: { id: 'x', text: 'y' } } as never,
      deps({ cases: async (id: string) => { seen = id; return { ok: true as const } } }) as never,
    )
    expect(seen).toBe('cases.note')
    expect(r.ok).toBe(true)
  })

  it('routes calendar.* to the calendar handler', async () => {
    let seen = ''
    const r = await handleRequest(
      { cmd: 'run', actionId: 'calendar.createEvent', args: {} } as never,
      deps({ calendar: async (id: string) => { seen = id; return { ok: true as const } } }) as never,
    )
    expect(seen).toBe('calendar.createEvent')
    expect(r.ok).toBe(true)
  })

  /** They must NOT fall through to the allActionIds check, which would reject them. */
  it('does not require the namespaced ids to be registered in the renderer', async () => {
    const r = await handleRequest(
      { cmd: 'run', actionId: 'cases.list' } as never,
      deps({ cases: async () => ({ ok: true as const, result: [] }) }) as never,
    )
    expect(r.ok).toBe(true)
  })

  it('says so plainly when the namespace is unavailable', async () => {
    const r = await handleRequest({ cmd: 'run', actionId: 'cases.list' } as never, deps() as never)
    expect(r.ok).toBe(false)
  })
})
