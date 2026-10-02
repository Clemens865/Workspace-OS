import { describe, it, expect } from 'vitest'
import { filterCases, isDraftOf } from './CasesView'
import type { WorkCase } from '../../types/workspace-api'

const c = (id: string, title: string, updated: string, extra: Partial<WorkCase> = {}): WorkCase => ({
  id, title, updated, type: 'task', description: '', subject: '', status: 'open', artifacts: [], notes: [], acted: [], created: updated, ...extra,
})

describe('cases shelf', () => {
  it('lists the most recently touched first', () => {
    const out = filterCases([c('a', 'Alpha', '2026-01-01T00:00:00Z'), c('b', 'Beta', '2026-03-01T00:00:00Z')], '')
    expect(out.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('searches title, subject and description', () => {
    const list = [c('a', 'Launch copy', '2026-01-01'), c('b', 'Pricing', '2026-01-02', { subject: 'small teams' })]
    expect(filterCases(list, 'launch').map((x) => x.id)).toEqual(['a'])
    expect(filterCases(list, 'TEAMS').map((x) => x.id)).toEqual(['b'])
  })

  it('knows a draft of the case from anything else', () => {
    expect(isDraftOf('c1', 'Work/c1/drafts/plan.md')).toBe(true)
    expect(isDraftOf('c1', '/ws/Work/c1/drafts/a/b.png')).toBe(true)
    expect(isDraftOf('c1', 'Work/c1/outputs/plan.md')).toBe(false)
    expect(isDraftOf('c1', 'Work/c10/drafts/plan.md')).toBe(false)
  })
})
