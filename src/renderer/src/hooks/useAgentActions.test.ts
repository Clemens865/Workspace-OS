import { describe, it, expect, vi } from 'vitest'
import { runAgentAction } from './useAgentActions'
import type { SurfaceActionContext } from '../components/Terminal/surfaceActions'

const ctx: SurfaceActionContext = { root: '/ws', surface: 'files', folder: '/ws', openFile: null }
const getCtx = (): SurfaceActionContext => ctx

describe('runAgentAction (renderer executor)', () => {
  it('rejects an id not in the registry (never runs anything)', async () => {
    const reply = await runAgentAction('mail.send', getCtx)
    expect(reply).toEqual({ ok: false, error: 'unknown action: mail.send' })
  })

  it('runs a real registered action against the live ctx', async () => {
    // files.new-folder → window.workspace.fs.create(dir, 'New Folder', true).
    const create = vi.fn(async () => '/ws/New Folder')
    const g = globalThis as Record<string, unknown>
    const prev = g.window
    g.window = { workspace: { fs: { create } } }
    try {
      const reply = await runAgentAction('files.new-folder', getCtx)
      expect(reply).toEqual({ ok: true })
      expect(create).toHaveBeenCalledWith('/ws', 'New Folder', true)
    } finally {
      g.window = prev
    }
  })

  it('reports a thrown action as ok:false instead of throwing', async () => {
    const create = vi.fn(async () => { throw new Error('disk full') })
    const g = globalThis as Record<string, unknown>
    const prev = g.window
    g.window = { workspace: { fs: { create } } }
    try {
      const reply = await runAgentAction('files.new-folder', getCtx)
      expect(reply).toEqual({ ok: false, error: 'disk full' })
    } finally {
      g.window = prev
    }
  })

  it('RELAYS a browser action`s returned value as { ok, result } (extract)', async () => {
    // browser.extract → window.workspace.browser.extract(mode); its return
    // becomes the bridge `result` the agent reads.
    const extract = vi.fn(async () => ({ ok: true, mode: 'text', data: { text: 'hello' } }))
    const g = globalThis as Record<string, unknown>
    const prev = g.window
    g.window = { workspace: { browser: { extract } }, dispatchEvent: () => true }
    try {
      const reply = await runAgentAction('browser.extract', getCtx, { mode: 'text' })
      // No `tab` given → active-tab call (tab arg is undefined, backward-compatible).
      expect(extract).toHaveBeenCalledWith('text', undefined)
      expect(reply).toEqual({ ok: true, result: { ok: true, mode: 'text', data: { text: 'hello' } } })
    } finally {
      g.window = prev
    }
  })

  it('passes the agent`s JSON args to browser.navigate and relays its result', async () => {
    const navigate = vi.fn(async () => ({ ok: true, url: 'https://example.com/', title: 'Example' }))
    const g = globalThis as Record<string, unknown>
    const prev = g.window
    g.window = { workspace: { browser: { navigate } }, dispatchEvent: () => true }
    try {
      const reply = await runAgentAction('browser.navigate', getCtx, { url: 'https://example.com' })
      expect(navigate).toHaveBeenCalledWith('https://example.com', undefined)
      expect(reply).toEqual({ ok: true, result: { ok: true, url: 'https://example.com/', title: 'Example' } })
    } finally {
      g.window = prev
    }
  })
})
