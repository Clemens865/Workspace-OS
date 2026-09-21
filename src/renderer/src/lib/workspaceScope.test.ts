import { describe, it, expect } from 'vitest'
import { scopeKey, scopedKey, readScoped, EVERYWHERE, type StringStorage } from './workspaceScope'

function mem(init: Record<string, string> = {}): StringStorage & { dump: () => Record<string, string> } {
  const m = new Map(Object.entries(init))
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  }
}

describe('workspaceScope', () => {
  it('scopeKey: stable per root, trailing slash ignored, no root = everywhere', () => {
    expect(scopeKey('/Users/me/ws')).toBe(scopeKey('/Users/me/ws/'))
    expect(scopeKey('/Users/me/ws')).not.toBe(scopeKey('/Users/me/other'))
    expect(scopeKey('/Users/me/ws')).toMatch(/^ws-[0-9a-f]+$/)
    expect(scopeKey(null)).toBe(EVERYWHERE)
    expect(scopeKey('')).toBe(EVERYWHERE)
    expect(scopedKey('k', EVERYWHERE)).toBe('k:everywhere')
    expect(scopedKey('k', 'ws-1')).toBe('k:ws-1')
  })

  it('readScoped: "everywhere" only borrows the legacy blob; the first workspace scope adopts it and removes it', () => {
    const s = mem({ 'base': '{"legacy":true}' })
    expect(readScoped(s, 'base', EVERYWHERE)).toBe('{"legacy":true}')
    expect(s.dump()).toEqual({ 'base': '{"legacy":true}' })
    expect(readScoped(s, 'base', 'ws-a')).toBe('{"legacy":true}')
    expect(s.dump()).toEqual({ 'base:ws-a': '{"legacy":true}' })
    // A second scope does not inherit it.
    expect(readScoped(s, 'base', 'ws-b')).toBeNull()
    // The adopting scope keeps reading its own copy.
    expect(readScoped(s, 'base', 'ws-a')).toBe('{"legacy":true}')
  })

  it('readScoped: an existing scoped blob wins over a legacy one', () => {
    const s = mem({ 'base': 'old', 'base:ws-a': 'mine' })
    expect(readScoped(s, 'base', 'ws-a')).toBe('mine')
    expect(s.getItem('base')).toBe('old')
  })
})
