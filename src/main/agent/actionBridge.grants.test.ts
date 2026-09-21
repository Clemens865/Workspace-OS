import { describe, it, expect, vi } from 'vitest'
import os from 'os'

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
}))

import { handleRequest, type ActionReply } from './actionBridge'
import { GrantTable } from './grants'

const ctx = {
  actions: [],
  allActionIds: ['browser.navigate', 'mail.compose', 'memory.remember', 'memory.search'],
  surface: 'browser',
  root: '/ws',
  folder: '/ws',
  openFile: null,
}

describe('actionBridge — per-run grants', () => {
  const table = new GrantTable()
  const research = table.issue('r1', ['research'], 'Nadia')
  const full = table.issue('r2', 'all', 'dock')
  const invoke = vi.fn(async (): Promise<ActionReply> => ({ ok: true }))
  const cases = vi.fn(async (): Promise<ActionReply> => ({ ok: true, result: [] }))
  const deps = { context: () => ctx, invoke, cases, grants: (t: unknown) => table.lookup(t) }

  it('refuses a run with no identity, before touching anything', async () => {
    const reply = await handleRequest({ cmd: 'run', actionId: 'browser.navigate' }, deps)
    expect(reply.ok).toBe(false)
    expect((reply as { error: string }).error).toMatch(/no run identity/)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('a research agent may drive the browser, not mail, not memory.remember, not cases', async () => {
    expect(await handleRequest({ cmd: 'run', actionId: 'browser.navigate', token: research }, deps)).toEqual({ ok: true })
    const mail = await handleRequest({ cmd: 'run', actionId: 'mail.compose', token: research }, deps)
    expect((mail as { error: string }).error).toMatch(/not granted/)
    const mem = await handleRequest({ cmd: 'run', actionId: 'memory.remember', token: research }, deps)
    expect((mem as { error: string }).error).toMatch(/not granted/)
    const c = await handleRequest({ cmd: 'run', actionId: 'cases.list', token: research }, deps)
    expect((c as { error: string }).error).toMatch(/not granted/)
    expect(cases).not.toHaveBeenCalled()
    // Baseline recall stays on.
    expect(await handleRequest({ cmd: 'run', actionId: 'memory.search', token: research }, deps)).toEqual({ ok: true })
  })

  it('the legacy full grant keeps the dock whole; a revoked token is a stranger again', async () => {
    expect(await handleRequest({ cmd: 'run', actionId: 'mail.compose', token: full }, deps)).toEqual({ ok: true })
    table.revoke('r2')
    const after = await handleRequest({ cmd: 'run', actionId: 'mail.compose', token: full }, deps)
    expect((after as { error: string }).error).toMatch(/no run identity/)
  })

  it('list and context need no identity', async () => {
    expect((await handleRequest({ cmd: 'list' }, deps)).ok).toBe(true)
    expect((await handleRequest({ cmd: 'context' }, deps)).ok).toBe(true)
  })

  it('without a grants dep the protocol is unchanged (existing tests)', async () => {
    expect(await handleRequest({ cmd: 'run', actionId: 'browser.navigate' }, { context: () => ctx, invoke })).toEqual({ ok: true })
  })
})

describe('Codex document bridge grants', () => {
  it('checks the granted surface and original workspace before any document or data write', async () => {
    const table = new GrantTable()
    const docs = table.issue('docs', ['documents'], 'docs', '/ws')
    const research = table.issue('research', ['research'], 'research', '/ws')
    const documents = vi.fn(async (): Promise<ActionReply> => ({ ok: true }))
    const data = vi.fn(async (): Promise<ActionReply> => ({ ok: true }))
    const deps = { context: () => ctx, invoke: vi.fn(), documents, data, grants: (token: unknown) => table.lookup(token) }
    for (const actionId of ['document.generate', 'document.data']) {
      expect((await handleRequest({ cmd: 'run', actionId, token: research }, deps)).ok).toBe(false)
      expect((await handleRequest({ cmd: 'run', actionId, token: docs }, { ...deps, context: () => ({ ...ctx, root: '/different' }) })).ok).toBe(false)
    }
    expect(documents).not.toHaveBeenCalled(); expect(data).not.toHaveBeenCalled()
    expect((await handleRequest({ cmd: 'run', actionId: 'document.generate', token: docs }, deps)).ok).toBe(true)
    expect(documents).toHaveBeenCalledTimes(1)
  })

  it('a workspace-bound run still acts while no workspace is open (nothing to protect)', async () => {
    const table = new GrantTable()
    const bound = table.issue('bound', 'all', 'bound', '/ws')
    const data = vi.fn(async (): Promise<ActionReply> => ({ ok: true }))
    const deps = { context: () => ({ ...ctx, root: null }), invoke: vi.fn(async (): Promise<ActionReply> => ({ ok: true })), data, grants: (token: unknown) => table.lookup(token) }
    expect(await handleRequest({ cmd: 'run', actionId: 'memory.search', token: bound }, deps)).toEqual({ ok: true })
    expect(await handleRequest({ cmd: 'run', actionId: 'document.data', token: bound }, deps)).toEqual({ ok: true })
    expect((await handleRequest({ cmd: 'run', actionId: 'document.data', token: bound }, { ...deps, context: () => ({ ...ctx, root: '/elsewhere' }) })).ok).toBe(false)
  })
})
