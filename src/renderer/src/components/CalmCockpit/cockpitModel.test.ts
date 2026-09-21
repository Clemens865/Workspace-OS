import { describe, it, expect } from 'vitest'
import {
  runLabel,
  hitlLabel,
  selectWorking,
  selectNeedsYou,
  selectLanded,
  groupWorking,
  needsYouCategories,
  cockpitStatus,
  elapsed,
  LABEL_ORDER,
  selectMailNeedsYou,
} from './cockpitModel'
import type { ReviewRun, HitlItem, RunActivityLite } from './cockpitTypes'

function run(overrides: Partial<ReviewRun> = {}): ReviewRun {
  return {
    runId: 'run-1',
    sessionId: 's1',
    sessionName: 'Agent 1',
    agentId: 's1',
    agentName: null,
    prompt: 'summarize the open file',
    mode: 'full',
    status: 'pending',
    checkpointId: 'abc1234',
    code: 0,
    costUsd: 0,
    turns: 0,
    artifacts: [],
    createdAt: 1000,
    resolvedAt: null,
    ...overrides,
  }
}

function hitl(overrides: Partial<HitlItem> = {}): HitlItem {
  return {
    sessionId: 's1',
    sessionName: 'Agent 1',
    agentId: 's1',
    kind: 'command',
    question: 'run rm -rf?',
    createdAt: 1000,
    ...overrides,
  }
}

describe('runLabel — categorical LABEL derivation from real signals', () => {
  it('an error run → ERROR', () => {
    expect(runLabel(run({ status: 'error', checkpointId: 'x' })).category).toBe('ERROR')
  })
  it('a checkpointed edit → REVIEW (there is a diff to keep/undo)', () => {
    expect(runLabel(run({ checkpointId: 'abc', artifacts: [] })).category).toBe('REVIEW')
  })
  it('an outbound .eml artifact with no checkpoint → SEND', () => {
    const r = run({ checkpointId: null, artifacts: [{ path: '/d/reply.eml', name: 'reply.eml', type: 'other' }] })
    expect(runLabel(r).category).toBe('SEND')
  })
  it('no checkpoint, no outbound artifact → DECISION', () => {
    expect(runLabel(run({ checkpointId: null, artifacts: [] })).category).toBe('DECISION')
  })
  it('label text is the human, sentence-case wording for the category', () => {
    expect(runLabel(run({ checkpointId: 'abc' })).text).toBe('To review')
    expect(runLabel(run({ status: 'error', checkpointId: 'x' })).text).toBe('Failed')
    expect(runLabel(run({ checkpointId: null, artifacts: [] })).text).toBe('Your call')
  })
})

describe('hitlLabel', () => {
  it('an edit-write request → REVIEW', () => {
    expect(hitlLabel({ kind: 'edit' }).category).toBe('REVIEW')
  })
  it('a command/connection request → SEND', () => {
    expect(hitlLabel({ kind: 'command' }).category).toBe('SEND')
  })
})

describe('zone selectors — status → zone mapping', () => {
  it('running runs land in WORKING with their latest activity line', () => {
    const activity = new Map<string, RunActivityLite>([['run-1', { tool: 'WebFetch', label: 'deep-reading notion.so', at: 5 }]])
    const cells = selectWorking([run({ status: 'running' })], activity)
    expect(cells).toHaveLength(1)
    expect(cells[0].live).toBe('deep-reading notion.so')
  })
  it('WORKING falls back to the prompt when no activity is captured', () => {
    const cells = selectWorking([run({ status: 'running', prompt: 'build the deck' })], new Map())
    expect(cells[0].live).toBe('build the deck')
  })
  it('pending + error runs land in NEEDS-YOU; kept/reverted/running do not', () => {
    const runs = [
      run({ runId: 'a', status: 'pending' }),
      run({ runId: 'b', status: 'error' }),
      run({ runId: 'c', status: 'kept' }),
      run({ runId: 'd', status: 'running' }),
    ]
    const ids = selectNeedsYou(runs, []).map((i) => i.id)
    expect(ids).toContain('run-a')
    expect(ids).toContain('run-b')
    expect(ids).not.toContain('run-c')
    expect(ids).not.toContain('run-d')
  })
  it('live HITL requests appear in NEEDS-YOU', () => {
    const items = selectNeedsYou([], [hitl()])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('hitl')
  })
  it('only resolved runs WITH artifacts land in LANDED', () => {
    const runs = [
      run({ runId: 'a', status: 'kept', artifacts: [{ path: '/x.docx', name: 'x.docx', type: 'office' }], resolvedAt: 2000 }),
      run({ runId: 'b', status: 'kept', artifacts: [] }),
      run({ runId: 'c', status: 'pending', artifacts: [{ path: '/y.docx', name: 'y.docx', type: 'office' }] }),
    ]
    const landed = selectLanded(runs)
    expect(landed).toHaveLength(1)
    expect(landed[0].openPath).toBe('/x.docx')
  })
  it('LANDED counts extra artifacts as "+N more"', () => {
    const r = run({ status: 'reverted', artifacts: [
      { path: '/a', name: 'a', type: 'office' },
      { path: '/b', name: 'b', type: 'office' },
      { path: '/c', name: 'c', type: 'office' },
    ] })
    expect(selectLanded([r])[0].moreCount).toBe(2)
  })
})

describe('needs-you grouping by label category', () => {
  it('orders items errors → send → review → decision', () => {
    const runs = [
      run({ runId: 'dec', status: 'pending', checkpointId: null }), // DECISION
      run({ runId: 'rev', status: 'pending', checkpointId: 'cp' }), // REVIEW
      run({ runId: 'err', status: 'error', checkpointId: 'cp' }), // ERROR
    ]
    const cats = selectNeedsYou(runs, []).map((i) => i.label.category)
    expect(cats[0]).toBe('ERROR')
    expect(cats.indexOf('REVIEW')).toBeLessThan(cats.indexOf('DECISION'))
  })
  it('needsYouCategories lists present categories in order', () => {
    const items = selectNeedsYou([
      run({ runId: 'd', status: 'pending', checkpointId: null }),
      run({ runId: 'r', status: 'pending', checkpointId: 'cp' }),
    ], [])
    expect(needsYouCategories(items)).toEqual(['REVIEW', 'DECISION'])
  })
  it('LABEL_ORDER is stable and complete', () => {
    expect(LABEL_ORDER.ERROR).toBeLessThan(LABEL_ORDER.SEND)
    expect(LABEL_ORDER.REVIEW).toBeLessThan(LABEL_ORDER.DECISION)
  })
})

describe('lens grouping of working cells', () => {
  it('groups by agent name', () => {
    const activity = new Map<string, RunActivityLite>()
    const cells = selectWorking([
      run({ runId: 'a', status: 'running', agentName: 'Scout' }),
      run({ runId: 'b', status: 'running', agentName: 'Scout' }),
      run({ runId: 'c', status: 'running', agentName: 'Analyst' }),
    ], activity)
    const groups = groupWorking(cells, 'agent')
    const scout = groups.find(([k]) => k === 'Scout')
    expect(scout?.[1]).toHaveLength(2)
  })
})

describe('status line + elapsed — real counts only', () => {
  it('empty state reads calm', () => {
    expect(cockpitStatus(0, 0)).toBe('All calm — no agents running.')
  })
  it('summarizes working + needs counts', () => {
    expect(cockpitStatus(2, 1)).toContain('2 agents working')
    expect(cockpitStatus(2, 1)).toContain('1 thing needs you')
  })
  it('elapsed formats seconds/minutes/hours', () => {
    expect(elapsed(0, 30_000)).toBe('30s')
    expect(elapsed(0, 5 * 60_000)).toBe('5m')
    expect(elapsed(0, 2 * 3_600_000)).toBe('2h')
  })
})

describe('selectMailNeedsYou', () => {
  const card = (over: Partial<Parameters<typeof selectMailNeedsYou>[0][number]> = {}) => ({
    id: 'acct:INBOX:5',
    subject: 'Can you join Thursday?',
    fromLabel: 'Ana Meier <ana@x.com>',
    status: 'drafted',
    createdAt: 1_000,
    ...over,
  })

  it('surfaces a mail awaiting a reply as a needs-you item', () => {
    const [item] = selectMailNeedsYou([card()])
    expect(item.line).toBe('Can you join Thursday?')
    expect(item.who).toBe('Ana Meier <ana@x.com>')
  })

  it('labels it SEND, matching the existing taxonomy', () => {
    // A drafted reply is an outbound action awaiting approval — exactly what
    // the agent's own SEND label already means.
    expect(selectMailNeedsYou([card()])[0].label.category).toBe('SEND')
  })

  it('is NOT reversible — sending is the one irreversible act', () => {
    // The cockpit must not offer a Revert affordance next to something that
    // cannot be taken back once delivered.
    expect(selectMailNeedsYou([card()])[0].reversible).toBe(false)
  })

  it('drops cards that are already resolved', () => {
    expect(selectMailNeedsYou([card({ status: 'sent' })])).toEqual([])
    expect(selectMailNeedsYou([card({ status: 'dismissed' })])).toEqual([])
  })

  it('keeps cards still needing a draft or mid-flight', () => {
    expect(selectMailNeedsYou([card({ status: 'needs-draft' })])).toHaveLength(1)
    expect(selectMailNeedsYou([card({ status: 'drafting' })])).toHaveLength(1)
    expect(selectMailNeedsYou([card({ status: 'send-error' })])).toHaveLength(1)
  })

  it('renders an empty subject readably rather than as blank', () => {
    expect(selectMailNeedsYou([card({ subject: '' })])[0].line).toBe('(no subject)')
  })

  it('reports no cost or turns, because a mail has neither', () => {
    // Fabricating a cost for something that did not run an agent would be the
    // kind of invented signal cockpitModel's header rules out.
    const [item] = selectMailNeedsYou([card()])
    expect(item.costUsd).toBe(0)
    expect(item.turns).toBe(0)
  })
})
