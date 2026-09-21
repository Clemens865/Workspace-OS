import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { MailRuleStore, sanitizeRule } from './rule-store'

/**
 * Rules decide where mail goes, so the failure that matters is a rule that
 * matches more than the person meant. Everything here is about refusing those
 * rather than about storage.
 */

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-rules-'))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('sanitizeRule', () => {
  it('keeps a rule that says something', () => {
    expect(sanitizeRule({ domain: 'github.com', category: 'notification' }, 'r1')).toEqual({
      id: 'r1',
      category: 'notification',
      domain: 'github.com',
    })
  })

  /** The rule that would silently reclassify every message in the mailbox. */
  it('refuses a rule with nothing to match on', () => {
    expect(sanitizeRule({ category: 'newsletter' }, 'r')).toBeNull()
    expect(sanitizeRule({ from: '   ', category: 'newsletter' }, 'r')).toBeNull()
  })

  it('refuses a category it does not have folders for', () => {
    expect(sanitizeRule({ domain: 'x.com', category: 'spam' }, 'r')).toBeNull()
  })

  it('takes the host out of a pasted address', () => {
    expect(sanitizeRule({ domain: 'notifications@github.com', category: 'notification' }, 'r')?.domain)
      .toBe('github.com')
  })

  it('takes the host out of a pasted url', () => {
    expect(sanitizeRule({ domain: 'https://github.com/settings', category: 'notification' }, 'r')?.domain)
      .toBe('github.com')
  })
})

describe('MailRuleStore', () => {
  it('has no rules before any are written', async () => {
    expect(await new MailRuleStore(dir).list()).toEqual([])
  })

  it('keeps rules in the order they were added, because order decides', async () => {
    const s = new MailRuleStore(dir)
    await s.add({ domain: 'github.com', category: 'notification' })
    await s.add({ domain: 'substack.com', category: 'newsletter' })
    expect((await s.list()).map((r) => r.domain)).toEqual(['github.com', 'substack.com'])
  })

  it('moves a rule to change which one wins', async () => {
    const s = new MailRuleStore(dir)
    const a = await s.add({ domain: 'a.com', category: 'newsletter' })
    await s.add({ domain: 'b.com', category: 'newsletter' })
    await s.reorder(a.id, 1)
    expect((await s.list()).map((r) => r.domain)).toEqual(['b.com', 'a.com'])
  })

  it('does not fall off the end when moved past it', async () => {
    const s = new MailRuleStore(dir)
    const a = await s.add({ domain: 'a.com', category: 'newsletter' })
    await s.reorder(a.id, 5)
    expect((await s.list()).map((r) => r.domain)).toEqual(['a.com'])
  })

  it('removes one', async () => {
    const s = new MailRuleStore(dir)
    const a = await s.add({ domain: 'a.com', category: 'newsletter' })
    await s.add({ domain: 'b.com', category: 'newsletter' })
    await s.remove(a.id)
    expect((await s.list()).map((r) => r.domain)).toEqual(['b.com'])
  })

  it('refuses an edit that would leave the rule matching everything', async () => {
    const s = new MailRuleStore(dir)
    const a = await s.add({ domain: 'a.com', category: 'newsletter' })
    await expect(s.update(a.id, { domain: '' })).rejects.toThrow(/matching nothing/)
  })

  /** A broken rules file must not take mail down with it. */
  it('reads a corrupt file as no rules rather than throwing', async () => {
    fs.writeFileSync(path.join(dir, 'mail-rules.json'), '{ not json')
    expect(await new MailRuleStore(dir).list()).toEqual([])
  })

  it('drops an unusable rule from a hand-edited file, keeping the rest', async () => {
    fs.writeFileSync(
      path.join(dir, 'mail-rules.json'),
      JSON.stringify([{ id: 'ok', domain: 'a.com', category: 'newsletter' }, { id: 'bad', category: 'newsletter' }]),
    )
    expect((await new MailRuleStore(dir).list()).map((r) => r.id)).toEqual(['ok'])
  })
})

/**
 * Ids came from Date.now() alone, so two rules added in the same millisecond
 * shared one — and removing either removed both, invisibly.
 */
describe('rule ids', () => {
  it('gives every rule its own id, however fast they are added', async () => {
    const s = new MailRuleStore(dir)
    const made = []
    for (let i = 0; i < 5; i++) made.push(await s.add({ domain: `d${i}.com`, category: 'newsletter' }))
    expect(new Set(made.map((r) => r.id)).size).toBe(5)
    expect((await s.list()).length).toBe(5)
  })

  it('removes exactly one of two added together', async () => {
    const s = new MailRuleStore(dir)
    const a = await s.add({ domain: 'a.com', category: 'newsletter' })
    const b = await s.add({ domain: 'b.com', category: 'newsletter' })
    expect(a.id).not.toBe(b.id)
    await s.remove(a.id)
    expect((await s.list()).map((r) => r.domain)).toEqual(['b.com'])
  })
})
