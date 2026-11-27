import { describe, it, expect } from 'vitest'
import { describeRule, formOf, rulePatch, changeRules } from './mailRulesModel'
import type { MailRule } from '../../types/workspace-api'

const rule: MailRule = { id: 'r1', domain: 'builds.example', subject: 'nightly', category: 'notification' }

describe('describeRule', () => {
  it('names every condition, since all of them must hold', () => {
    expect(describeRule(rule)).toBe('Domain is builds.example and subject contains “nightly”')
    expect(describeRule({ id: 'r2', from: 'ana', category: 'personal' })).toBe('Sender contains “ana”')
  })
})

describe('rulePatch', () => {
  it('starts from the rule as it is', () => {
    expect(formOf(rule)).toEqual({ from: '', domain: 'builds.example', subject: 'nightly', category: 'notification' })
  })

  it('sends every field, so an emptied condition is removed', () => {
    expect(rulePatch({ from: ' ana ', domain: '', subject: '  ', category: 'personal' })).toEqual({
      ok: true,
      patch: { from: 'ana', domain: '', subject: '', category: 'personal' },
    })
  })

  it('refuses a rule that would match nothing', () => {
    expect(rulePatch({ from: ' ', domain: '', subject: '', category: 'personal' })).toEqual({
      ok: false,
      error: 'Give the rule a sender, a domain or a subject.',
    })
  })
})

describe('changeRules', () => {
  /** The store, as the preload exposes it. */
  function api(rules: MailRule[]) {
    let held = [...rules]
    return {
      list: async () => held,
      remove: async (id: string) => { held = held.filter((r) => r.id !== id) },
    }
  }
  const two: MailRule[] = [rule, { id: 'r2', from: 'ana', category: 'personal' }]

  it('lists the rules', async () => {
    await expect(changeRules(api(two))).resolves.toEqual({ rules: two, error: null })
  })

  it('applies a change and shows what is saved afterwards', async () => {
    const store = api(two)
    await expect(changeRules(store, () => store.remove('r1'))).resolves.toEqual({ rules: [two[1]], error: null })
  })

  it('reports a refused change and still shows the saved rules', async () => {
    const out = await changeRules(api(two), async () => {
      throw new Error("Error invoking remote method 'mail:rules:update': Error: That change would leave the rule matching nothing.")
    })
    expect(out).toEqual({ rules: two, error: 'That change would leave the rule matching nothing.' })
  })

  it('reports an unreadable list', async () => {
    const out = await changeRules({ list: async () => { throw new Error('disk') } })
    expect(out).toEqual({ rules: null, error: 'disk' })
  })
})
