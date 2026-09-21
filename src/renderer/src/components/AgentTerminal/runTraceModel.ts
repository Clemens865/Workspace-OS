/**
 * Pure model for the run trace — the compact "what the agent actually did"
 * list rendered beside the console (design language: expandable rows, icon +
 * label + mono chip, a collapsed header that counts the work).
 *
 * Kept free of React so the merging/labelling rules are unit-tested in the
 * node environment, like every other view model in this codebase.
 */

export interface TraceStep {
  /** Icon family — think / read / write / run / web / search / app. */
  kind: string
  label: string
  chip?: string
  at: number
  /** How many consecutive identical calls this row stands for. */
  count: number
}

export interface TraceEvent {
  kind: string
  label: string
  chip?: string
}

/** Cap the trail so a long run cannot grow the list unbounded. */
export const TRACE_MAX = 60

/**
 * Appends one activity event to the trail, merging consecutive repeats.
 *
 * A busy tool fires the same call many times (a page being polled, a file
 * re-read); sixty identical rows read as noise, one row with ×12 reads as
 * what happened.
 */
export function appendStep(steps: TraceStep[], ev: TraceEvent, at: number): TraceStep[] {
  const last = steps[steps.length - 1]
  if (last && last.label === ev.label && last.chip === ev.chip) {
    const next = steps.slice(0, -1)
    next.push({ ...last, count: last.count + 1, at })
    return next
  }
  const next = [...steps, { kind: ev.kind, label: ev.label, chip: ev.chip, at, count: 1 }]
  return next.length > TRACE_MAX ? next.slice(next.length - TRACE_MAX) : next
}

/**
 * The collapsed header's text: how much work the trace stands for.
 * Thinking rows are not tool calls, and saying they are would be a small lie
 * the whole surface is built to avoid.
 */
export function traceHeader(steps: TraceStep[]): string {
  const calls = steps.filter((s) => s.kind !== 'think').reduce((n, s) => n + s.count, 0)
  const thought = steps.some((s) => s.kind === 'think')
  if (calls === 0) return thought ? 'Thinking' : 'Working'
  return `${calls} tool call${calls === 1 ? '' : 's'}`
}
