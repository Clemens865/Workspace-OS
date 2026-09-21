import { describe, it, expect, beforeEach, vi } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'

// ── Mock the heavy deps so the test needs no native better-sqlite3, no worker
//    threads, and no real tree watcher — we only care about the watcher
//    LIFECYCLE (close + null semantics on start / re-start / threshold).

const closeCalls = { n: 0 }
let liveWatchers = 0

vi.mock('../fs/treeWatcher', () => ({
  watchTree: () => {
    liveWatchers++
    return { close: () => { closeCalls.n++; liveWatchers-- } }
  },
}))

vi.mock('./index-db', () => ({
  SearchIndex: class {},
}))

vi.mock('./extract-pool', () => ({
  ExtractPool: class {
    async extract(): Promise<string> { return '' }
    async terminate(): Promise<void> {}
  },
}))

vi.mock('./symbols', () => ({
  extractSymbols: () => [],
  hasSymbolSupport: () => false,
}))

// A minimal in-memory SearchIndex stub matching the surface the Indexer uses.
function fakeIndex(): unknown {
  return {
    stats: () => ({ indexed: 0 }),
    getMtime: () => undefined,
    upsert: () => {},
    setSymbols: () => {},
    remove: () => {},
  }
}

describe('Indexer watcher lifecycle', () => {
  let dir: string

  beforeEach(async () => {
    closeCalls.n = 0
    liveWatchers = 0
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-indexer-'))
    await fs.writeFile(path.join(dir, 'a.txt'), 'hello')
    await fs.writeFile(path.join(dir, 'b.md'), 'world')
  })

  it('creates one watcher for a small tree and closes it on stop (no leak)', async () => {
    const { Indexer } = await import('./indexer')
    const idx = new Indexer(fakeIndex() as never)
    await idx.start(dir)
    expect(liveWatchers).toBe(1)
    await idx.stop()
    expect(liveWatchers).toBe(0)
    expect(closeCalls.n).toBeGreaterThanOrEqual(1)
  })

  it('closes the OLD watcher on a workspace switch — never leaks across re-start', async () => {
    const { Indexer } = await import('./indexer')
    const idx = new Indexer(fakeIndex() as never)
    await idx.start(dir)
    expect(liveWatchers).toBe(1)

    // Switch workspaces (re-start on a second tree). The old watcher must be
    // closed before the new one is created — at most one live at any point.
    const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-indexer2-'))
    await fs.writeFile(path.join(dir2, 'c.txt'), 'x')
    await idx.start(dir2)
    expect(liveWatchers).toBe(1) // exactly one, not two

    await idx.stop()
    expect(liveWatchers).toBe(0)
  })
})
