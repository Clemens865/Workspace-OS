/**
 * Pure run→card mapping and family classification for the Agent Review surface
 * (ContextHub "Living Feed", Direction 4). No React, no I/O — every function
 * here is unit-tested in isolation so the feed's logic is verifiable without a
 * running agent or the DOM.
 *
 * Domain mapping (ContextHub knowledge/email → Workspace-OS agent runs):
 *   - Each completed agent run is one feed card.
 *   - Two families, encoding safety in the interaction (per the design brief):
 *       • edit   — reversible, checkpointed in-workspace edits. Keep / Revert
 *                  are EQUAL one-tap actions (Revert = checkpoint rollback).
 *       • action — irreversible / not-safely-revertable (no checkpoint, or a
 *                  live outbound permission request). The weighty action is
 *                  DRAFT-GATED: the draft tier must be opened before it arms.
 *   Reversibility is defined literally: a run is reversible iff we captured a
 *   checkpoint to roll back to. That is the honest signal, and it is testable.
 */

export type RunFamily = 'edit' | 'action'
export type RunStatus = 'running' | 'pending' | 'kept' | 'reverted' | 'error'

/** A generated/touched file surfaced with the run (mirrors main's Artifact). */
export interface RunArtifactLite {
  path: string
  name: string
  type: string
}

/** One reviewable agent run — accumulated by the review store as runs complete. */
export interface ReviewRun {
  runId: string
  sessionId: string
  sessionName: string
  /**
   * Fleet lane key. Identifies WHICH concurrent agent this run belongs to. In
   * practice this is the session id (one lane per agent tab/session) — the
   * Claude stream-json `parent_tool_use_id` that would attribute a subagent run
   * to its parent lane is not surfaced to the renderer today, so the session id
   * is the honest fallback. Backward-compat: legacy runs without an agentId are
   * folded onto their sessionId at group time.
   */
  agentId: string
  /** Human label for the lane (persona name, else the session's display name). */
  agentName: string | null
  /** Raw input that started the run (the "prompt" tier-3 shows verbatim). */
  prompt: string
  mode: 'full' | 'safe'
  /**
   * Who started it. Absent = the dock (every run before background runs
   * existed). 'background' = enqueued in main; 'routine' = a schedule did.
   */
  origin?: 'dock' | 'background' | 'routine'
  status: RunStatus
  /** Pre-run checkpoint — the revert target and reversibility signal. */
  checkpointId: string | null
  code: number | null
  costUsd: number
  provider?: string
  costKnown?: boolean
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  turns: number
  artifacts: RunArtifactLite[]
  createdAt: number
  resolvedAt: number | null
}

/** A live, outbound permission request from a PTY session — always draft-gated. */
export interface HitlItem {
  sessionId: string
  sessionName: string
  /** Fleet lane key — the owning agent. Falls back to sessionId (see ReviewRun). */
  agentId?: string
  kind: 'edit' | 'command' | 'fetch' | 'connection' | 'generic'
  question: string
  createdAt: number
}

/** The lane key for a run/HITL item — its agentId, falling back to the session. */
export function laneKey(item: { agentId?: string; sessionId: string }): string {
  return item.agentId || item.sessionId
}

/**
 * Family classification. A live HITL request is always an irreversible Action;
 * a completed run is an Action only when it left no checkpoint to roll back to
 * (git unavailable, or a purely outbound op) — otherwise it is a reversible Edit.
 */
export function classifyFamily(run: Pick<ReviewRun, 'checkpointId'>): RunFamily {
  return run.checkpointId ? 'edit' : 'action'
}

/** True when the run is still awaiting the human's Keep/Revert (or Approve). */
export function isPending(status: RunStatus): boolean {
  return status === 'running' || status === 'pending' || status === 'error'
}

/** Accent hex per family/state — the card's top-rail gradient + meters. */
export function familyAccent(family: RunFamily, status?: RunStatus): string {
  if (status === 'error') return '#e87878'
  return family === 'action' ? '#6E9BF4' : '#3FBFA3'
}

const clampLen = (s: string, max: number): string =>
  s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s

/**
 * The one-line "what" for the Glance tier. Prefers the run's own words (its
 * prompt); a doc-gen run leads with its deliverable so the card reads like the
 * brief's "docgen: report.docx".
 */
export function runHeadline(run: Pick<ReviewRun, 'prompt' | 'artifacts'>): string {
  const firstLine = (run.prompt || '').split('\n')[0].trim()
  if (firstLine) return clampLen(firstLine, 96)
  if (run.artifacts.length) return `Generated ${run.artifacts[0].name}`
  return 'Agent run'
}

/** A short deliverable label from artifacts, e.g. "report.docx +2 more". */
export function deliverableLabel(artifacts: RunArtifactLite[]): string | null {
  if (!artifacts.length) return null
  const [first, ...rest] = artifacts
  return rest.length ? `${first.name} +${rest.length} more` : first.name
}

export interface DiffStat {
  files: number
  adds: number
  dels: number
}

export interface StakeChip {
  key: string
  label: string
  /** 'mono' renders in the numeric/stats face. */
  tone?: 'mono' | 'text'
}

/**
 * The minimal "stakes" row — files changed, cost, turns, mode. The diff stat is
 * optional because the card fills it in once the (lazy) diff has loaded.
 */
export function stakeChips(
  run: Pick<ReviewRun, 'costUsd' | 'turns' | 'mode' | 'artifacts' | 'inputTokens' | 'outputTokens'>,
  diff?: DiffStat | null
): StakeChip[] {
  const chips: StakeChip[] = []
  if (diff && diff.files > 0) {
    chips.push({ key: 'files', label: `${diff.files} file${diff.files === 1 ? '' : 's'}`, tone: 'mono' })
    if (diff.adds || diff.dels) {
      chips.push({ key: 'lines', label: `+${diff.adds} −${diff.dels}`, tone: 'mono' })
    }
  } else if (run.artifacts.length) {
    chips.push({
      key: 'artifacts',
      label: `${run.artifacts.length} file${run.artifacts.length === 1 ? '' : 's'}`,
      tone: 'mono',
    })
  }
  if (run.turns > 0) chips.push({ key: 'turns', label: `${run.turns} turn${run.turns === 1 ? '' : 's'}`, tone: 'mono' })
  if (run.inputTokens !== undefined) chips.push({ key: 'tokens', label: `${run.inputTokens.toLocaleString('en-US')} in / ${(run.outputTokens ?? 0).toLocaleString('en-US')} out`, tone: 'mono' })
  if (run.costUsd > 0) chips.push({ key: 'cost', label: `$${run.costUsd.toFixed(4)}`, tone: 'mono' })
  chips.push({ key: 'mode', label: run.mode === 'full' ? 'full access' : 'safe' })
  return chips
}

/** Compact relative time ("just now", "3m", "2h", "5d") from an epoch-ms value. */
export function relTime(ms: number): string {
  const secs = Math.max(0, (Date.now() - ms) / 1000)
  if (secs < 45) return 'just now'
  const mins = secs / 60
  if (mins < 60) return `${Math.floor(mins)}m ago`
  const hrs = mins / 60
  if (hrs < 24) return `${Math.floor(hrs)}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

/** Resolved-state caption, shown once a run is kept/reverted (equal weight). */
export function resolvedLabel(run: Pick<ReviewRun, 'status'>): string {
  switch (run.status) {
    case 'kept':
      return 'Kept'
    case 'reverted':
      return 'Reverted'
    default:
      return ''
  }
}

export interface FeedCounts {
  total: number
  edits: number
  actions: number
  resolved: number
}

export type FeedFilter = 'all' | 'edit' | 'action' | 'resolved'

/** Counts for the left-rail filters, derived from the current run + HITL sets. */
export function feedCounts(runs: ReviewRun[], hitl: HitlItem[]): FeedCounts {
  let edits = 0
  let actions = hitl.length
  let resolved = 0
  for (const r of runs) {
    if (isPending(r.status)) {
      if (classifyFamily(r) === 'action') actions++
      else edits++
    } else {
      resolved++
    }
  }
  return { total: edits + actions, edits, actions, resolved }
}

/** Does a run pass the active filter? (Resolved items only show under 'resolved'/'all'.) */
export function runMatchesFilter(run: ReviewRun, filter: FeedFilter): boolean {
  const pending = isPending(run.status)
  if (filter === 'resolved') return !pending
  if (!pending) return filter === 'all'
  if (filter === 'all') return true
  return classifyFamily(run) === filter
}

// ── Fleet lanes ─────────────────────────────────────────────────────────────
// Turning the single-agent feed into an N-agent cockpit: runs and live HITL
// requests are grouped by their owning agent (the lane key). Every function
// below is pure so the lane math is unit-tested without React or a live agent.

/** A lane's rolled-up status. Precedence, worst-first: error > awaiting > running > done. */
export type LaneStatus = 'error' | 'awaiting-approval' | 'running' | 'done'

/** One agent's lane in the fleet cockpit. */
export interface FleetLane {
  agentId: string
  agentName: string
  status: LaneStatus
  /** Pending runs + live HITL items awaiting the human. */
  pending: number
  /** Runs that reached a terminal (kept/reverted) state. */
  resolved: number
  /** Runs still executing. */
  running: number
  /** Live outbound permission requests awaiting approval. */
  awaiting: number
  /** Summed cost/turns across the lane's runs. */
  costUsd: number
  provider?: string
  costKnown?: boolean
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  turns: number
  /** Newest activity timestamp across runs + HITL (for ordering + "latest" line). */
  latestAt: number
  /** A one-line "what's happening" for the collapsed lane header. */
  latestLine: string
  /** The lane's runs, newest-first. */
  runs: ReviewRun[]
  /** The lane's live HITL requests, newest-first. */
  hitl: HitlItem[]
}

const LANE_STATUS_RANK: Record<LaneStatus, number> = {
  error: 3,
  'awaiting-approval': 2,
  running: 1,
  done: 0,
}

/** Picks the worse (higher-precedence) of two lane statuses. */
function worseStatus(a: LaneStatus, b: LaneStatus): LaneStatus {
  return LANE_STATUS_RANK[a] >= LANE_STATUS_RANK[b] ? a : b
}

/**
 * Groups runs + live HITL requests into per-agent lanes. Pure and deterministic:
 * lanes are ordered by pending-first then most-recent activity, so the agent
 * that needs the human floats to the top. A lane's status is the WORST of its
 * members (error > awaiting-approval > running > done), matching the "what most
 * needs attention" reading the cockpit is for.
 */
export function groupByAgent(runs: ReviewRun[], hitl: HitlItem[]): FleetLane[] {
  const lanes = new Map<string, FleetLane>()

  const ensure = (key: string, name: string): FleetLane => {
    let lane = lanes.get(key)
    if (!lane) {
      lane = {
        agentId: key,
        agentName: name,
        status: 'done',
        pending: 0,
        resolved: 0,
        running: 0,
        awaiting: 0,
        costUsd: 0,
        turns: 0,
        latestAt: 0,
        latestLine: '',
        runs: [],
        hitl: [],
      }
      lanes.set(key, lane)
    }
    return lane
  }

  for (const run of runs) {
    const key = laneKey(run)
    const lane = ensure(key, run.agentName || run.sessionName)
    // A named persona is a better lane label than a bare session name.
    if (run.agentName && lane.agentName !== run.agentName) lane.agentName = run.agentName
    lane.runs.push(run)
    lane.costUsd += run.costUsd
    lane.turns += run.turns
    const at = run.resolvedAt ?? run.createdAt
    if (at > lane.latestAt) {
      lane.latestAt = at
      lane.latestLine = runHeadline(run)
    }
    if (run.status === 'error') {
      lane.status = worseStatus(lane.status, 'error')
      lane.pending++
    } else if (run.status === 'running') {
      lane.status = worseStatus(lane.status, 'running')
      lane.running++
      lane.pending++
    } else if (isPending(run.status)) {
      // 'pending' — awaiting the human's Keep/Revert.
      lane.status = worseStatus(lane.status, 'awaiting-approval')
      lane.pending++
    } else {
      lane.resolved++
    }
  }

  for (const item of hitl) {
    const key = laneKey(item)
    const lane = ensure(key, item.sessionName)
    lane.hitl.push(item)
    lane.awaiting++
    lane.pending++
    lane.status = worseStatus(lane.status, 'awaiting-approval')
    if (item.createdAt > lane.latestAt) {
      lane.latestAt = item.createdAt
      lane.latestLine = item.question
    }
  }

  const out = [...lanes.values()]
  for (const lane of out) {
    lane.runs.sort((a, b) => b.createdAt - a.createdAt)
    lane.hitl.sort((a, b) => b.createdAt - a.createdAt)
  }
  // Lanes needing attention first; within that, most-recent activity first.
  out.sort((a, b) => {
    const ap = a.pending > 0 ? 1 : 0
    const bp = b.pending > 0 ? 1 : 0
    if (ap !== bp) return bp - ap
    return b.latestAt - a.latestAt
  })
  return out
}

// ── Risk-tiered + batched approval ────────────────────────────────────────────
// The differentiator: a pending action is classified by REVERSIBILITY, reusing
// the exact signal the feed already trusts (a captured checkpoint / the edit
// family, and read-only HITL kinds). Reversible-tier items may be auto- or
// batch-approved (opt-in, always logged); gated-tier items never can be.

/** A pending item's risk tier. `auto` = reversible/read-only; `gated` = irreversible/outbound. */
export type ApprovalTier = 'auto' | 'gated'

/** HITL kinds that are read-only (no outbound side effect) → reversible tier. */
const REVERSIBLE_HITL_KINDS: ReadonlySet<HitlItem['kind']> = new Set(['fetch'])

/** Discriminates the two pending shapes approvalTier accepts. */
export type ApprovalItem =
  | { type: 'run'; run: Pick<ReviewRun, 'checkpointId' | 'status'> }
  | { type: 'hitl'; hitl: Pick<HitlItem, 'kind'> }

/**
 * Classifies a pending item's approval tier by reversibility — the honest,
 * already-encoded signal, not a new heuristic:
 *   - A run is `auto` only when it is a reversible EDIT (a checkpoint exists to
 *     roll back to). A run with no checkpoint is an irreversible ACTION → `gated`.
 *   - A live HITL request is `auto` only for read-only kinds (a web fetch);
 *     command / connection / edit-write / generic outbound requests → `gated`.
 * Anything not provably reversible is `gated` — the safe default.
 */
export function approvalTier(item: ApprovalItem): ApprovalTier {
  if (item.type === 'run') {
    return classifyFamily(item.run) === 'edit' ? 'auto' : 'gated'
  }
  return REVERSIBLE_HITL_KINDS.has(item.hitl.kind) ? 'auto' : 'gated'
}

/** True when a pending run is a reversible edit safe to batch-/auto-approve. */
export function isRunBatchable(run: Pick<ReviewRun, 'checkpointId' | 'status'>): boolean {
  return isPending(run.status) && approvalTier({ type: 'run', run }) === 'auto'
}

/** True when a live HITL request is read-only and safe to batch-/auto-approve. */
export function isHitlBatchable(hitl: Pick<HitlItem, 'kind'>): boolean {
  return approvalTier({ type: 'hitl', hitl }) === 'auto'
}

/** What a batch-approve action would resolve, split by tier. Never batches gated. */
export interface BatchSelection {
  /** Reversible pending runs eligible for one-tap batch keep. */
  runs: ReviewRun[]
  /** Reversible live HITL requests eligible for one-tap batch approve. */
  hitl: HitlItem[]
  /** Count of gated items deliberately EXCLUDED — surfaced so the UI can say so. */
  gatedExcluded: number
}

/**
 * Selects only the reversible-tier pending items across the given runs + HITL.
 * Gated/irreversible items are never included — they are counted in
 * `gatedExcluded` so the UI can show "N left for you". Optionally scoped to one
 * lane via `agentId`.
 */
export function selectBatchApprovals(
  runs: ReviewRun[],
  hitl: HitlItem[],
  agentId?: string
): BatchSelection {
  const inLane = (item: { agentId?: string; sessionId: string }): boolean =>
    agentId === undefined || laneKey(item) === agentId

  const batchRuns: ReviewRun[] = []
  const batchHitl: HitlItem[] = []
  let gatedExcluded = 0

  for (const run of runs) {
    if (!isPending(run.status) || !inLane(run)) continue
    if (isRunBatchable(run)) batchRuns.push(run)
    else gatedExcluded++
  }
  for (const item of hitl) {
    if (!inLane(item)) continue
    if (isHitlBatchable(item)) batchHitl.push(item)
    else gatedExcluded++
  }
  return { runs: batchRuns, hitl: batchHitl, gatedExcluded }
}
