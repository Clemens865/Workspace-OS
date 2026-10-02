/**
 * Pure model for the landscape's Today view: the old Home dashboard's
 * functions (docs/landscape/ADOPTION.md, B1) composed for the landscape.
 *
 * The ranking and sentences stay where they were proven (Shell/home: pickHero,
 * buildActivity, deskSummary, greeting); this module only decides what the
 * Today view shows and where each action leads in the landscape.
 */
import { pickHero, deskSummary, type Hero } from '../../Shell/home/deskModel'
import { buildActivity, greeting, type ActivityItem } from '../../Shell/home/homeModel'

/** Case statuses that wait on the person (same set as Home). */
export const NEEDS_YOU = new Set(['drafted', 'interview', 'offer'])

export interface TodayCase {
  id: string
  title: string
  status: string
  updated: string
  lastNote: string
  lastNoteAt: number
  lastNoteAuthor: string
}

export interface TodayEvent {
  uid: string
  summary: string
  start: number
  end: number
  allDay: boolean
}

export interface TodayRun {
  runId: string
  name: string
  status: string
  prompt: string
  at: number
  live?: string
}

export interface TodayInput {
  now: number
  cases: TodayCase[]
  events: TodayEvent[]
  runs: TodayRun[]
  /** Files that appeared in the workspace (newest first or any order). */
  created: { path: string; at: number }[]
  /** Files the person opened (useWorkspaceLibrary). */
  recent: { path: string; ts: number }[]
  openTabs: { url: string; title: string }[]
  history: { url: string; title?: string }[]
  mailAccounts: number
  /** Mail cards still waiting for a reply (not sent, not dismissed). */
  mailWaiting: { id: string; subject: string; from: string }[]
  /** caseId → snoozed until (epoch ms). */
  snoozes: Record<string, number>
}

/** Where a Today action leads, in landscape terms. */
export type TodayGo =
  | { to: 'case'; caseId?: string }
  | { to: 'cases' }
  | { to: 'team' }
  | { to: 'surface'; rail: 'calendar' | 'mail' | 'browser' | 'files' }

export interface TodayHero extends Hero {
  /** How many heroes compete (warm cases); "1 of N" when more than one. */
  of: number
  go: TodayGo
  goSecondary?: TodayGo
}

export interface TodayFile {
  path: string
  name: string
  at: number
  /** 'new' = an agent or the person created it; 'opened' = from the recent list. */
  tag: 'new' | 'opened'
}

export interface TodayPage {
  url: string
  title: string
  open: boolean
}

export interface TodayModel {
  greeting: string
  summary: string
  hero: TodayHero
  next: TodayEvent[]
  mail: { accounts: number; waiting: { id: string; subject: string; from: string }[] }
  away: ActivityItem[]
  files: TodayFile[]
  pages: TodayPage[]
}

/** Home's `go` targets mapped onto the landscape. */
function mapGo(go: Hero['primary']['go'], caseId?: string): TodayGo {
  if (go === 'calendar') return { to: 'surface', rail: 'calendar' }
  if (go === 'agents') return { to: 'team' }
  return caseId ? { to: 'case', caseId } : { to: 'cases' }
}

const name = (p: string): string => p.split('/').pop() ?? p

/** Created files first (they are news), then opened ones; one entry per path. */
export function mergeFiles(created: TodayInput['created'], recent: TodayInput['recent'], max = 12): TodayFile[] {
  const out: TodayFile[] = []
  const seen = new Set<string>()
  for (const c of [...created].sort((a, b) => b.at - a.at)) {
    if (seen.has(c.path)) continue
    seen.add(c.path)
    out.push({ path: c.path, name: name(c.path), at: c.at, tag: 'new' })
  }
  for (const r of [...recent].sort((a, b) => b.ts - a.ts)) {
    if (seen.has(r.path)) continue
    seen.add(r.path)
    out.push({ path: r.path, name: name(r.path), at: r.ts, tag: 'opened' })
  }
  return out.slice(0, max)
}

/** Open tabs first, then visited pages not already open; one entry per url. */
export function mergePages(open: TodayInput['openTabs'], history: TodayInput['history'], max = 10): TodayPage[] {
  const out: TodayPage[] = []
  const seen = new Set<string>()
  for (const t of open) {
    if (!t.url || seen.has(t.url)) continue
    seen.add(t.url)
    out.push({ url: t.url, title: t.title || t.url, open: true })
  }
  for (const h of history) {
    if (!h.url || seen.has(h.url)) continue
    seen.add(h.url)
    out.push({ url: h.url, title: h.title || h.url, open: false })
  }
  return out.slice(0, max)
}

export function buildToday(i: TodayInput): TodayModel {
  const warm = i.cases.filter((c) => NEEDS_YOU.has(c.status) && !(i.snoozes[c.id] > i.now))
  const running = i.runs.filter((r) => r.status === 'running')
  const upcoming = i.events.filter((e) => e.end > i.now).sort((a, b) => a.start - b.start)
  const hero = pickHero({
    warmCases: warm,
    running: running.map((r) => ({ runId: r.runId, name: r.name, live: r.live })),
    nextEvent: upcoming[0] ? { summary: upcoming[0].summary, start: upcoming[0].start } : null,
    now: i.now,
  })
  const needsYou = warm.length + i.mailWaiting.length
  return {
    greeting: greeting(new Date(i.now).getHours()),
    summary: deskSummary(needsYou, running.length),
    hero: {
      ...hero,
      of: hero.kind === 'case' ? warm.length : 1,
      go: mapGo(hero.primary.go, hero.caseId),
      goSecondary: hero.secondary ? mapGo(hero.secondary.go) : undefined,
    },
    next: upcoming.slice(0, 5),
    mail: { accounts: i.mailAccounts, waiting: i.mailWaiting.slice(0, 4) },
    away: buildActivity({
      cases: i.cases,
      runs: i.runs.map((r) => ({ agentName: r.name, sessionName: r.name, status: r.status, prompt: r.prompt, at: r.at })),
      files: i.created,
      nextEvent: upcoming[0] ? { summary: upcoming[0].summary, start: upcoming[0].start } : null,
      now: i.now,
    }),
    files: mergeFiles(i.created, i.recent),
    pages: mergePages(i.openTabs, i.history),
  }
}

/** "Fri 14:00", "Today 09:30", "All day" — the Next card's clock. */
export function eventWhen(e: TodayEvent, now: number): string {
  if (e.allDay) return 'All day'
  const d = new Date(e.start)
  const today = new Date(now)
  const sameDay = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return `Today ${time}`
  const tomorrow = new Date(now + 86_400_000)
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`
}
