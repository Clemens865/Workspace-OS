import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { MemoryStore, normalize, toMatchQuery, score } from './memory-store'

let dir: string
let store: MemoryStore
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-mem-'))
  store = new MemoryStore(path.join(dir, 'memory.db'))
})
afterEach(() => {
  store.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const fact = (text: string, source = 'you told me') =>
  ({ kind: 'fact' as const, text, source })

describe('normalize', () => {
  it('ignores case, punctuation and spacing when comparing', () => {
    expect(normalize('The Q3 model!')).toBe(normalize('the  q3   model'))
  })

  it('keeps genuinely different text different', () => {
    expect(normalize('Q3 model')).not.toBe(normalize('Q4 model'))
  })
})

describe('toMatchQuery', () => {
  it('quotes terms and ORs them, so a multi-word query behaves like a search box', () => {
    expect(toMatchQuery('revenue forecast')).toBe('"revenue"* OR "forecast"*')
  })

  it('neutralises input that would be an FTS5 syntax error', () => {
    // A bare AND / OR / apostrophe would otherwise throw and read as "search is broken".
    expect(toMatchQuery("client's AND budget")).toBe('"client"* OR "and"* OR "budget"*')
  })

  it('returns null when there is nothing searchable', () => {
    expect(toMatchQuery('   ')).toBeNull()
    expect(toMatchQuery('!!! ?')).toBeNull()
  })
})

describe('score', () => {
  const now = Date.now()
  it('prefers a reinforced memory over a one-off at equal relevance', () => {
    const once = { reinforced: 1, updatedAt: now }
    const often = { reinforced: 8, updatedAt: now }
    expect(score(often, 1, now)).toBeGreaterThan(score(once, 1, now))
  })

  it('prefers recent over stale at equal relevance', () => {
    const fresh = { reinforced: 1, updatedAt: now }
    const old = { reinforced: 1, updatedAt: now - 400 * 86_400_000 }
    expect(score(fresh, 1, now)).toBeGreaterThan(score(old, 1, now))
  })

  it('still lets relevance dominate — a match beats a stale favourite', () => {
    const relevant = { reinforced: 1, updatedAt: now - 200 * 86_400_000 }
    const irrelevant = { reinforced: 5, updatedAt: now }
    expect(score(relevant, 6, now)).toBeGreaterThan(score(irrelevant, 0, now))
  })
})

describe('remember', () => {
  it('stores and returns a memory', () => {
    const m = store.remember(fact('The Q3 model lives in budget.xlsx'))
    expect(m.id).toBeTruthy()
    expect(m.reinforced).toBe(1)
    expect(m.scope).toBe('workspace') // workspace-scoped by default
    expect(store.get(m.id)?.text).toContain('Q3 model')
  })

  it('REQUIRES a source — an unattributable fact cannot be trusted or corrected', () => {
    expect(() => store.remember({ kind: 'fact', text: 'x', source: '' })).toThrow(/source/i)
  })

  it('rejects empty text', () => {
    expect(() => store.remember({ kind: 'fact', text: '   ', source: 's' })).toThrow(/text/i)
  })

  it('REINFORCES a duplicate instead of storing it twice', () => {
    // Agents re-observe the same fact constantly; duplicates would crowd out
    // everything else at retrieval time.
    const a = store.remember(fact('Invoices go to accounts@acme.com'))
    const b = store.remember(fact('invoices go to ACCOUNTS@ACME.COM!'))
    expect(b.id).toBe(a.id)
    expect(b.reinforced).toBe(2)
    expect(store.list()).toHaveLength(1)
  })

  it('treats the same text under a different kind as a different memory', () => {
    store.remember({ kind: 'fact', text: 'Send decks as PDF', source: 's' })
    store.remember({ kind: 'preference', text: 'Send decks as PDF', source: 's' })
    expect(store.list()).toHaveLength(2)
  })

  it('supports an explicit global scope for facts about the person', () => {
    const m = store.remember({ kind: 'preference', text: 'Prefers metric units', source: 'you told me', scope: 'global' })
    expect(m.scope).toBe('global')
  })
})

describe('search', () => {
  beforeEach(() => {
    store.remember(fact('The Q3 revenue model lives in budget.xlsx'))
    store.remember(fact('Acme renewal is due in March'))
    store.remember({ kind: 'preference', text: 'Always send decks as PDF', source: 'you told me' })
    store.remember({ kind: 'decision', text: 'We chose CalDAV before Google Calendar for sovereignty', source: 'run 42' })
  })

  it('finds a memory by its words', () => {
    expect(store.search('revenue')[0].text).toContain('Q3 revenue model')
  })

  it('matches a prefix, so partial words still find things', () => {
    expect(store.search('renew').some((m) => m.text.includes('Acme'))).toBe(true)
  })

  it('matches any term, not all of them', () => {
    expect(store.search('budget nonexistentword').length).toBeGreaterThan(0)
  })

  it('answers "what do you know" with something rather than nothing', () => {
    // An empty/termless query returns the strongest memories instead of [].
    expect(store.search('   ').length).toBeGreaterThan(0)
  })

  it('does not crash on input that is FTS5 syntax', () => {
    expect(() => store.search('AND OR NOT "')).not.toThrow()
  })

  it('excludes superseded memories from results', () => {
    const [m] = store.search('renewal')
    store.supersede(m.id, fact('Acme renewal moved to June'))
    const after = store.search('renewal')
    expect(after.some((x) => x.text.includes('March'))).toBe(false)
    expect(after.some((x) => x.text.includes('June'))).toBe(true)
  })

  it('respects the limit', () => {
    expect(store.search('the', 2).length).toBeLessThanOrEqual(2)
  })
})

describe('correction and forgetting', () => {
  it('supersede keeps the old row as history but hides it from listings', () => {
    const first = store.remember(fact('The budget owner is Dana'))
    const second = store.supersede(first.id, fact('The budget owner is Sam'))!
    expect(store.get(first.id)?.supersededBy).toBe(second.id) // history kept
    expect(store.list().map((m) => m.text)).toEqual(['The budget owner is Sam'])
  })

  it('supersede on an unknown id returns null rather than inventing a memory', () => {
    expect(store.supersede('nope', fact('x'))).toBeNull()
  })

  it('forget really deletes — the forget button has to be real', () => {
    const m = store.remember(fact('Temporary note'))
    expect(store.forget(m.id)).toBe(true)
    expect(store.get(m.id)).toBeNull()
    expect(store.search('temporary')).toHaveLength(0)
  })

  it('forget reports false for an unknown id', () => {
    expect(store.forget('nope')).toBe(false)
  })
})

describe('markUsed + stats', () => {
  it('records when a memory was retrieved into context', () => {
    const m = store.remember(fact('Used memory'))
    expect(store.get(m.id)?.lastUsedAt).toBeNull()
    store.markUsed([m.id])
    expect(store.get(m.id)?.lastUsedAt).toBeGreaterThan(0)
  })

  it('markUsed with no ids is a no-op', () => {
    expect(() => store.markUsed([])).not.toThrow()
  })

  it('counts live memories by kind', () => {
    store.remember(fact('a'))
    store.remember({ kind: 'preference', text: 'b', source: 's' })
    const s = store.stats()
    expect(s.total).toBe(2)
    expect(s.byKind.fact).toBe(1)
    expect(s.byKind.preference).toBe(1)
  })
})

describe('persistence', () => {
  it('survives a reopen — memory that vanishes on restart is not memory', () => {
    const p = path.join(dir, 'persist.db')
    const a = new MemoryStore(p)
    a.remember(fact('Durable fact'))
    a.close()
    const b = new MemoryStore(p)
    expect(b.search('durable')).toHaveLength(1)
    b.close()
  })
})

describe('tags', () => {
  it('round-trips multiple tags without splitting them into characters', () => {
    // The separator is a control character, invisible in most output — so this
    // test exists precisely because the code cannot be eyeballed.
    const m = store.remember({ kind: 'entity', text: 'Acme Corp', source: 's', tags: ['client', 'enterprise'] })
    expect(store.get(m.id)?.tags).toEqual(['client', 'enterprise'])
  })

  it('keeps a tag containing a comma intact', () => {
    const m = store.remember({ kind: 'entity', text: 'Comma tag', source: 's', tags: ['legal, finance'] })
    expect(store.get(m.id)?.tags).toEqual(['legal, finance'])
  })

  it('makes tags searchable', () => {
    store.remember({ kind: 'entity', text: 'Northwind', source: 's', tags: ['supplier'] })
    expect(store.search('supplier').some((x) => x.text === 'Northwind')).toBe(true)
  })

  it('handles no tags', () => {
    const m = store.remember(fact('untagged'))
    expect(store.get(m.id)?.tags).toEqual([])
  })
})
