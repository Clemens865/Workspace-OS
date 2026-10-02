/**
 * What a work card says about its case or session, so the row can be read at
 * a glance (the person's words: "what the case is about"). Instead of an
 * agent's "Idle": the case's own status and how far along it is, what it is
 * about, what happened last, what is next, its files and who worked on it.
 * Pure: a case (or a session) in, the card out.
 */

/** Statuses that wait on the person (main/cases.ts WAITING_ON_YOU). */
export const WAITING_ON_YOU: ReadonlySet<string> = new Set(['drafted', 'interview', 'offer', 'waiting'])
const WON = new Set(['accepted', 'done'])

export type CardTone = 'warm' | 'go' | 'done' | 'grey'

export interface WorkCard {
  /** "Interview", "Not applied", "Session". */
  status: string
  tone: CardTone
  /** Position on the case's forward path (1-based), when it is on it. */
  stage: { index: number; count: number } | null
  /** One line of what it is about. */
  about: string | null
  /** The subject's site, when it has one ("dynatrace.com"). */
  host: string | null
  /** What happened last: who, what, when. */
  last: { who: string; text: string; at: number } | null
  /** What is next, when the notes imply something (an offer to act). */
  next: string | null
  files: string[]
  fileCount: number
  noteCount: number
  /** Who worked on it (short names). */
  agents: string[]
  needsYou: boolean
}

export interface CaseLike {
  title?: string
  status: string
  description?: string
  subject?: string
  notes: { at: string; author: string; text: string }[]
  artifacts: string[]
  signals?: { label: string }[]
}

export const statusLabel = (s: string): string => {
  const t = s.replace(/[-_]+/g, ' ').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : 'Open'
}

/** "dynatrace.com" from a URL; null for anything that is not one. */
export function hostOf(subject: string | undefined): string | null {
  if (!subject) return null
  try {
    const u = new URL(subject.trim())
    if (!/^https?:$/.test(u.protocol)) return null
    return u.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** The first sentence (or the opening of it), for one line. */
export function firstSentence(text: string | undefined, max = 110): string | null {
  const t = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  const cut = t.match(/^(.+?[.!?])(\s|$)/)?.[1] ?? t
  return cut.length > max ? cut.slice(0, max - 1).trimEnd() + '…' : cut
}

const shortName = (n: string): string => n.split(' — ')[0]

const plain = (t: string): string => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
/** A line that only says the title again (titles are made from the first ask). */
const echoes = (line: string | null, title: string | undefined): boolean => !!line && !!title && plain(line).startsWith(plain(title))
/** The app's own "Started with … on …" line says nothing about the work. */
const STUB = /^Started with .+ on .+\.$/

export function caseCard(c: CaseLike, flow: string[], terminal: ReadonlySet<string>, agents: string[]): WorkCard {
  const forward = flow.filter((s) => !terminal.has(s))
  const i = forward.indexOf(c.status)
  const needsYou = WAITING_ON_YOU.has(c.status) || (c.signals?.length ?? 0) > 0
  const tone: CardTone = WON.has(c.status) ? 'done' : terminal.has(c.status) ? 'grey' : needsYou ? 'warm' : 'go'
  // The last thing that happened: the latest note that is not a status line the app wrote.
  // The status line already says what those would; none left means nothing was noted.
  const real = c.notes.filter((n) => n.author !== 'system')
  const n = real[real.length - 1]
  const last = n
    ? {
        who: n.author === 'you' ? 'You' : (/^([^:]{1,30}):\s/.exec(n.text)?.[1] ?? 'Agent'),
        text: n.author !== 'you' && /^[^:]{1,30}:\s/.test(n.text) ? n.text.replace(/^[^:]{1,30}:\s/, '') : n.text,
        at: Date.parse(n.at) || 0,
      }
    : null
  return {
    status: statusLabel(c.status),
    tone,
    stage: i >= 0 && forward.length > 1 ? { index: i + 1, count: forward.length } : null,
    about: (() => {
      const a = firstSentence(c.description)
      return a && !STUB.test(a) && !echoes(a, c.title) ? a : null
    })(),
    host: hostOf(c.subject),
    last,
    next: c.signals?.[0]?.label ?? null,
    files: c.artifacts.slice(-3).reverse(),
    fileCount: c.artifacts.length,
    noteCount: c.notes.length,
    agents: [...new Set(agents.map(shortName))],
    needsYou,
  }
}

export interface SessionLike {
  title?: string
  agentName: string | null
  files: string[]
  messages: { role: string; text: string; at: number }[]
  turns: number
}

/** A session that is not a case: who it is with, its last ask and answer, its files. */
export function sessionCard(s: SessionLike, suggestsCase: boolean): WorkCard {
  const lastUser = [...s.messages].reverse().find((m) => m.role === 'user')
  const lastAgent = [...s.messages].reverse().find((m) => m.role === 'agent' && m.text.trim())
  const agentLine = lastAgent ? firstSentence(lastAgent.text.split(/\n\s*\n/).filter(Boolean).pop(), 90) : null
  const who = s.agentName ? shortName(s.agentName) : 'Assistant'
  // The title is made from the first ask; saying the ask again tells nothing, so say what came of it.
  const ask = lastUser ? firstSentence(lastUser.text, 90) : null
  return {
    status: 'Session',
    tone: suggestsCase ? 'warm' : 'go',
    stage: null,
    about: echoes(ask, s.title) ? (agentLine ? `${who}: ${agentLine}` : null) : ask,
    host: null,
    last: agentLine && lastAgent ? { who, text: agentLine, at: lastAgent.at } : null,
    next: suggestsCase ? 'Keep it as a case' : null,
    files: s.files.slice(-3).reverse(),
    fileCount: s.files.length,
    noteCount: 0,
    agents: s.agentName ? [shortName(s.agentName)] : [],
    needsYou: suggestsCase,
  }
}
