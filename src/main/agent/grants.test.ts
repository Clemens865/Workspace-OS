import { describe, it, expect } from 'vitest'
import { GrantTable, allows, prefixesFor } from './grants'

describe('grants', () => {
  it('a capability grants its surface prefix, unknown ids grant nothing', () => {
    expect([...prefixesFor(['research'])]).toEqual(['browser.'])
    expect([...prefixesFor(['cases', 'documents'])].sort()).toEqual(['cases.', 'document.', 'files.'])
    expect([...prefixesFor(['not-a-capability'])]).toEqual([])
  })

  it('allows: prefix match, baseline memory.search, never memory.remember without knowledge', () => {
    const research = prefixesFor(['research'])
    expect(allows(research, 'browser.navigate')).toBe(true)
    expect(allows(research, 'browser.deepRead')).toBe(true)
    expect(allows(research, 'mail.compose')).toBe(false)
    expect(allows(research, 'cases.note')).toBe(false)
    expect(allows(research, 'memory.search')).toBe(true)
    expect(allows(research, 'memory.remember')).toBe(false)
    expect(allows(prefixesFor(['knowledge']), 'memory.remember')).toBe(true)
    expect(allows('all', 'anything.at-all')).toBe(true)
    expect(allows(new Set(), 'browser.navigate')).toBe(false)
  })

  it('issue/lookup/revoke: one token per run, re-issue replaces, revoke forgets', () => {
    const t = new GrantTable()
    const a = t.issue('run-1', ['research'], 'Nadia')
    expect(t.lookup(a)?.label).toBe('Nadia')
    expect(allows(t.lookup(a)!.scope, 'browser.map')).toBe(true)
    const b = t.issue('run-1', 'all')
    expect(t.lookup(a)).toBeUndefined()
    expect(t.lookup(b)?.scope).toBe('all')
    expect(t.size()).toBe(1)
    t.revoke('run-1')
    expect(t.lookup(b)).toBeUndefined()
    expect(t.lookup(undefined)).toBeUndefined()
    expect(t.lookup('')).toBeUndefined()
  })
})
