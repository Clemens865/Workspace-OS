import { describe, expect, it } from 'vitest'
import { isValidModelAlias, modelArgs, modelsUsed } from './launchRun'

describe('launchRun — model selection', () => {
  it('accepts aliases and first-party ids, rejects anything else', () => {
    expect(isValidModelAlias('fable')).toBe(true)
    expect(isValidModelAlias('claude-opus-5')).toBe(true)
    expect(isValidModelAlias('')).toBe(true) // '' = the default model
    expect(isValidModelAlias('--dangerously-skip')).toBe(false)
    expect(isValidModelAlias('a b')).toBe(false)
    expect(isValidModelAlias(42)).toBe(false)
  })

  it('emits the flag pair only for a valid alias', () => {
    expect(modelArgs('haiku')).toEqual(['--model', 'haiku'])
    expect(modelArgs('')).toEqual([])
    expect(modelArgs(undefined)).toEqual([])
    expect(modelArgs('x y')).toEqual([])
  })

  it('reads the models a result line used, without the context-window suffix', () => {
    expect(modelsUsed({ modelUsage: { 'claude-opus-5[1m]': {}, 'claude-haiku-4-5': {} } })).toBe('claude-opus-5 + claude-haiku-4-5')
    expect(modelsUsed({})).toBe('')
  })
})
