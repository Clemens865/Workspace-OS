import { describe, expect, it } from 'vitest'
import { workPresence } from './workPresence'
import type { Session, WorkItem } from '../../lib/sessions/sessionModel'

const sess = (over: Partial<Session> = {}): Session => ({ id: 's1', title: 'Grants', agentName: 'Felix — Funding Scout', caseId: null, createdAt: 1, lastAt: 5, turns: 1, files: ['/w/a.md'], lastRunId: 'r1', messages: [{ role: 'user', text: 'Find grants', at: 1 }], ...over })

describe('workPresence', () => {
  it('a session that is running is working; a finished one is ready for review', () => {
    const items: WorkItem[] = [{ kind: 'session', id: 'session:s1', title: 'Grants', lastAt: 5, session: sess() }]
    const runs = [{ runId: 'r1', status: 'pending' }] as never
    expect(workPresence(items, runs, () => true, new Map())[0].status).toBe('working')
    const p = workPresence(items, runs, () => false, new Map())[0]
    expect(p).toMatchObject({ id: 'session:s1', kind: 'work', status: 'review', role: 'with Felix', task: 'Find grants', runId: 'r1', outputs: ['/w/a.md'] })
  })

  it('a case carries its last note and its agents', () => {
    const items: WorkItem[] = [{ kind: 'case', id: 'case:c1', caseId: 'c1', title: 'Pilot', lastAt: 9, sessions: [sess({ caseId: 'c1' })] }]
    const p = workPresence(items, [], () => false, new Map([['c1', { id: 'c1', status: 'open', lastNote: 'Budget approved', artifacts: [] }]]))[0]
    expect(p).toMatchObject({ caseId: 'c1', about: 'Budget approved', role: 'with Felix', status: 'idle' })
  })
})
