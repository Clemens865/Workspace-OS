/**
 * The desk's crux: ONE loud thing, chosen automatically.
 *
 * Home leads with a hero — the single most important thing right now — and
 * everything else supports. Choosing it is a ranking problem, and the ranking
 * is a product decision, so it lives here as a pure, tested function:
 *
 *   1. a case that waits on the person (warmest = most recently updated)
 *   2. an agent working right now (the person should see their team moving)
 *   3. a meeting starting within the next three hours
 *   4. a clear-desk greeting (the empty state is an invitation, not an apology)
 */

export interface HeroCase {
  id: string
  title: string
  status: string
  updated: string
}

export interface HeroRun {
  runId: string
  name: string
  live?: string
}

export interface HeroEvent {
  summary: string
  start: number
}

export interface Hero {
  kind: 'case' | 'agent' | 'event' | 'clear'
  kicker: string
  headline: string
  sub: string
  /** The one blue action. */
  primary: { label: string; go: 'cockpit' | 'agents' | 'calendar' }
  secondary?: { label: string; go: 'cockpit' | 'agents' | 'calendar' }
  /** Set on a case hero — what "Not now" snoozes. */
  caseId?: string
}

const STATUS_LINE: Record<string, { headline: (t: string) => string; sub: string }> = {
  interview: {
    headline: (t) => `${t} moved you to interview.`,
    sub: 'The case holds everything so far — prep can start from there.',
  },
  offer: {
    headline: (t) => `${t} made an offer.`,
    sub: 'The whole thread — application, notes, numbers — is on the case.',
  },
  drafted: {
    headline: (t) => `${t} is drafted, not sent.`,
    sub: 'The draft is attached to the case, waiting for your go.',
  },
}

export function pickHero(input: {
  warmCases: HeroCase[]
  running: HeroRun[]
  nextEvent: HeroEvent | null
  now: number
}): Hero {
  const warm = [...input.warmCases].sort((a, b) => (a.updated < b.updated ? 1 : -1))[0]
  if (warm) {
    const line = STATUS_LINE[warm.status] ?? {
      headline: (t: string) => `${t} is waiting on you.`,
      sub: 'The case has the full thread.',
    }
    return {
      kind: 'case',
      kicker: 'Waiting on you',
      headline: line.headline(warm.title),
      sub: line.sub,
      primary: { label: 'Open the case', go: 'cockpit' },
      secondary: { label: 'All cases', go: 'cockpit' },
      caseId: warm.id,
    }
  }

  const run = input.running[0]
  if (run) {
    const others = input.running.length - 1
    return {
      kind: 'agent',
      kicker: 'Working for you',
      headline: `${run.name} is on it${others > 0 ? ` — and ${others} more` : ''}.`,
      sub: run.live ? `Right now: ${run.live}.` : 'The run trace shows every step as it happens.',
      primary: { label: 'Watch the work', go: 'agents' },
    }
  }

  if (input.nextEvent && input.nextEvent.start - input.now < 3 * 3600_000) {
    const t = new Date(input.nextEvent.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    return {
      kind: 'event',
      kicker: 'Up next',
      headline: `${input.nextEvent.summary} at ${t}.`,
      sub: 'The calendar has the details.',
      primary: { label: 'Open calendar', go: 'calendar' },
    }
  }

  return {
    kind: 'clear',
    kicker: 'All clear',
    headline: 'A clear desk.',
    sub: 'Nothing waits on you. Hand something to an agent, or open where you left off below.',
    primary: { label: 'Meet your agents', go: 'agents' },
  }
}

/**
 * The desk assistant's grounding: the WHOLE overview the person is looking
 * at, plus how to look deeper. The widgets go into the prompt because they
 * are exactly what the human sees; the wos-action lines are how the agent
 * reaches full context (a case's entire thread, the calendar) on its own.
 */
export function buildDeskAsk(
  instruction: string,
  o: {
    cases: { id: string; title: string; status: string }[]
    events: { summary: string; start: number; allDay: boolean }[]
    running: { name: string; live?: string }[]
    files: string[]
    pages: { title: string; url: string }[]
  },
): string {
  const lines: string[] = [instruction.trim() || 'Give me a short briefing on where things stand.', '', 'THE DESK — what the person is looking at right now:']
  lines.push(
    o.cases.length
      ? 'Cases: ' + o.cases.map((c) => `${c.title} [${c.status}] (id: ${c.id})`).join(' · ')
      : 'Cases: none open.',
  )
  lines.push(
    o.events.length
      ? 'Calendar (48h): ' + o.events.map((e) => `${e.allDay ? 'all-day' : new Date(e.start).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })} ${e.summary}`).join(' · ')
      : 'Calendar: nothing in the next 48h.',
  )
  lines.push(
    o.running.length
      ? 'Agents working: ' + o.running.map((r) => `${r.name}${r.live ? ` (${r.live})` : ''}`).join(' · ')
      : 'Agents: none running.',
  )
  if (o.files.length) lines.push('Recent files: ' + o.files.join(' · '))
  if (o.pages.length) lines.push('Open/recent pages: ' + o.pages.map((p) => p.title || p.url).join(' · '))
  lines.push(
    '',
    'To go deeper: `wos-action run cases.get --id "<id>"` returns a case\'s whole thread;',
    '`wos-action run cases.note --id "<id>" --text "<line>"` writes back to it.',
    'Recent files can be read directly by their paths above.',
    'Answer briefly and concretely; do not invent items that are not listed or looked up.',
  )
  return lines.join('\n')
}

/** The greeting's second half: "Two decisions, one agent out." */
export function deskSummary(needsYou: number, running: number): string {
  const parts: string[] = []
  if (needsYou > 0) parts.push(`${needsYou === 1 ? 'One decision' : `${needsYou} decisions`}`)
  if (running > 0) parts.push(`${running === 1 ? 'one agent out' : `${running} agents out`}`)
  if (parts.length === 0) return 'All quiet.'
  return parts.join(', ') + '.'
}

/* ── "Not now" — snoozing a hero without lying about it ──────────────────── */

/**
 * Snoozes: caseId → wake time (epoch ms). Parsed defensively; expired entries
 * are pruned on read, so the map never grows and a snooze quietly ends.
 */
export function parseSnoozes(raw: string | null, now = Date.now()): Record<string, number> {
  try {
    const o = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'number' && v > now) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

/**
 * "Not now" means tomorrow morning — the next local 05:00. Not a fixed
 * duration: snoozing at 23:40 should NOT resurface the case at midnight, and
 * snoozing at 09:00 should not hide it for a full 24 hours either.
 */
export function nextMorning(now = Date.now()): number {
  const d = new Date(now)
  d.setHours(5, 0, 0, 0)
  if (d.getTime() <= now) d.setDate(d.getDate() + 1)
  return d.getTime()
}
