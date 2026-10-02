/**
 * Sessions: a conversation with Claude or Codex that gets work done (docs/
 * landscape/SESSIONS.md). Every session can become a case, the workspace's
 * memory; the app decides when by the person's setting (always, suggested,
 * manually), and writes the case itself: the asks and the agent's own outcome
 * lines as notes, the files it produced attached. Pure rules live here.
 */

export type CaseMode = 'always' | 'suggest' | 'manual'

export interface SessionMsg {
  role: 'user' | 'agent' | 'system'
  text: string
  at: number
}

export interface Session {
  /** Stable id; also the provider conversation key (`session-<id>`), so it resumes. */
  id: string
  title: string
  /** The roster agent it runs as, or null for the default assistant. */
  agentName: string | null
  /** The case it lives in, once it is one. */
  caseId: string | null
  createdAt: number
  lastAt: number
  turns: number
  /** Files it produced, absolute paths, newest last. */
  files: string[]
  /** The latest run (for live previews and review). */
  lastRunId: string | null
  /** The conversation, trimmed (local only, never written to the case). */
  messages: SessionMsg[]
  /** The person said "not now" to keeping it as a case. */
  suggestDismissed?: boolean
}

/** A title from the first ask: its opening words, no trailing punctuation, at most 6 words / 60 chars. */
export function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.replace(/^\[[\s\S]*?\]\s*/, '').split('\n').find((l) => l.trim()) ?? ''
  const words = firstLine.trim().replace(/\s+/g, ' ').split(' ').slice(0, 6).join(' ')
  const clipped = words.length > 60 ? words.slice(0, 59).trimEnd() + '…' : words
  const t = clipped.replace(/[.,;:!?…-]+$/, '').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : 'New session'
}

/** Under "suggested", a session earns its own case once it produced a file or ran a few turns. */
export const SUGGEST_AFTER_TURNS = 3

export function shouldSuggestCase(s: Pick<Session, 'caseId' | 'files' | 'turns' | 'suggestDismissed'>, mode: CaseMode): boolean {
  if (s.caseId || mode !== 'suggest' || s.suggestDismissed) return false
  return s.files.length > 0 || s.turns >= SUGGEST_AFTER_TURNS
}

/** Whether a new session's first ask opens a case right away. */
export const caseOnFirstAsk = (mode: CaseMode): boolean => mode === 'always'

/**
 * The agent's own outcome line for a turn: the last paragraph of its answer,
 * one line, clipped. Never invented: empty output gives null.
 */
export function outcomeLine(output: string, max = 220): string | null {
  const paras = output
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p && !/^\[(error|agent exited)/i.test(p))
  const last = paras[paras.length - 1]
  if (!last) return null
  const plain = last.replace(/[*_`#>]+/g, '').trim()
  return plain.length > max ? plain.slice(0, max - 1).trimEnd() + '…' : plain
}

/** The notes a turn leaves on its case: the ask, and the agent's outcome (labelled as the agent's). */
export function turnNotes(ask: string, output: string): { author: 'you' | 'agent'; text: string }[] {
  const out: { author: 'you' | 'agent'; text: string }[] = []
  const a = ask.trim().replace(/\s+/g, ' ')
  if (a) out.push({ author: 'you', text: a.length > 400 ? a.slice(0, 399) + '…' : a })
  const o = outcomeLine(output)
  if (o) out.push({ author: 'agent', text: o })
  return out
}

/** Keeps a conversation small enough to store locally: the last `max` messages, each clipped. */
export function trimMessages(m: SessionMsg[], max = 60, clip = 4000): SessionMsg[] {
  return m.slice(-max).map((x) => (x.text.length > clip ? { ...x, text: x.text.slice(0, clip) + '…' } : x))
}

export interface WorkCaseLite {
  id: string
  title: string
  updated: string
}

/** One item of the work row: a case (with its sessions) or a session that is not a case (yet). */
export type WorkItem =
  | { kind: 'case'; id: string; caseId: string; title: string; lastAt: number; sessions: Session[] }
  | { kind: 'session'; id: string; title: string; lastAt: number; session: Session }

/**
 * Everything in progress, newest first: each case once (its sessions folded in,
 * its time the latest of the case and its sessions), and each session that is
 * not in a case. Cases without any session in this workspace still appear.
 */
export function workItems(sessions: Session[], cases: WorkCaseLite[]): WorkItem[] {
  const byCase = new Map<string, Session[]>()
  const loose: WorkItem[] = []
  for (const s of sessions) {
    if (s.caseId) byCase.set(s.caseId, [...(byCase.get(s.caseId) ?? []), s])
    else loose.push({ kind: 'session', id: `session:${s.id}`, title: s.title, lastAt: s.lastAt, session: s })
  }
  const known = new Set(cases.map((c) => c.id))
  const caseItems: WorkItem[] = cases.map((c) => {
    const ss = (byCase.get(c.id) ?? []).sort((a, b) => b.lastAt - a.lastAt)
    const t = Math.max(Date.parse(c.updated) || 0, ...ss.map((s) => s.lastAt))
    return { kind: 'case', id: `case:${c.id}`, caseId: c.id, title: c.title, lastAt: t, sessions: ss }
  })
  // A session bound to a case that is gone (deleted elsewhere) shows loose rather than vanish.
  for (const [cid, ss] of byCase) {
    if (known.has(cid)) continue
    for (const s of ss) loose.push({ kind: 'session', id: `session:${s.id}`, title: s.title, lastAt: s.lastAt, session: s })
  }
  return [...caseItems, ...loose].sort((a, b) => b.lastAt - a.lastAt)
}

/** How many work items the arc shows; the rest live in the list. */
export const ARC_WORK = 10
