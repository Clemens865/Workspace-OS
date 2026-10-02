import { describe, expect, it } from 'vitest'
import { runStakes } from './AgentFocus'

describe('runStakes', () => {
  it('says turns, cost and tokens, leaving out what is empty', () => {
    expect(runStakes({ turns: 4, costUsd: 0.123, inputTokens: 15_000, outputTokens: 3_200 })).toBe('4 turns · $0.12 · 18k tokens')
    expect(runStakes({ turns: 1, costUsd: 0 })).toBe('1 turn')
    expect(runStakes({ turns: 0, costUsd: 0 })).toBeNull()
  })

  it('is honest when a provider does not report cost', () => {
    expect(runStakes({ turns: 2, costUsd: 0, costKnown: false })).toBe('2 turns · cost not reported')
  })
})
