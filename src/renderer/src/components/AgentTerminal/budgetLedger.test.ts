import { describe, it, expect } from 'vitest'
import { emptyLedger, recordRun, formatLedger } from './budgetLedger'

describe('budgetLedger', () => {
  it('starts empty', () => {
    const l = emptyLedger()
    expect(l).toEqual({ runs: 0, turns: 0, costUsd: 0 })
    expect(formatLedger(l)).toBe('')
  })

  it('accumulates runs, turns, and cost purely (no mutation)', () => {
    const a = emptyLedger()
    const b = recordRun(a, { turns: 3, costUsd: 0.012 })
    const c = recordRun(b, { turns: 2, costUsd: 0.008 })
    expect(a).toEqual({ runs: 0, turns: 0, costUsd: 0 }) // original untouched
    expect(b).toEqual({ runs: 1, turns: 3, costUsd: 0.012 })
    expect(c.runs).toBe(2)
    expect(c.turns).toBe(5)
    expect(c.costUsd).toBeCloseTo(0.02, 6)
  })

  it('clamps negative / non-finite contributions to 0', () => {
    const l = recordRun(emptyLedger(), { turns: -5, costUsd: NaN })
    expect(l).toEqual({ runs: 1, turns: 0, costUsd: 0 })
  })

  it('formats -p mode totals with cost', () => {
    const l = recordRun(recordRun(emptyLedger(), { turns: 6, costUsd: 0.0211 }), { turns: 6, costUsd: 0.021 })
    expect(formatLedger(l)).toBe('2 runs · 12 turns · $0.0421')
  })

  it('formats PTY approvals (turns-as-approvals, no cost) with a custom label', () => {
    let l = emptyLedger()
    for (let i = 0; i < 5; i++) l = recordRun(l, { turns: 1 })
    // Runs are also incremented; a PTY session surfaces just the approvals label.
    expect(formatLedger(l, { turnsLabel: 'approval' })).toContain('5 approvals')
  })

  it('singularizes labels', () => {
    const l = recordRun(emptyLedger(), { turns: 1, costUsd: 0.5 })
    expect(formatLedger(l)).toBe('1 run · 1 turn · $0.5000')
  })
})
