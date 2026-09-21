/**
 * Pure run→cockpit mapping for the LIVE Calm Cockpit (Team-lead altitude).
 *
 * The cockpit is a READ over the same reviewStore the feed/fleet use — no new
 * state, no fabricated signals. Every run maps to exactly one of three zones by
 * its real status; every needs-you item carries a categorical LABEL derived from
 * the run's own family/artifacts/kind. All functions here are pure so the whole
 * mapping is unit-tested without React, IPC, or a live agent.
 *
 * Honesty rules (what we DROPPED from the mock):
 *   - No "confidence" (claude -p emits none) — the mock's "0.6 sure" is fiction.
 *     We show REAL signals only: elapsed, turns, cost, the live activity line.
 *   - No invented health colour-temperature — a run is running, pending, or
 *     resolved; error is the only distinguished state.
 */

import type { ReviewRun, HitlItem, RunActivityLite } from './cockpitTypes'
import { laneKey } from '../Review/reviewModel'

// ── The categorical LABEL system ──────────────────────────────────────────────
// A quiet, Linear/Things-grade tag on every needs-you item saying WHAT is needed.
// Derived from the honest signals already in the run — never a new heuristic:
//   REVIEW   — a checkpointed file edit (there is a diff to look over / undo)
//   SEND     — an outbound draft (a mail draft, or a HITL fetch/connection)
//   DECISION — an approval with no checkpoint and no file (a pure yes/no)
//   ERROR    — the run failed and wants a look
export type LabelCategory = 'REVIEW' | 'SEND' | 'DECISION' | 'ERROR'

export interface CockpitLabel {
  category: LabelCategory
  /** The short, human word shown in the tag ("Review", "Send", …). */
  text: string
}

// HUMAN, sentence-case wording (the "A+D blend") — not uppercase taxonomy.
//   ERROR → "Failed", SEND → "To send", REVIEW → "To review", DECISION → "Your call".
const LABEL_TEXT: Record<LabelCategory, string> = {
  REVIEW: 'To review',
  SEND: 'To send',
  DECISION: 'Your call',
  ERROR: 'Failed',
}

/** Builds a full CockpitLabel from a bare category (used by the mock preview). */
export function labelFor(category: LabelCategory): CockpitLabel {
  return { category, text: LABEL_TEXT[category] }
}

/** Sort order for grouping the needs-you list — errors first, then send, review, decision. */
export const LABEL_ORDER: Record<LabelCategory, number> = {
  ERROR: 0,
  SEND: 1,
  REVIEW: 2,
  DECISION: 3,
}

/** File extensions that read as an outbound/communication artifact. */
const SENDABLE_EXT = /\.(eml|msg)$/i

/**
 * Derives a needs-you run's label category from its REAL shape:
 *   - error status                       → ERROR
 *   - has a checkpoint (reversible edit)  → REVIEW  (there's a diff to keep/undo)
 *   - an outbound artifact (.eml/.msg)    → SEND
 *   - otherwise                           → DECISION (a plain approval)
 * The checkpoint is the same signal `classifyFamily` trusts, so a REVIEW label
 * and the Keep/Revert affordance always agree.
 */
export function runLabel(run: Pick<ReviewRun, 'status' | 'checkpointId' | 'artifacts'>): CockpitLabel {
  const cat = runLabelCategory(run)
  return { category: cat, text: LABEL_TEXT[cat] }
}

function runLabelCategory(run: Pick<ReviewRun, 'status' | 'checkpointId' | 'artifacts'>): LabelCategory {
  if (run.status === 'error') return 'ERROR'
  if (run.checkpointId) return 'REVIEW'
  if (run.artifacts.some((a) => SENDABLE_EXT.test(a.name))) return 'SEND'
  return 'DECISION'
}

/** A live HITL request's label — outbound kinds SEND, read-only fetches SEND-to-review. */
export function hitlLabel(item: Pick<HitlItem, 'kind'>): CockpitLabel {
  const cat: LabelCategory = item.kind === 'edit' ? 'REVIEW' : 'SEND'
  return { category: cat, text: LABEL_TEXT[cat] }
}

// ── Zone selectors ────────────────────────────────────────────────────────────

/** One WORKING presence cell — a running agent, its live line, real meters. */
export interface WorkingCell {
  runId: string
  agentId: string
  who: string
  /** The latest AGENT_ACTIVITY label, or a calm fallback when none seen yet. */
  live: string
  costUsd: number
  turns: number
  /** Run start (epoch ms) → elapsed. A REAL signal (no fabricated confidence). */
  startedAt: number
  /** The lens buckets this cell groups under. */
  group: LensGroups
}

/** One NEEDS-YOU decision — a pending/error run (or a HITL request). */
export interface NeedsYouItem {
  id: string
  agentId: string
  who: string
  /** Plain-language "what happened" line (the run's own words / the question). */
  line: string
  label: CockpitLabel
  /** The primary (leaned) action's verb — 'keep' opens/keeps, 'approve' sends. */
  kind: 'run' | 'hitl'
  /** For a run: whether a checkpoint exists (Revert is possible). */
  reversible: boolean
  runId?: string
  checkpointId?: string | null
  sessionId?: string
  artifactPath?: string | null
  /** Basename of that artifact — the caption under its preview. */
  artifactName?: string | null
  turns: number
  costUsd: number
  createdAt: number
}

/** One LANDED result — a resolved run that produced at least one artifact. */
export interface LandedItem {
  id: string
  who: string
  line: string
  /** Primary openable artifact (real office.openFile path), if any. */
  openPath: string | null
  /** How many further artifacts fold behind the primary ("+N more"). */
  moreCount: number
  resolvedAt: number
}

/** The four lens buckets a working cell / run belongs to. */
export interface LensGroups {
  agent: string
  status: string
  kind: string
}

export const LENSES = ['agent', 'status', 'kind'] as const
export type Lens = (typeof LENSES)[number]

/** The three-zone live cockpit read (composed by useCockpitData). */
export interface CockpitData {
  status: string
  working: WorkingCell[]
  needsYou: NeedsYouItem[]
  landed: LandedItem[]
}

/** Derives the lens buckets for a run — all from real fields. */
export function lensGroupsForRun(run: Pick<ReviewRun, 'agentName' | 'sessionName' | 'artifacts'>): LensGroups {
  const kind = run.artifacts[0]?.type ?? 'task'
  return {
    agent: run.agentName || run.sessionName || 'Agent',
    status: 'Working',
    kind: kind.charAt(0).toUpperCase() + kind.slice(1),
  }
}

/** Maps running runs → WORKING cells, newest-first, with their latest live line. */
export function selectWorking(runs: ReviewRun[], activity: Map<string, RunActivityLite>): WorkingCell[] {
  return runs
    .filter((r) => r.status === 'running')
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({
      runId: r.runId,
      agentId: laneKey(r),
      who: r.agentName || r.sessionName || 'Agent',
      live: activity.get(r.runId)?.label || firstLine(r.prompt) || 'starting up…',
      costUsd: r.costUsd,
      turns: r.turns,
      startedAt: r.createdAt,
      group: lensGroupsForRun(r),
    }))
}

/**
 * Maps pending/error runs + live HITL requests → NEEDS-YOU items, grouped by
 * label category (errors → send → review → decision), then newest-first within
 * a category. This is the ordering the cockpit renders.
 */
export function selectNeedsYou(runs: ReviewRun[], hitl: HitlItem[]): NeedsYouItem[] {
  const items: NeedsYouItem[] = []

  for (const r of runs) {
    if (r.status !== 'pending' && r.status !== 'error') continue
    items.push({
      id: `run-${r.runId}`,
      agentId: laneKey(r),
      who: r.agentName || r.sessionName || 'Agent',
      line: firstLine(r.prompt) || (r.artifacts[0] ? `Produced ${r.artifacts[0].name}` : 'Agent run'),
      label: runLabel(r),
      kind: 'run',
      reversible: Boolean(r.checkpointId),
      runId: r.runId,
      checkpointId: r.checkpointId,
      artifactPath: r.artifacts[0]?.path ?? null,
      artifactName: r.artifacts[0]?.name ?? null,
      turns: r.turns,
      costUsd: r.costUsd,
      createdAt: r.createdAt,
    })
  }

  for (const h of hitl) {
    items.push({
      id: `hitl-${h.sessionId}`,
      agentId: laneKey(h),
      who: h.sessionName || 'Agent',
      line: h.question,
      label: hitlLabel(h),
      kind: 'hitl',
      reversible: false,
      sessionId: h.sessionId,
      turns: 0,
      costUsd: 0,
      createdAt: h.createdAt,
    })
  }

  items.sort((a, b) => {
    const byCat = LABEL_ORDER[a.label.category] - LABEL_ORDER[b.label.category]
    if (byCat !== 0) return byCat
    return b.createdAt - a.createdAt
  })
  return items
}

/**
 * Maps pending MAIL cards → NEEDS-YOU items.
 *
 * A mail awaiting a reply is the same kind of obligation as an agent run
 * awaiting approval, so it belongs in the same list rather than in a separate
 * "mail" box the user has to remember to check. That is the whole point of the
 * cockpit: one place where everything that needs you lives.
 *
 * The label is SEND, matching the existing taxonomy — a drafted reply is an
 * outbound action awaiting approval, exactly like the agent's.
 *
 * `reversible` is false and honest: sending is the one irreversible act in the
 * mail client, so the cockpit must not offer a Revert affordance next to it.
 */
export function selectMailNeedsYou(cards: MailCardLite[]): NeedsYouItem[] {
  return cards
    .filter((c) => c.status !== 'sent' && c.status !== 'dismissed')
    .map((c) => ({
      id: `mail-${c.id}`,
      agentId: 'mail',
      who: c.fromLabel || 'Mail',
      line: c.subject || '(no subject)',
      label: { category: 'SEND' as const, text: LABEL_TEXT.SEND },
      kind: 'run' as const,
      reversible: false,
      turns: 0,
      costUsd: 0,
      createdAt: c.createdAt,
    }))
}

/** The subset of a mail-review card the cockpit reads. */
export interface MailCardLite {
  id: string
  subject: string
  fromLabel: string
  status: string
  createdAt: number
}

/** Maps resolved runs with artifacts → LANDED results, newest-first. */
export function selectLanded(runs: ReviewRun[]): LandedItem[] {
  return runs
    .filter((r) => (r.status === 'kept' || r.status === 'reverted') && r.artifacts.length > 0)
    .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0))
    .map((r) => ({
      id: r.runId,
      who: r.agentName || r.sessionName || 'Agent',
      line: firstLine(r.prompt) || `Produced ${r.artifacts[0].name}`,
      openPath: r.artifacts[0]?.path ?? null,
      moreCount: Math.max(0, r.artifacts.length - 1),
      resolvedAt: r.resolvedAt ?? r.createdAt,
    }))
}

/** Groups WORKING cells by the active lens — the Prism's actual work. */
export function groupWorking(cells: WorkingCell[], lens: Lens): [string, WorkingCell[]][] {
  const map = new Map<string, WorkingCell[]>()
  for (const c of cells) {
    const key = c.group[lens]
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(c)
  }
  return [...map.entries()]
}

/** The distinct label categories present in the needs-you list, in render order. */
export function needsYouCategories(items: NeedsYouItem[]): LabelCategory[] {
  const seen = new Set<LabelCategory>()
  for (const i of items) seen.add(i.label.category)
  return [...seen].sort((a, b) => LABEL_ORDER[a] - LABEL_ORDER[b])
}

/** One plain-language status line for the whole surface — all real counts. */
export function cockpitStatus(working: number, needs: number): string {
  if (working === 0 && needs === 0) return 'All calm — no agents running.'
  const parts: string[] = []
  if (working > 0) parts.push(`${working} agent${working === 1 ? '' : 's'} working`)
  if (needs > 0) parts.push(`${needs} thing${needs === 1 ? '' : 's'} need${needs === 1 ? 's' : ''} you`)
  else parts.push('nothing needs you')
  return parts.join(' · ') + '.'
}

/** Compact "3m" / "2h" elapsed from a start epoch (no "ago" — it's live). */
export function elapsed(ms: number, now = Date.now()): string {
  const secs = Math.max(0, (now - ms) / 1000)
  if (secs < 60) return `${Math.floor(secs)}s`
  const mins = secs / 60
  if (mins < 60) return `${Math.floor(mins)}m`
  return `${Math.floor(mins / 60)}h`
}

function firstLine(s: string): string {
  const line = (s || '').split('\n')[0].trim()
  return line.length > 90 ? line.slice(0, 89).trimEnd() + '…' : line
}
