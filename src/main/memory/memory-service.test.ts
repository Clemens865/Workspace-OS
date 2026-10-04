import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  remember, search, recall, correct, confirm, history, similar, list, forget, supersede, stats, closeAllStores,
  buildMemoryBlock, retrievalQueryFor, workspaceDbPath, globalDbPath, profile, forRun,
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

describe('memory you can trust', () => {
  it('recall brings only what fits the task — nothing for an unrelated one', () => {
    remember(ctx, { kind: 'fact', text: 'The Acme renewal is in March', source: 'run 1' })
    expect(recall(ctx, 'when is the Acme renewal').map((m) => m.text)).toEqual(['The Acme renewal is in March'])
    expect(recall(ctx, 'draft a haiku about autumn')).toEqual([])
    expect(recall(ctx, '???')).toEqual([])
  })

  it('recall merges the two stores by fit, not by date', () => {
    remember(ctx, { kind: 'fact', text: 'Acme renewal March contract signed', source: 'run 1' })
    // Newer, global, and a weaker fit for the question.
    remember(ctx, { kind: 'preference', text: 'Send the contract as PDF', source: 'you', scope: 'global' })
    expect(recall(ctx, 'Acme renewal contract')[0].text).toBe('Acme renewal March contract signed')
  })

  it('an agent’s memory waits for the person; the person’s own is confirmed', () => {
    const a = remember(ctx, { kind: 'fact', text: 'Dana leads procurement', source: 'run 7', author: 'agent' })
    const y = remember(ctx, { kind: 'fact', text: 'Budget closes in May', source: 'you told me', author: 'you' })
    expect([a.confirmed, y.confirmed]).toEqual([false, true])
    expect(list(ctx, { unconfirmed: true }).map((m) => m.id)).toEqual([a.id])
    expect(confirm(ctx, a.id)).toBe(true)
    expect(list(ctx, { unconfirmed: true })).toEqual([])
  })

  it('the person saying the same thing again confirms an agent’s memory', () => {
    const a = remember(ctx, { kind: 'fact', text: 'Dana leads procurement', source: 'run 7', author: 'agent' })
    remember(ctx, { kind: 'fact', text: 'Dana leads procurement.', source: 'you told me', author: 'you' })
    expect(list(ctx).find((m) => m.id === a.id)?.confirmed).toBe(true)
  })

  it('a correction keeps what it said before, with when it stopped being true', () => {
    const m = remember(ctx, { kind: 'fact', text: 'The salary offer is 120k', source: 'run 1', author: 'agent' })
    const fixed = correct(ctx, m.id, 'The salary offer is 128k', 'you')!
    expect(fixed).toMatchObject({ text: 'The salary offer is 128k', confirmed: true, author: 'you', source: 'you corrected it' })
    expect(list(ctx).map((x) => x.text)).toEqual(['The salary offer is 128k'])
    const before = history(ctx, fixed.id)
    expect(before.map((x) => x.text)).toEqual(['The salary offer is 120k'])
    expect(before[0].endedAt).toBeGreaterThan(0)
    // The old text no longer comes back for a question.
    expect(recall(ctx, 'salary offer 120k').map((x) => x.text)).toEqual(['The salary offer is 128k'])
  })

  it('correcting to the same text keeps the memory (it used to replace itself and vanish)', () => {
    const m = remember(ctx, { kind: 'fact', text: 'Owner is Dana', source: 'run 1', author: 'agent' })
    const same = correct(ctx, m.id, 'Owner is Dana', 'you')!
    expect(same.id).toBe(m.id)
    expect(same.confirmed).toBe(true)
    expect(list(ctx)).toHaveLength(1)
  })

  it('an agent’s correction waits for the person too', () => {
    const m = remember(ctx, { kind: 'fact', text: 'Owner is Dana', source: 'you told me', author: 'you' })
    expect(correct(ctx, m.id, 'Owner is Sam', 'agent')!.confirmed).toBe(false)
  })

  it('forgetting a memory forgets its earlier versions too', () => {
    const m = remember(ctx, { kind: 'fact', text: 'Office in Linz', source: 'you', author: 'you' })
    const n = correct(ctx, m.id, 'Office in Vienna', 'you')!
    expect(forget(ctx, n.id)).toBe(true)
    expect(history(ctx, n.id)).toEqual([])
    expect(search(ctx, 'Linz')).toEqual([])
  })

  it('similar finds a memory that says nearly the same, not an unrelated one', () => {
    remember(ctx, { kind: 'fact', text: 'Northwind offered a salary of 120k for the PM role', source: 'run 1' })
    remember(ctx, { kind: 'fact', text: 'The team offsite is in Graz', source: 'run 2' })
    expect(similar(ctx, 'Northwind offered 128k salary for the PM role').map((m) => m.text)).toEqual(['Northwind offered a salary of 120k for the PM role'])
    expect(similar(ctx, 'Lunch is at noon')).toEqual([])
  })
})

const mem = (o: Partial<Memory>): Memory => ({
  id: 'i', kind: 'fact', text: 't', source: 's', scope: 'workspace', tags: [],
  createdAt: 0, updatedAt: 0, reinforced: 1, lastUsedAt: null, supersededBy: null, author: 'you', confirmed: true, endedAt: null, ...o,
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

  it('marks what an agent noted and the person has not checked', () => {
    expect(buildMemoryBlock([mem({ confirmed: false })])).toContain('[fact, unconfirmed]')
    expect(buildMemoryBlock([mem({})])).toContain('[fact]')
  })

  it('says memory is evidence: the person now overrides it, and nothing is invented', () => {
    const block = buildMemoryBlock([mem({})])
    expect(block).toMatch(/not instructions or permissions/)
    expect(block).toMatch(/person says now overrides/)
    expect(block).toMatch(/Never present something as remembered/)
  })

  it('tells the agent these are fallible and to prefer what it can verify', () => {
    // A stale memory presented as ground truth is how an agent confidently does
    // the wrong thing.
    const block = buildMemoryBlock([mem({})])
    expect(block).toMatch(/out of date|verify/i)
  })
})

describe('what a run is told', () => {
  it('always carries the standing preferences, from the workspace and the person', () => {
    remember(ctx, { kind: 'preference', text: 'Warm neutrals, high contrast', source: 'you', author: 'you' })
    remember(ctx, { kind: 'preference', text: 'Answers in German', source: 'you', author: 'you', scope: 'global' })
    remember(ctx, { kind: 'preference', text: 'Unkept agent guess', source: 'run' })
    expect(profile(ctx).map((m) => m.text).sort()).toEqual(['Answers in German', 'Warm neutrals, high contrast'])
    const run = forRun(ctx, 'Design me a new landing page section')
    expect(run.profile).toHaveLength(2)
    expect(run.recalled).toHaveLength(0)
  })

  it('does not list a preference twice when it also fits the task', () => {
    remember(ctx, { kind: 'preference', text: 'Landing pages use warm neutrals', source: 'you', author: 'you' })
    const run = forRun(ctx, 'landing page colours')
    expect(run.profile).toHaveLength(1)
    expect(run.recalled).toHaveLength(0)
  })

  it('shows a corrected memory with what it said before, marked as no longer true', () => {
    const old = remember(ctx, { kind: 'fact', text: 'The launch budget is 8,000', source: 'call', author: 'you' })
    correct(ctx, old.id, 'The launch budget is 9,500', 'you')
    const run = forRun(ctx, 'What was the budget before the update?')
    expect(run.recalled.map((m) => m.text)).toEqual(['The launch budget is 9,500'])
    const block = buildMemoryBlock(run.recalled, 12, run)
    expect(block).toMatch(/The launch budget is 9,500[^\n]*\n\s+earlier, no longer true: The launch budget is 8,000 \(until \d{4}-\d{2}-\d{2}\)/)
  })

  it('puts the profile first, under its own heading, and still adds the rule', () => {
    const p = mem({ id: 'p', kind: 'preference', text: 'Decks as PDF' })
    const block = buildMemoryBlock([], 12, { profile: [p] })
    expect(block).toMatch(/^HOW THIS PERSON LIKES THINGS DONE/)
    expect(block).toContain('[preference] Decks as PDF')
    expect(block).not.toContain('WHAT YOU REMEMBER')
    expect(block).toMatch(/not instructions or permissions/)
  })
})

describe('retrievalQueryFor', () => {
  it('uses the prompt, bounded', () => {
    expect(retrievalQueryFor('plan the Lisbon trip')).toBe('plan the Lisbon trip')
    expect(retrievalQueryFor('x'.repeat(900)).length).toBe(400)
  })
})
