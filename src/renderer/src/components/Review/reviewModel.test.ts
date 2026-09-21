import { describe, it, expect } from 'vitest'
import {
  classifyFamily,
  isPending,
  familyAccent,
  runHeadline,
  deliverableLabel,
  stakeChips,
  resolvedLabel,
  feedCounts,
  runMatchesFilter,
  relTime,
  laneKey,
  groupByAgent,
  approvalTier,
  selectBatchApprovals,
  isRunBatchable,
  isHitlBatchable,
  type ReviewRun,
  type HitlItem,
} from './reviewModel'

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
    createdAt: Date.now(),
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
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('classifyFamily', () => {
  it('checkpointed runs are reversible edits', () => {
    expect(classifyFamily(run({ checkpointId: 'deadbeef' }))).toBe('edit')
  })
  it('runs without a checkpoint are irreversible actions', () => {
    expect(classifyFamily(run({ checkpointId: null }))).toBe('action')
  })
})

describe('isPending', () => {
  it('treats running/pending/error as pending', () => {
    expect(isPending('running')).toBe(true)
    expect(isPending('pending')).toBe(true)
    expect(isPending('error')).toBe(true)
  })
  it('treats kept/reverted as resolved', () => {
    expect(isPending('kept')).toBe(false)
    expect(isPending('reverted')).toBe(false)
  })
})

describe('familyAccent', () => {
  it('distinguishes edit, action and error', () => {
    expect(familyAccent('edit')).toBe('#3FBFA3')
    expect(familyAccent('action')).toBe('#6E9BF4')
    expect(familyAccent('edit', 'error')).toBe('#e87878')
  })
})

describe('runHeadline', () => {
  it('leads with the prompt first line, capped', () => {
    expect(runHeadline({ prompt: 'fix the header\nand more', artifacts: [] })).toBe('fix the header')
  })
  it('falls back to a deliverable when there is no prompt', () => {
    expect(runHeadline({ prompt: '', artifacts: [{ path: '/x/r.docx', name: 'r.docx', type: 'office' }] })).toBe(
      'Generated r.docx'
    )
  })
  it('has a final fallback', () => {
    expect(runHeadline({ prompt: '', artifacts: [] })).toBe('Agent run')
  })
})

describe('deliverableLabel', () => {
  it('is null with no artifacts', () => {
    expect(deliverableLabel([])).toBeNull()
  })
  it('summarizes multiple artifacts', () => {
    expect(
      deliverableLabel([
        { path: '/a', name: 'a.docx', type: 'office' },
        { path: '/b', name: 'b.xlsx', type: 'office' },
      ])
    ).toBe('a.docx +1 more')
  })
})

describe('stakeChips', () => {
  it('uses the diff stat when present, then turns/cost/mode', () => {
    const chips = stakeChips(run({ turns: 3, costUsd: 0.0421, mode: 'full' }), { files: 2, adds: 10, dels: 4 })
    const labels = chips.map((c) => c.label)
    expect(labels).toEqual(['2 files', '+10 −4', '3 turns', '$0.0421', 'full access'])
  })
  it('falls back to artifact count when there is no diff', () => {
    const chips = stakeChips(
      run({ mode: 'safe', turns: 0, costUsd: 0, artifacts: [{ path: '/a', name: 'a.docx', type: 'office' }] }),
      null
    )
    expect(chips.map((c) => c.label)).toEqual(['1 file', 'safe'])
  })
})

describe('resolvedLabel', () => {
  it('labels kept and reverted equally (no affirmative bias)', () => {
    expect(resolvedLabel(run({ status: 'kept' }))).toBe('Kept')
    expect(resolvedLabel(run({ status: 'reverted' }))).toBe('Reverted')
  })
})

describe('feedCounts', () => {
  it('counts pending edits, actions (incl. HITL) and resolved', () => {
    const runs = [
      run({ runId: 'a', checkpointId: 'x', status: 'pending' }),
      run({ runId: 'b', checkpointId: null, status: 'pending' }),
      run({ runId: 'c', checkpointId: 'y', status: 'kept' }),
    ]
    const hitl: HitlItem[] = [{ sessionId: 's', sessionName: 'p', kind: 'command', question: 'run?', createdAt: 0 }]
    expect(feedCounts(runs, hitl)).toEqual({ total: 3, edits: 1, actions: 2, resolved: 1 })
  })
})

describe('runMatchesFilter', () => {
  const pendingEdit = run({ checkpointId: 'x', status: 'pending' })
  const pendingAction = run({ checkpointId: null, status: 'pending' })
  const resolved = run({ status: 'kept' })
  it('all shows every pending item', () => {
    expect(runMatchesFilter(pendingEdit, 'all')).toBe(true)
    expect(runMatchesFilter(pendingAction, 'all')).toBe(true)
  })
  it('family filters split edit vs action', () => {
    expect(runMatchesFilter(pendingEdit, 'edit')).toBe(true)
    expect(runMatchesFilter(pendingAction, 'edit')).toBe(false)
    expect(runMatchesFilter(pendingAction, 'action')).toBe(true)
  })
  it('resolved items only appear under resolved/all', () => {
    expect(runMatchesFilter(resolved, 'resolved')).toBe(true)
    expect(runMatchesFilter(resolved, 'all')).toBe(true)
    expect(runMatchesFilter(resolved, 'edit')).toBe(false)
  })
})

describe('relTime', () => {
  it('reads just now for fresh timestamps', () => {
    expect(relTime(Date.now())).toBe('just now')
  })
  it('reads minutes and hours', () => {
    expect(relTime(Date.now() - 5 * 60_000)).toBe('5m ago')
    expect(relTime(Date.now() - 3 * 3600_000)).toBe('3h ago')
  })
})

describe('laneKey (attribution fallback)', () => {
  it('uses agentId when present', () => {
    expect(laneKey({ agentId: 'lane-A', sessionId: 's9' })).toBe('lane-A')
  })
  it('falls back to sessionId when no agentId (no parent_tool_use_id)', () => {
    expect(laneKey({ sessionId: 's9' })).toBe('s9')
    expect(laneKey({ agentId: '', sessionId: 's9' })).toBe('s9')
  })
})

describe('groupByAgent (fleet lanes)', () => {
  it('splits runs into one lane per agent with correct counts', () => {
    const lanes = groupByAgent(
      [
        run({ runId: 'a1', agentId: 'A', status: 'running' }),
        run({ runId: 'a2', agentId: 'A', status: 'kept' }),
        run({ runId: 'b1', agentId: 'B', status: 'pending' }),
      ],
      []
    )
    expect(lanes.map((l) => l.agentId).sort()).toEqual(['A', 'B'])
    const A = lanes.find((l) => l.agentId === 'A')!
    expect(A.running).toBe(1)
    expect(A.resolved).toBe(1)
    expect(A.pending).toBe(1)
    expect(A.runs).toHaveLength(2)
    const B = lanes.find((l) => l.agentId === 'B')!
    expect(B.pending).toBe(1)
  })

  it('folds legacy runs (agentId = sessionId) into a session lane', () => {
    // A run whose agentId equals its sessionId (the attribution fallback).
    const lanes = groupByAgent([run({ runId: 'x', agentId: 's-legacy', sessionId: 's-legacy' })], [])
    expect(lanes).toHaveLength(1)
    expect(lanes[0].agentId).toBe('s-legacy')
  })

  it('attributes live HITL to its lane and marks it awaiting', () => {
    const lanes = groupByAgent(
      [run({ runId: 'a1', agentId: 'A', status: 'kept' })],
      [hitl({ agentId: 'A', sessionId: 'A' })]
    )
    const A = lanes.find((l) => l.agentId === 'A')!
    expect(A.awaiting).toBe(1)
    expect(A.hitl).toHaveLength(1)
    expect(A.status).toBe('awaiting-approval')
  })

  it('status precedence is error > awaiting > running > done', () => {
    // done only
    expect(groupByAgent([run({ agentId: 'A', status: 'kept' })], [])[0].status).toBe('done')
    // running beats done
    expect(
      groupByAgent([run({ runId: '1', agentId: 'A', status: 'kept' }), run({ runId: '2', agentId: 'A', status: 'running' })], [])[0]
        .status
    ).toBe('running')
    // awaiting (pending run) beats running
    expect(
      groupByAgent(
        [run({ runId: '1', agentId: 'A', status: 'running' }), run({ runId: '2', agentId: 'A', status: 'pending' })],
        []
      )[0].status
    ).toBe('awaiting-approval')
    // error beats everything
    expect(
      groupByAgent(
        [
          run({ runId: '1', agentId: 'A', status: 'pending' }),
          run({ runId: '2', agentId: 'A', status: 'error' }),
          run({ runId: '3', agentId: 'A', status: 'running' }),
        ],
        []
      )[0].status
    ).toBe('error')
  })

  it('sums cost/turns and orders lanes needing attention first', () => {
    const lanes = groupByAgent(
      [
        run({ runId: 'idle', agentId: 'IDLE', status: 'kept', costUsd: 0.01, turns: 2, createdAt: 5000, resolvedAt: 5000 }),
        run({ runId: 'busy', agentId: 'BUSY', status: 'pending', costUsd: 0.02, turns: 3, createdAt: 1000 }),
      ],
      []
    )
    // BUSY has a pending item → floats above IDLE even though IDLE is more recent.
    expect(lanes[0].agentId).toBe('BUSY')
    expect(lanes.find((l) => l.agentId === 'BUSY')!.turns).toBe(3)
    expect(lanes.find((l) => l.agentId === 'IDLE')!.costUsd).toBeCloseTo(0.01)
  })
})

describe('approvalTier (risk tiering)', () => {
  it('reversible edit runs (checkpointed) are auto tier', () => {
    expect(approvalTier({ type: 'run', run: run({ checkpointId: 'cp', status: 'pending' }) })).toBe('auto')
  })
  it('runs without a checkpoint are gated (irreversible action)', () => {
    expect(approvalTier({ type: 'run', run: run({ checkpointId: null, status: 'pending' }) })).toBe('gated')
  })
  it('read-only HITL (fetch) is auto; command/connection/edit/generic are gated', () => {
    expect(approvalTier({ type: 'hitl', hitl: { kind: 'fetch' } })).toBe('auto')
    expect(approvalTier({ type: 'hitl', hitl: { kind: 'command' } })).toBe('gated')
    expect(approvalTier({ type: 'hitl', hitl: { kind: 'connection' } })).toBe('gated')
    expect(approvalTier({ type: 'hitl', hitl: { kind: 'edit' } })).toBe('gated')
    expect(approvalTier({ type: 'hitl', hitl: { kind: 'generic' } })).toBe('gated')
  })
})

describe('batched-approval selection', () => {
  it('batches only reversible items; excludes and counts gated ones', () => {
    const runs = [
      run({ runId: 'edit1', agentId: 'A', checkpointId: 'cp', status: 'pending' }),
      run({ runId: 'action1', agentId: 'A', checkpointId: null, status: 'pending' }),
      run({ runId: 'kept1', agentId: 'A', checkpointId: 'cp', status: 'kept' }), // resolved — not pending
    ]
    const hitls = [
      hitl({ sessionId: 'f', agentId: 'A', kind: 'fetch' }),
      hitl({ sessionId: 'c', agentId: 'A', kind: 'command' }),
    ]
    const sel = selectBatchApprovals(runs, hitls)
    expect(sel.runs.map((r) => r.runId)).toEqual(['edit1'])
    expect(sel.hitl.map((h) => h.sessionId)).toEqual(['f'])
    // action1 (no checkpoint) + command HITL are gated.
    expect(sel.gatedExcluded).toBe(2)
  })

  it('gated/irreversible items are NEVER batchable', () => {
    expect(isRunBatchable(run({ checkpointId: null, status: 'pending' }))).toBe(false)
    expect(isHitlBatchable({ kind: 'command' })).toBe(false)
    expect(isHitlBatchable({ kind: 'connection' })).toBe(false)
  })

  it('scopes to one lane when an agentId is given', () => {
    const runs = [
      run({ runId: 'a-edit', agentId: 'A', checkpointId: 'cp', status: 'pending' }),
      run({ runId: 'b-edit', agentId: 'B', checkpointId: 'cp', status: 'pending' }),
    ]
    const sel = selectBatchApprovals(runs, [], 'A')
    expect(sel.runs.map((r) => r.runId)).toEqual(['a-edit'])
  })
})
