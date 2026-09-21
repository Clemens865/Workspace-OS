import type { WorkCase } from '../../types/workspace-api'

/**
 * The Head-of altitude, built from real cases.
 *
 * This view was a story about a company with six teams. The shape it invented
 * — work moving left to right through named stages, one of them warm — turned
 * out to be exactly right; it was only the data that was fiction. A case
 * already has a type and an ordered set of statuses, so the river is a
 * rearrangement of what is on disk rather than a new thing to maintain.
 *
 * Two rules keep it honest at this altitude:
 *
 * ONE WARM ZONE. A stage runs warm only when something in it is actually
 * waiting on the person — an offer it raised and nobody took, or a case that
 * has not moved in long enough to have been forgotten. Warmth that decorates
 * every column teaches people to stop seeing it.
 *
 * FINISHED WORK SETTLES. Terminal statuses collapse into one closing stage.
 * They are the evidence that the flow flows; they are not work.
 */

/** How long a case can sit untouched before it reads as forgotten. */
export const STALE_DAYS = 10

export interface FlowItem {
  id: string
  label: string
  /** The one-line description, when the case has one. */
  note: string
  /** Waiting on the person: an unanswered offer, or gone quiet. */
  warm: boolean
  /** Why it is warm, in plain words. Empty when it is not. */
  why: string
  updated: number
}

export interface FlowStage {
  id: string
  title: string
  /** Count and age, as a person would say them. */
  hint: string
  warm: boolean
  items: FlowItem[]
}

export interface Flow {
  /** The area this river is showing. */
  fn: string
  /** Every area with cases, for switching between them. */
  areas: string[]
  status: string
  stages: FlowStage[]
  total: number
}

const DAY = 86_400_000

function ms(iso: string): number {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

/** Cases per type, most-populated first — the area worth opening on. */
export function areasIn(cases: WorkCase[]): string[] {
  const counts = new Map<string, number>()
  for (const c of cases) counts.set(c.type, (counts.get(c.type) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t)
}

/**
 * Why a case wants the person, or empty if it does not.
 *
 * Deliberately narrow. "Needs you" that fires on everything is the same as no
 * signal at all, so it is exactly two things: it asked for something and got
 * no answer, or it went quiet while still open.
 */
export function wantsYou(c: WorkCase, now: number, terminal: ReadonlySet<string>): string {
  const open = c.signals?.length ?? 0
  if (open > 0) return open === 1 ? 'asked for something' : `asked for ${open} things`
  if (terminal.has(c.status)) return ''
  const days = Math.floor((now - ms(c.updated)) / DAY)
  return days >= STALE_DAYS ? `quiet ${days} days` : ''
}

function stageHint(items: FlowItem[], now: number): string {
  if (items.length === 0) return 'nothing here'
  const oldest = Math.min(...items.map((i) => i.updated))
  const days = Math.floor((now - oldest) / DAY)
  const n = `${items.length}`
  if (days <= 0) return `${n} · today`
  return `${n} · oldest ${days} ${days === 1 ? 'day' : 'days'}`
}

/**
 * One area's cases as a river.
 *
 * `statuses` is the type's own ordered vocabulary and `terminal` the ones that
 * end a case — both come from the same place the stage row in a card does, so
 * the two surfaces can never disagree about what the stages are.
 */
export function buildFlow(
  cases: WorkCase[],
  statuses: string[],
  terminal: ReadonlySet<string>,
  opts: { area?: string; now?: number } = {},
): Flow {
  const now = opts.now ?? Date.now()
  const areas = areasIn(cases)
  const fn = opts.area && areas.includes(opts.area) ? opts.area : (areas[0] ?? '')
  const mine = cases.filter((c) => c.type === fn)

  const toItem = (c: WorkCase): FlowItem => {
    const why = wantsYou(c, now, terminal)
    return {
      id: c.id,
      label: c.title,
      note: c.description ?? '',
      warm: why !== '',
      why,
      updated: ms(c.updated),
    }
  }

  const flowing = statuses.filter((s) => !terminal.has(s))
  const stages: FlowStage[] = flowing.map((s) => {
    const items = mine.filter((c) => c.status === s).map(toItem).sort((a, b) => b.updated - a.updated)
    return {
      id: s,
      title: s,
      hint: stageHint(items, now),
      warm: items.some((i) => i.warm),
      items,
    }
  })

  /*
   * A case whose status is not in its type's vocabulary still exists.
   *
   * Hand-edited files and older cases are both normal here. Dropping them would
   * make the river quietly disagree with the count of cases the person can see
   * on the previous screen, which is the kind of discrepancy nobody debugs.
   */
  const known = new Set(statuses)
  const stray = mine.filter((c) => !known.has(c.status))
  if (stray.length > 0) {
    const items = stray.map(toItem)
    stages.unshift({
      id: '_other',
      title: 'elsewhere',
      hint: stageHint(items, now),
      warm: items.some((i) => i.warm),
      items,
    })
  }

  const done = mine.filter((c) => terminal.has(c.status)).map(toItem)
  if (done.length > 0) {
    stages.push({
      id: '_done',
      title: 'settled',
      hint: `${done.length} finished`,
      warm: false,
      items: done.sort((a, b) => b.updated - a.updated),
    })
  }

  return { fn, areas, status: flowStatus(fn, stages, terminal), stages, total: mine.length }
}

/**
 * The line at the top, in plain language.
 *
 * A sentence rather than counts in boxes: the whole point of standing back is
 * to be told how it is going, and "4 in flight · 2 blocked" is a dashboard
 * asking to be decoded rather than an answer.
 */
export function flowStatus(fn: string, stages: FlowStage[], terminal: ReadonlySet<string>): string {
  const live = stages.filter((s) => s.id !== '_done')
  const moving = live.reduce((n, s) => n + s.items.length, 0)
  const warm = live.flatMap((s) => s.items).filter((i) => i.warm).length
  const settled = stages.find((s) => s.id === '_done')?.items.length ?? 0
  void terminal

  // No area at all is the first-run state, not an empty area.
  if (!fn) return 'No cases yet. One opens the moment an agent does something worth keeping.'
  if (moving === 0 && settled === 0) return `Nothing in ${fn} yet.`
  if (moving === 0) return `Nothing open in ${fn} — ${settled} settled.`

  const head = `${moving} ${moving === 1 ? 'thing is' : 'things are'} moving in ${fn}`
  if (warm === 0) return `${head}. Nothing needs you.`
  return `${head}. ${warm} ${warm === 1 ? 'wants' : 'want'} you.`
}
