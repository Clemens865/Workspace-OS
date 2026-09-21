/**
 * STREAM — the workspace's own history, as a river you can scroll back down.
 *
 * Home's "While you were away" card is the top of this river: the last few
 * things, trimmed to a glance. Stream is the same water without the trim —
 * every case note, every agent run, every file that appeared — in the same
 * plain sentences, grouped by day, with a mark where you last looked.
 *
 * Two rules keep it a stream and not a log:
 *
 * ONE LINE EACH, IN THE HOME VOICE. "Elias finished: tailor the cover letter"
 * rather than a row of columns. The body is one click away at the origin.
 *
 * COST STAYS QUIET. Runs cost money and hiding that would be dishonest, so a
 * day carries its total on the separator — small, and only when it is not zero.
 *
 * Pure: no React, no I/O, so every sentence and every grouping is testable.
 */

export type StreamKind = 'agent' | 'case' | 'file' | 'connector'

export interface StreamItem {
  id: string
  at: number
  kind: StreamKind
  /** The sentence. */
  text: string
  /** Who or what this belongs to — a case title or an agent name. */
  who: string
  /** Origin: a case to open on Home… */
  caseId?: string
  /** …or a file to open in the Canvas (absolute when it came from a run). */
  path?: string
  costUsd: number
  /** Newer than the last time the person looked at the stream. */
  fresh: boolean
}

export type StreamLens = 'day' | 'case' | 'agent' | 'kind'
export const STREAM_LENSES: readonly StreamLens[] = ['day', 'case', 'agent', 'kind']

export interface StreamGroup {
  key: string
  label: string
  /** Summed run cost inside the group; 0 when nothing cost anything. */
  cost: number
  items: StreamItem[]
}

export interface StreamInput {
  cases: {
    id: string
    title: string
    created: string
    notes: { at: string; author: string; text: string }[]
  }[]
  runs: {
    runId: string
    agentName: string | null
    sessionName: string
    status: string
    /** 'routine' runs speak as the routine ("Morning sift ran"), not as an agent. */
    origin?: string
    prompt: string
    createdAt: number
    resolvedAt: number | null
    costUsd: number
    artifacts: { path: string; name: string }[]
  }[]
  files: { path: string; at: number }[]
  /**
   * Connections that need the person (a sign-in that could not be renewed).
   * Only warm ones become lines — a healthy connector has nothing to say.
   */
  connections?: { id: string; name: string; status: string; checkedAt: number }[]
  /** When the person last looked at the stream; null = never. */
  seenAt: number | null
  now?: number
}

const DAY = 86_400_000

function clip(s: string, n: number): string {
  const line = (s || '').split('\n')[0].trim()
  return line.length > n ? line.slice(0, n - 1).trimEnd() + '…' : line
}

function base(p: string): string {
  return p.split('/').pop() ?? p
}

/** Every event the workspace remembers, newest first. */
export function buildStream(input: StreamInput): StreamItem[] {
  const seen = input.seenAt ?? 0
  const out: StreamItem[] = []
  const push = (it: Omit<StreamItem, 'fresh'>): void => {
    if (!Number.isFinite(it.at) || it.at <= 0) return
    out.push({ ...it, fresh: it.at > seen })
  }

  for (const c of input.cases) {
    const created = Date.parse(c.created)
    push({
      id: `case:${c.id}:opened`,
      at: created,
      kind: 'case',
      text: `Case opened: ${c.title}`,
      who: c.title,
      caseId: c.id,
      costUsd: 0,
    })
    c.notes.forEach((n, i) => {
      const at = Date.parse(n.at)
      const text =
        n.author === 'system'
          ? `${c.title} — ${clip(n.text.replace(/^Status → /, 'now '), 80)}`
          : n.author === 'agent'
            ? `Agent, on ${c.title}: ${clip(n.text, 80)}`
            : `You, on ${c.title}: ${clip(n.text, 80)}`
      push({ id: `case:${c.id}:note:${i}`, at, kind: 'case', text, who: c.title, caseId: c.id, costUsd: 0 })
    })
  }

  for (const r of input.runs) {
    const routine = r.origin === 'routine'
    const who = routine ? r.sessionName || 'A routine' : r.agentName || r.sessionName || 'Agent'
    const what = clip(r.prompt, 72)
    const made = r.artifacts[0]
    let text: string
    if (routine) {
      if (r.status === 'running') text = `${who} is running`
      else if (r.status === 'pending') text = `${who} ran and needs you`
      else if (r.status === 'error') text = `${who} failed`
      else text = made ? `${who} ran → ${made.name}` : `${who} ran`
    } else if (r.status === 'running') text = `${who} is working: ${what}`
    else if (r.status === 'pending') text = `${who} is waiting on you: ${what}`
    else if (r.status === 'error') text = `${who} hit an error on: ${what}`
    else if (r.status === 'reverted') text = `${who} did, and you reverted: ${what}`
    else text = made ? `${who} finished: ${what} → ${made.name}` : `${who} finished: ${what}`
    push({
      id: `run:${r.runId}`,
      at: r.resolvedAt ?? r.createdAt,
      kind: 'agent',
      text,
      who,
      path: made?.path,
      costUsd: Number.isFinite(r.costUsd) ? r.costUsd : 0,
    })
  }

  for (const f of input.files) {
    push({ id: `file:${f.path}`, at: f.at, kind: 'file', text: `New in the workspace: ${base(f.path)}`, who: base(f.path), path: f.path, costUsd: 0 })
  }

  for (const c of input.connections ?? []) {
    if (c.status !== 'needs-signin') continue
    push({ id: `connector:${c.id}`, at: c.checkedAt, kind: 'connector', text: `${c.name} needs you to sign in again`, who: c.name, costUsd: 0 })
  }

  out.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
  return out
}

/** "Today" / "Yesterday" / a weekday inside the week / a date beyond it. */
export function dayLabel(at: number, now = Date.now()): string {
  const d = new Date(at)
  const n = new Date(now)
  const startOf = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOf(n) - startOf(d)) / DAY)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' })
}

function dayKey(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const KIND_LABEL: Record<StreamKind, string> = { agent: 'Agents', case: 'Cases', file: 'Files', connector: 'Connections' }

/** The prism: the SAME items re-sliced by the active lens. Order inside a group stays newest-first. */
export function groupStream(items: StreamItem[], lens: StreamLens, now = Date.now()): StreamGroup[] {
  const groups = new Map<string, StreamGroup>()
  for (const it of items) {
    const [key, label] =
      lens === 'day'
        ? [dayKey(it.at), dayLabel(it.at, now)]
        : lens === 'kind'
          ? [it.kind, KIND_LABEL[it.kind]]
          : lens === 'case'
            ? it.caseId
              ? [`case:${it.caseId}`, it.who]
              : ['none', 'Outside any case']
            : it.kind === 'agent'
              ? [`agent:${it.who}`, it.who]
              : ['none', 'Not by an agent']
    let g = groups.get(key)
    if (!g) {
      g = { key, label, cost: 0, items: [] }
      groups.set(key, g)
    }
    g.items.push(it)
    g.cost += it.costUsd
  }
  const out = [...groups.values()]
  // Days are already newest-first by insertion. Other lenses: busiest first,
  // with the catch-all last so a lens never opens on "none".
  if (lens !== 'day') {
    out.sort((a, b) => (a.key === 'none' ? 1 : 0) - (b.key === 'none' ? 1 : 0) || b.items.length - a.items.length || a.label.localeCompare(b.label))
  }
  return out
}

/** The one plain line above the stream. */
export function streamStatus(items: StreamItem[], seenAt: number | null): string {
  if (items.length === 0) return 'Nothing has happened here yet.'
  const fresh = items.filter((i) => i.fresh).length
  if (seenAt === null) return `${items.length} thing${items.length === 1 ? '' : 's'} happened here so far.`
  if (fresh === 0) return 'Quiet — nothing new since you last looked.'
  return `${fresh} new thing${fresh === 1 ? '' : 's'} since you last looked.`
}

/** "$0.42" — the day's quiet cost, or empty when nothing cost anything. */
export function costLabel(usd: number): string {
  if (!(usd > 0)) return ''
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`
}
