import { describe, expect, it } from 'vitest'
import { isValidModelAlias, modelArgs, parseModelPick, parseConversation } from './modelPick'

describe('modelPick', () => {
  it('restores both providers and legacy conversations without accepting argv injection', () => {
    const id = '00000000-0000-0000-0000-000000000001'
    expect(parseConversation(id)).toEqual({ provider: 'claude', sessionId: id })
    for (const provider of ['claude', 'codex']) expect(parseConversation(`${provider}:${id}`)).toEqual({ provider, sessionId: id })
    for (const value of ['codex:--last', 'unknown:' + id, null, 'codex:bad']) expect(parseConversation(value)).toBeNull()
  })
  it('parses bare Claude aliases and provider-prefixed picks', () => {
    expect(parseModelPick('')).toEqual({ provider: 'claude', model: '' })
    expect(parseModelPick('haiku')).toEqual({ provider: 'claude', model: 'haiku' })
    expect(parseModelPick('codex:')).toEqual({ provider: 'codex', model: '' })
    expect(parseModelPick('codex:gpt-5-codex')).toEqual({ provider: 'codex', model: 'gpt-5-codex' })
    expect(parseModelPick('claude:opus')).toEqual({ provider: 'claude', model: 'opus' })
  })

  it('falls back to the Claude default for anything unknown or unsafe', () => {
    expect(parseModelPick('gemini:pro')).toEqual({ provider: 'claude', model: '' })
    expect(parseModelPick('codex:--dangerous')).toEqual({ provider: 'claude', model: '' })
    expect(parseModelPick(undefined)).toEqual({ provider: 'claude', model: '' })
    expect(isValidModelAlias('codex:gpt-5')).toBe(true)
    expect(isValidModelAlias('codex:a b')).toBe(false)
  })

  it('builds the flag pair only for a plain model', () => {
    expect(modelArgs('haiku')).toEqual(['--model', 'haiku'])
    expect(modelArgs('')).toEqual([])
  })
})
