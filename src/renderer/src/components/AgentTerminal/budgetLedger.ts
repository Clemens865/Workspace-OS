/**
 * Per-session budget ledger for the agent console.
 *
 * Adapted from Chrome_Buddy's `src/cost/budget.ts` + `budget-ledger.ts`: a pure,
 * unit-tested running total, kept out of any UI/IO. Chrome_Buddy accumulated USD
 * spend against a daily cap; here we accumulate what a Workspace-OS session
 * actually exposes:
 *   - `-p`/stream-json mode surfaces real cost + turns from each `result` event
 *     (see handlers/agent.ts → AGENT_RUN_META), so both totals are exact.
 *   - PTY-interactive mode has no structured cost signal, so it counts approvals
 *     as a coarse "turns" proxy and leaves cost at 0.
 *
 * The core is a plain reducer (`emptyLedger` + `recordRun`) so it round-trips
 * through tests without a clock, storage, or the DOM.
 */

export interface SessionLedger {
  /** Number of runs recorded this session. */
  runs: number
  /** Total assistant turns across all runs. */
  turns: number
  /** Total USD spend across all runs (0 in PTY mode — no cost signal). */
  costUsd: number
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
}

export function emptyLedger(): SessionLedger {
  return { runs: 0, turns: 0, costUsd: 0 }
}

/** One run's contribution. Negative/NaN values are clamped to 0 (defensive:
 *  these numbers come off an IPC boundary / parsed TUI stream). */
export interface RunContribution {
  turns?: number
  costUsd?: number
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
}

function clamp(n: number | undefined): number {
  return typeof n === 'number' && isFinite(n) && n > 0 ? n : 0
}

/** Pure accumulate: returns a NEW ledger with the run folded in. */
export function recordRun(ledger: SessionLedger, run: RunContribution): SessionLedger {
  return {
    ...ledger,
    ...(run.inputTokens === undefined ? {} : { inputTokens: clamp(ledger.inputTokens) + clamp(run.inputTokens), outputTokens: clamp(ledger.outputTokens) + clamp(run.outputTokens), cachedInputTokens: clamp(ledger.cachedInputTokens) + clamp(run.cachedInputTokens) }),
    runs: ledger.runs + 1,
    turns: ledger.turns + clamp(run.turns),
    costUsd: ledger.costUsd + clamp(run.costUsd),
  }
}

/**
 * Compact header string, extending the existing dim cost trailer. Examples:
 *   "3 runs · 12 turns · $0.0421"   (-p mode, real cost)
 *   "5 approvals"                    (PTY mode, turns-as-approvals, no cost)
 * Returns '' for an empty ledger so the header stays clean before any activity.
 */
export function formatLedger(ledger: SessionLedger, opts?: { turnsLabel?: string }): string {
  if (ledger.runs === 0 && ledger.turns === 0) return ''
  const parts: string[] = []
  if (ledger.runs > 0) parts.push(`${ledger.runs} run${ledger.runs === 1 ? '' : 's'}`)
  if (ledger.turns > 0) {
    const label = opts?.turnsLabel ?? 'turn'
    parts.push(`${ledger.turns} ${label}${ledger.turns === 1 ? '' : 's'}`)
  }
  if (ledger.costUsd > 0) parts.push(`$${ledger.costUsd.toFixed(4)}`)
  if (ledger.inputTokens !== undefined) parts.push(`${ledger.inputTokens.toLocaleString('en-US')} in / ${(ledger.outputTokens ?? 0).toLocaleString('en-US')} out`)
  return parts.join(' · ')
}
