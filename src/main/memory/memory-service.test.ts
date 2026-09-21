import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  remember, search, list, forget, supersede, stats, closeAllStores,
  buildMemoryBlock, retrievalQueryFor, workspaceDbPath, globalDbPath,
} from './memory-service'
import type { Memory } from './memory-store'

let root: string
let userData: string
let ctx: { root: string | null; userDataDir: string }

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-ws-'))
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-ud-'))
  ctx = { root, userDataDir: userData }
})
afterEach(() => {
  closeAllStores()
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(userData, { recursive: true, force: true })
})

describe('store routing', () => {
  it('puts a workspace memory in the workspace db, inside the folder', () => {
    remember(ctx, { kind: 'fact', text: 'Budget lives in budget.xlsx', source: 'you' })
    expect(fs.existsSync(workspaceDbPath(root))).toBe(true)
    expect(stats(ctx)).toEqual({ workspace: 1, global: 0 })
  })

  it('puts a global memory in the global db, OUTSIDE the folder', () => {
    // Separate databases, not a scope column: copying or deleting a workspace
    // must not drag personal memory along, or take it with it.
    remember(ctx, { kind: 'preference', text: 'Prefers metric units', source: 'you', scope: 'global' })
    expect(fs.existsSync(globalDbPath(userData))).toBe(true)
    expect(fs.existsSync(workspaceDbPath(root))).toBe(false)
    expect(stats(ctx)).toEqual({ workspace: 0, global: 1 })
  })

  it('REFUSES a workspace memory when no folder is open', () => {
    // Filing it globally would quietly turn a project fact into a personal one.
    expect(() => remember({ root: null, userDataDir: userData }, { kind: 'fact', text: 'x', source: 'y' }))
      .toThrow(/open a folder/i)
  })

  it('still accepts a global memory with no folder open', () => {
    const m = remember({ root: null, userDataDir: userData }, { kind: 'preference', text: 'Dark mode', source: 'you', scope: 'global' })
    expect(m.scope).toBe('global')
  })
})

describe('retrieval across both stores', () => {
  beforeEach(() => {
    remember(ctx, { kind: 'fact', text: 'The Acme renewal is in March', source: 'run 1' })
    remember(ctx, { kind: 'preference', text: 'Always send decks as PDF', source: 'you', scope: 'global' })
  })

  it('finds workspace and global memories together', () => {
    // An agent wants what is relevant, not what is filed where.
    expect(search(ctx, 'renewal').some((m) => m.text.includes('Acme'))).toBe(true)
    expect(search(ctx, 'decks').some((m) => m.text.includes('PDF'))).toBe(true)
  })

  it('lists both, newest first', () => {
    const all = list(ctx)
    expect(all).toHaveLength(2)
    expect(all[0].updatedAt).toBeGreaterThanOrEqual(all[1].updatedAt)
  })

  it('searches only the global store when no folder is open', () => {
    const noRoot = { root: null, userDataDir: userData }
    expect(search(noRoot, 'decks').length).toBe(1)
    expect(search(noRoot, 'renewal').length).toBe(0)
  })

  it('respects the limit across the merged result', () => {
    expect(search(ctx, 'the', 1)).toHaveLength(1)
  })
})

describe('forget and supersede find the right store', () => {
  it('forgets a workspace memory', () => {
    const m = remember(ctx, { kind: 'fact', text: 'Temp', source: 'you' })
    expect(forget(ctx, m.id)).toBe(true)
    expect(list(ctx)).toHaveLength(0)
  })

  it('forgets a global memory', () => {
    const m = remember(ctx, { kind: 'preference', text: 'Temp global', source: 'you', scope: 'global' })
    expect(forget(ctx, m.id)).toBe(true)
    expect(stats(ctx).global).toBe(0)
  })

  it('reports false for an id in neither store', () => {
    expect(forget(ctx, 'nope')).toBe(false)
  })

  it('supersedes in the store that holds the original', () => {
    const m = remember(ctx, { kind: 'fact', text: 'Owner is Dana', source: 'you' })
    const next = supersede(ctx, m.id, { kind: 'fact', text: 'Owner is Sam', source: 'you' })!
    expect(next.text).toBe('Owner is Sam')
    expect(list(ctx).map((x) => x.text)).toEqual(['Owner is Sam'])
  })
})

const mem = (o: Partial<Memory>): Memory => ({
  id: 'i', kind: 'fact', text: 't', source: 's', scope: 'workspace', tags: [],
  createdAt: 0, updatedAt: 0, reinforced: 1, lastUsedAt: null, supersededBy: null, ...o,
})

describe('buildMemoryBlock', () => {
  it('is empty when there is nothing to inject, so callers can append blindly', () => {
    expect(buildMemoryBlock([])).toBe('')
  })

  it('includes the text, kind and PROVENANCE of each memory', () => {
    const block = buildMemoryBlock([mem({ text: 'Renewal in March', source: 'run 42' })])
    expect(block).toContain('Renewal in March')
    expect(block).toContain('[fact]')
    expect(block).toContain('run 42') // the agent must be able to tell where it came from
  })

  it('shows reinforcement only when it means something', () => {
    expect(buildMemoryBlock([mem({ reinforced: 3 })])).toContain('seen 3×')
    expect(buildMemoryBlock([mem({ reinforced: 1 })])).not.toContain('seen')
  })

  it('BOUNDS the block — memory that crowds out the task makes the agent worse', () => {
    const many = Array.from({ length: 50 }, (_, i) => mem({ id: `m${i}`, text: `fact ${i}` }))
    const block = buildMemoryBlock(many, 5)
    expect(block).toContain('fact 4')
    expect(block).not.toContain('fact 5')
  })

  it('tells the agent these are fallible and to prefer what it can verify', () => {
    // A stale memory presented as ground truth is how an agent confidently does
    // the wrong thing.
    const block = buildMemoryBlock([mem({})])
    expect(block).toMatch(/out of date|verify/i)
  })
})

describe('retrievalQueryFor', () => {
  it('uses the prompt, bounded', () => {
    expect(retrievalQueryFor('plan the Lisbon trip')).toBe('plan the Lisbon trip')
    expect(retrievalQueryFor('x'.repeat(900)).length).toBe(400)
  })
})
