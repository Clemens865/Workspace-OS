import { normalize, type MemoryStore } from './memory-store'
import { embedPending, remember, storesOf, type MemoryContext } from './memory-service'
import { alreadyKnown } from './proposals'

/**
 * The nightly tidy: what memory does on its own, with no model and nothing the
 * person would not do themselves.
 *
 *  - Exact repeats (the same words, even filed under different kinds; a repeat
 *    of the same kind is already merged when written) fold into one, the other
 *    kept as its history. Only exact ones: measured, the meaning model rates "send decks as
 *    PDF" vs "send invoices as PDF" (0.957) closer than most true repeats, so
 *    anything looser is left for the person to judge.
 *  - An agent's proposal nobody kept in 30 days is let go. The Inbox asked;
 *    silence for a month is an answer. The person's own memories are never
 *    touched.
 *  - Decisions noted in Pulse since the last tidy come in as proposals
 *    (unconfirmed, at most five), so what was decided in a Claude Code session
 *    reaches the agents here too.
 *  - Memories still without a meaning vector get one.
 */

export const LET_GO_AFTER_MS = 30 * 86_400_000
export const TIDY_EVERY_MS = 20 * 3_600_000
const MAX_IMPORTS = 5

export interface TidyReport {
  at: number
  folded: number
  letGo: number
  imported: number
}

/** A decision noted elsewhere (Pulse), offered as a memory. */
export interface OutsideDecision {
  text: string
  /** When it was noted, ms. */
  at: number
}

function foldRepeats(store: MemoryStore): number {
  const keep = new Map<string, string>() // words → the memory that stays
  let folded = 0
  // Kept ones first, then the most repeated, then the oldest: the survivor is the most trusted.
  const live = store.allLive().sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || b.reinforced - a.reinforced || a.createdAt - b.createdAt)
  for (const m of live) {
    const k = normalize(m.text)
    const into = keep.get(k)
    if (into) folded += store.fold(m.id, into) ? 1 : 0
    else keep.set(k, m.id)
  }
  return folded
}

export function lastTidy(ctx: MemoryContext): TidyReport | null {
  if (!ctx.root) return null
  const raw = storesOf(ctx)[0].getMeta('tidy')
  try {
    return raw ? (JSON.parse(raw) as TidyReport) : null
  } catch {
    return null
  }
}

/** Is a tidy due for this workspace (once a day)? */
export function tidyDue(ctx: MemoryContext, now = Date.now()): boolean {
  if (!ctx.root) return false
  const last = lastTidy(ctx)
  return !last || now - last.at >= TIDY_EVERY_MS
}

export async function tidy(ctx: MemoryContext, opts: { now?: number; outside?: readonly OutsideDecision[] } = {}): Promise<TidyReport> {
  const now = opts.now ?? Date.now()
  const report: TidyReport = { at: now, folded: 0, letGo: 0, imported: 0 }
  if (!ctx.root) return report
  const since = lastTidy(ctx)?.at ?? now - 7 * 86_400_000
  for (const store of storesOf(ctx)) {
    report.folded += foldRepeats(store)
    for (const m of store.unkeptBefore(now - LET_GO_AFTER_MS)) report.letGo += store.forget(m.id) ? 1 : 0
  }
  for (const d of (opts.outside ?? []).filter((x) => x.at > since).slice(-MAX_IMPORTS)) {
    const text = d.text.replace(/\s+/g, ' ').trim().slice(0, 300)
    if (text.length < 8 || alreadyKnown(ctx, text)) continue
    remember(ctx, { kind: 'decision', text, source: 'noted in Pulse', author: 'agent' })
    report.imported++
  }
  await embedPending(ctx).catch(() => 0)
  storesOf(ctx)[0].setMeta('tidy', JSON.stringify(report))
  return report
}
