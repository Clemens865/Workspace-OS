import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { AccountsStore, normalizeDomain, labelForDomain } from './accounts-store'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-accounts-'))
})
afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('normalizeDomain', () => {
  it('normalizes bare hosts, URLs, and www to a bare lowercase domain', () => {
    expect(normalizeDomain('linkedin.com')).toBe('linkedin.com')
    expect(normalizeDomain('LinkedIn.com')).toBe('linkedin.com')
    expect(normalizeDomain('https://www.linkedin.com/login?x=1')).toBe('linkedin.com')
    expect(normalizeDomain('  http://WWW.GitHub.com/  ')).toBe('github.com')
    expect(normalizeDomain('mail.google.com')).toBe('mail.google.com') // non-www subdomains kept
    expect(normalizeDomain('app.example.co.uk')).toBe('app.example.co.uk')
  })

  it('rejects non-http(s) schemes, junk, and traversal', () => {
    expect(normalizeDomain('file:///etc/passwd')).toBeNull()
    expect(normalizeDomain('javascript:alert(1)')).toBeNull()
    expect(normalizeDomain('data:text/html,x')).toBeNull()
    expect(normalizeDomain('')).toBeNull()
    expect(normalizeDomain('   ')).toBeNull()
    expect(normalizeDomain('localhost')).toBeNull() // no dot / not a real site
    expect(normalizeDomain('notadomain')).toBeNull()
    expect(normalizeDomain('../../etc')).toBeNull()
    expect(normalizeDomain(123 as unknown)).toBeNull()
    expect(normalizeDomain(null)).toBeNull()
  })
})

describe('labelForDomain', () => {
  it('derives a friendly capitalized label from the first label', () => {
    expect(labelForDomain('linkedin.com')).toBe('Linkedin')
    expect(labelForDomain('github.com')).toBe('Github')
    expect(labelForDomain('mail.google.com')).toBe('Mail')
  })
})

describe('AccountsStore', () => {
  it('add() records a non-secret entry and round-trips through a fresh store', () => {
    const a = new AccountsStore(dir)
    const entry = a.add('https://www.linkedin.com/login')
    expect(entry).not.toBeNull()
    expect(entry?.domain).toBe('linkedin.com')
    expect(entry?.label).toBe('Linkedin')
    expect(typeof entry?.addedAt).toBe('string')
    // Only non-secret keys are persisted — nothing else.
    expect(Object.keys(entry as object).sort()).toEqual(['addedAt', 'domain', 'label'])

    const b = new AccountsStore(dir) // fresh instance reads the same file
    expect(b.list().map((x) => x.domain)).toEqual(['linkedin.com'])
  })

  it('the persisted JSON contains no secret fields', () => {
    const a = new AccountsStore(dir)
    a.add('linkedin.com')
    const raw = fs.readFileSync(path.join(dir, 'connected-accounts.json'), 'utf8')
    const parsed = JSON.parse(raw)
    expect(Array.isArray(parsed)).toBe(true)
    for (const e of parsed) {
      expect(Object.keys(e).sort()).toEqual(['addedAt', 'domain', 'label'])
    }
    expect(raw).not.toMatch(/password|cookie|token|secret/i)
  })

  it('add() is idempotent per domain (no duplicates)', () => {
    const a = new AccountsStore(dir)
    a.add('linkedin.com')
    a.add('https://www.linkedin.com/feed')
    expect(a.list()).toHaveLength(1)
  })

  it('add() returns null for invalid input and stores nothing', () => {
    const a = new AccountsStore(dir)
    expect(a.add('javascript:alert(1)')).toBeNull()
    expect(a.add('')).toBeNull()
    expect(a.list()).toHaveLength(0)
  })

  it('remove() drops the matching entry and returns whether one existed', () => {
    const a = new AccountsStore(dir)
    a.add('linkedin.com')
    a.add('github.com')
    expect(a.remove('https://www.github.com/')).toBe(true)
    expect(a.list().map((x) => x.domain)).toEqual(['linkedin.com'])
    expect(a.remove('github.com')).toBe(false) // already gone
    expect(a.remove('bogus')).toBe(false)
  })

  it('list() degrades to empty on a corrupt file (never throws)', () => {
    fs.writeFileSync(path.join(dir, 'connected-accounts.json'), '{ not json', 'utf8')
    const a = new AccountsStore(dir)
    expect(a.list()).toEqual([])
  })
})
