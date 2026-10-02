import { describe, it, expect } from 'vitest'
import { ago, arrangeRows, codexAskText, derivePresence, providerOf, shorten, splitName, teamSummary, type PresenceInputs } from './agentPresence'
import type { ReviewRun, HitlItem } from '../Review/reviewModel'
import type { AgentPresence } from './presenceTypes'

const T = 1_700_000_000_000

const run = (o: Partial<ReviewRun>): ReviewRun => ({
  runId: 'r1',
  sessionId: 's1',
  sessionName: 'Ada',
  agentId: 's1',
  agentName: 'Ada',
  prompt: 'Compare onboarding flows\nwith details',
  mode: 'full',
  status: 'running',
  checkpointId: null,
  code: null,
  costUsd: 0,
  turns: 0,
  artifacts: [],
  createdAt: T,
  resolvedAt: null,
  ...o,
})

const inputs = (o: Partial<PresenceInputs> = {}): PresenceInputs => ({
  roster: [
    { name: 'Ada', description: 'Researcher. Reads and compares.' },
    { name: 'Milo', description: 'Developer', model: 'codex:gpt-5' },
  ],
  runs: [],
  hitl: [],
  activity: new Map(),
  jobs: [],
  codex: [],
  ...o,
})

const of = (list: AgentPresence[], name: string): AgentPresence => list.find((a) => a.name === name)!

describe('derivePresence', () => {
  it('is idle with no runs, and says nothing it does not know', () => {
    const ada = of(derivePresence(inputs()), 'Ada')
    expect(ada).toMatchObject({ status: 'idle', task: null, activity: null, runId: null, question: null, outputs: [] })
    expect(ada.role).toBe('Researcher. Reads and compares.')
  })

  it('reads the provider from wos_model, then from the latest run', () => {
    expect(of(derivePresence(inputs()), 'Milo').provider).toBe('codex')
    expect(of(derivePresence(inputs({ runs: [run({ agentName: 'Milo', provider: 'claude' })] })), 'Milo').provider).toBe('claude')
  })

  it('is working while a run runs, with the live activity line', () => {
    const activity = new Map([['r1', { tool: 'WebFetch', label: 'deep-reading notion.so', at: T + 5000 }]])
    const ada = of(derivePresence(inputs({ runs: [run({})], activity })), 'Ada')
    expect(ada).toMatchObject({ status: 'working', task: 'Compare onboarding flows', activity: 'deep-reading notion.so', since: T + 5000, runId: 'r1' })
  })

  it('matches agent names case-insensitively', () => {
    expect(of(derivePresence(inputs({ runs: [run({ agentName: ' ada ' })] })), 'Ada').status).toBe('working')
  })

  it('a pending PTY approval on its live session means it needs your answer', () => {
    const hitl: HitlItem[] = [{ sessionId: 's1', sessionName: 'Ada', kind: 'command', question: 'Allow npm install?', createdAt: T + 9 }]
    const ada = of(derivePresence(inputs({ runs: [run({})], hitl })), 'Ada')
    expect(ada).toMatchObject({ status: 'question', question: 'Allow npm install?', runId: 'r1' })
  })

  it('ignores an approval from a session that is not one of its live runs', () => {
    const hitl: HitlItem[] = [{ sessionId: 'other', sessionName: 'X', kind: 'command', question: 'Allow?', createdAt: T }]
    expect(of(derivePresence(inputs({ runs: [run({})], hitl })), 'Ada').status).toBe('working')
  })

  it('a Codex request on one of its runs means it needs your answer', () => {
    const codex = [{ runId: 'r1', requestId: 'q', method: 'item/tool/requestUserInput', text: 'New users or administrators?' }]
    expect(of(derivePresence(inputs({ runs: [run({ agentName: 'Milo' })], codex })), 'Milo')).toMatchObject({ status: 'question', question: 'New users or administrators?' })
  })

  it('a finished run awaiting keep/revert is ready for review, with its files', () => {
    const r = run({ status: 'pending', resolvedAt: T + 60_000, artifacts: [{ path: '/w/Launch plan.md', name: 'Launch plan.md', type: 'md' }] })
    expect(of(derivePresence(inputs({ runs: [r] })), 'Ada')).toMatchObject({ status: 'review', outputs: ['/w/Launch plan.md'], since: T + 60_000 })
  })

  it('a kept or reverted run leaves the agent idle', () => {
    expect(of(derivePresence(inputs({ runs: [run({ status: 'kept', resolvedAt: T + 1 })] })), 'Ada')).toMatchObject({ status: 'idle', task: null, since: T + 1 })
  })

  it('the latest run decides: an old error is superseded by a newer kept run', () => {
    const runs = [run({ runId: 'old', status: 'error', createdAt: T }), run({ runId: 'new', status: 'kept', createdAt: T + 10, resolvedAt: T + 20 })]
    expect(of(derivePresence(inputs({ runs })), 'Ada').status).toBe('idle')
    const flipped = [run({ runId: 'old', status: 'kept', createdAt: T }), run({ runId: 'new', status: 'error', createdAt: T + 10 })]
    expect(of(derivePresence(inputs({ runs: flipped })), 'Ada').status).toBe('error')
  })

  it('a running background job counts as working', () => {
    const jobs = [{ id: 'j1', label: 'Nightly digest', prompt: 'p', agentName: 'Ada', status: 'running' as const, enqueuedAt: T, startedAt: T + 1, finishedAt: null }]
    expect(of(derivePresence(inputs({ jobs })), 'Ada')).toMatchObject({ status: 'working', task: 'Nightly digest', runId: 'j1' })
  })

  it('an interrupted background job shows as interrupted, not as an error', () => {
    const jobs = [{ id: 'j1', label: 'Digest', prompt: 'p', agentName: 'Ada', status: 'interrupted' as const, enqueuedAt: T, startedAt: T, finishedAt: T + 5 }]
    // The feed mirror folded it into 'error'; the job still knows better.
    const runs = [run({ runId: 'j1', status: 'error', createdAt: T, resolvedAt: T + 5 })]
    expect(of(derivePresence(inputs({ jobs, runs })), 'Ada').status).toBe('interrupted')
  })

  it('a cancelled job leaves the agent idle', () => {
    const jobs = [{ id: 'j1', label: 'Digest', prompt: 'p', agentName: 'Ada', status: 'cancelled' as const, enqueuedAt: T, startedAt: T, finishedAt: T + 5 }]
    expect(of(derivePresence(inputs({ jobs })), 'Ada').status).toBe('idle')
  })

  it('never invents a paused state: an error stays an error', () => {
    const all = derivePresence(inputs({ runs: [run({ status: 'error' })] }))
    expect(all.some((a) => a.status === 'paused')).toBe(false)
  })

  it('a run the person paused shows as paused, with its task', () => {
    const ada = of(derivePresence(inputs({ runs: [run({ status: 'paused', resolvedAt: T + 5 })] })), 'Ada')
    expect(ada).toMatchObject({ status: 'paused', task: 'Compare onboarding flows', runId: 'r1' })
  })

  it('a paused background job shows as paused', () => {
    const jobs = [{ id: 'j1', label: 'Digest', prompt: 'p', agentName: 'Ada', status: 'paused' as const, enqueuedAt: T, startedAt: T, finishedAt: T + 5 }]
    expect(of(derivePresence(inputs({ jobs })), 'Ada').status).toBe('paused')
  })
})

describe('arrangeRows', () => {
  const p = (name: string, status: AgentPresence['status'], since = 0): AgentPresence => ({
    id: name, name, provider: 'claude', role: '', about: '', status, task: null, activity: null, since, runId: null, caseId: null, caseTitle: null, question: null, outputs: [],
  })

  it('puts everyone in front for a small team, neediest first', () => {
    const r = arrangeRows([p('a', 'idle'), p('b', 'working'), p('c', 'question')])
    expect(r).toEqual({ front: ['c', 'b', 'a'], back: [] })
  })

  it('fills the front with the needy, then the most recently active idle agents', () => {
    const team = [p('w', 'working'), ...Array.from({ length: 12 }, (_, i) => p(`i${i}`, 'idle', i))]
    const r = arrangeRows(team)
    expect(r.front[0]).toBe('w')
    expect(r.front).toHaveLength(7)
    expect(r.front[1]).toBe('i11') // most recent idle next
    expect(r.back).toHaveLength(6)
  })
})

describe('helpers', () => {
  it('shortens to the first non-empty line', () => {
    expect(shorten('\n  Hello world  \nmore')).toBe('Hello world')
    expect(shorten('x'.repeat(100), 10)).toBe('xxxxxxxxx…')
    expect(shorten('')).toBeNull()
  })

  it('says how long ago', () => {
    expect(ago(T, T + 10_000)).toBe('just now')
    expect(ago(T, T + 8 * 60_000)).toBe('8 min ago')
    expect(ago(T, T + 3 * 3_600_000)).toBe('3 h ago')
    expect(ago(T, T + 3 * 86_400_000)).toBe('3 d ago')
  })

  it('summarises the team like the design', () => {
    const team = [
      { status: 'working' }, { status: 'working' }, { status: 'question' }, { status: 'review' }, { status: 'idle' },
    ] as AgentPresence[]
    expect(teamSummary(team)).toBe('5 agents  •  2 working  •  1 question  •  1 to review')
  })

  it('turns a Codex request into one line', () => {
    expect(codexAskText('item/tool/requestUserInput', { questions: [{ question: 'Who is it for?' }] })).toBe('Who is it for?')
    expect(codexAskText('x/commandExecution/requestApproval', { command: 'npm i' })).toBe('Run: npm i')
    expect(codexAskText('fileChange/requestApproval', {})).toBe('Approve a file change')
  })

  it('splits "Name — Role" agent names', () => {
    expect(splitName('Elias — Application Tailor')).toEqual({ name: 'Elias', role: 'Application Tailor' })
    expect(splitName('Ada')).toEqual({ name: 'Ada', role: null })
    expect(splitName('code-reviewer')).toEqual({ name: 'code-reviewer', role: null })
  })

  it('keeps the full agent name as the id, shows the short name', () => {
    const [p] = derivePresence({ roster: [{ name: 'Nadia — Research Analyst', description: 'Researches' }], runs: [], hitl: [], activity: new Map(), jobs: [], codex: [] })
    expect(p).toMatchObject({ id: 'Nadia — Research Analyst', name: 'Nadia', role: 'Research Analyst' })
  })

  it('reads providers', () => {
    expect(providerOf({ name: 'a', description: '', model: 'codex:gpt-5.1' })).toBe('codex')
    expect(providerOf({ name: 'a', description: '', model: 'sonnet' })).toBe('claude')
    expect(providerOf({ name: 'a', description: '' }, 'codex')).toBe('codex')
  })
})
