/**
 * The Inbox: everything waiting on the user, one item each (PLAN.md §5, P2
 * item 7). Unlike the screens (one state per agent), an agent can have several
 * items here: two finished runs to review and a question, say.
 *
 *   question    a PTY approval on a live run, or a Codex request
 *   error       a run that failed (recent, latest per agent), until dismissed
 *   interrupted a background job cut off (quit, crash), until restarted or dismissed
 *   paused      a run the person paused, until resumed or stopped
 *   review      a finished run awaiting Keep / Revert / Revise
 *   mail        a mail the triage marked as needing a reply (ADOPTION.md B2),
 *               until it is sent or dismissed
 */
import type { ReviewRun, HitlItem } from '../Review/reviewModel'
import type { CodexAsk, JobLite } from './agentPresence'
import { shorten, splitName } from './agentPresence'

export type InboxKind = 'question' | 'mail' | 'error' | 'interrupted' | 'paused' | 'review'

/** A mail-review card, reduced to what the Inbox shows. */
export interface MailLite {
  id: string
  subject: string
  fromLabel: string
  reason: string
  status: string
  createdAt: number
}

export interface InboxItem {
  key: string
  kind: InboxKind
  /** Roster name (null for an unnamed dock session). */
  agentName: string | null
  /** Short display name ("Elias" for "Elias — Application Tailor"). */
  who: string
  title: string
  text: string | null
  at: number
  runId: string | null
  sessionId: string | null
  /** Codex request id, for answering. */
  requestId: string | null
  files: string[]
  /** Can be rolled back (the run has a checkpoint). */
  revertible: boolean
  prompt: string | null
  /** Mail-review card id (mail items only). */
  mailId?: string
}

/** Errors older than this stop asking for attention (they stay in the feed). */
export const ERROR_WINDOW_MS = 24 * 3_600_000

const ORDER: Record<InboxKind, number> = { question: 0, mail: 1, error: 2, interrupted: 3, paused: 4, review: 5 }

export function deriveInbox(
  inp: { runs: ReviewRun[]; hitl: HitlItem[]; jobs: JobLite[]; codex: CodexAsk[]; dismissed: Set<string>; mail?: MailLite[] },
  now = Date.now(),
): InboxItem[] {
  const items: InboxItem[] = []
  const who = (n: string | null, fallback: string): string => (n ? splitName(n).name : fallback)
  const runById = new Map(inp.runs.map((r) => [r.runId, r]))

  for (const h of inp.hitl) {
    const run = inp.runs.find((r) => r.sessionId === h.sessionId && r.status === 'running')
    items.push({
      key: `hitl:${h.sessionId}`,
      kind: 'question',
      agentName: run?.agentName ?? null,
      who: who(run?.agentName ?? null, h.sessionName || 'Agent'),
      title: h.question,
      text: run ? `Asked during “${shorten(run.prompt, 60)}”` : null,
      at: h.createdAt,
      runId: run?.runId ?? null,
      sessionId: h.sessionId,
      requestId: null,
      files: [],
      revertible: false,
      prompt: run?.prompt ?? null,
    })
  }

  for (const q of inp.codex) {
    const run = runById.get(q.runId)
    items.push({
      key: `codex:${q.runId}:${q.requestId}`,
      kind: 'question',
      agentName: run?.agentName ?? null,
      who: who(run?.agentName ?? null, 'Codex'),
      title: q.text,
      text: run ? `Asked during “${shorten(run.prompt, 60)}”` : null,
      at: run?.createdAt ?? now,
      runId: q.runId,
      sessionId: run?.sessionId ?? null,
      requestId: q.requestId,
      files: [],
      revertible: false,
      prompt: run?.prompt ?? null,
    })
  }

  for (const r of inp.runs) {
    if (r.status === 'paused') {
      items.push({
        key: `paused:${r.runId}`,
        kind: 'paused',
        agentName: r.agentName,
        who: who(r.agentName, r.sessionName || 'Agent'),
        title: 'Paused',
        text: shorten(r.prompt, 120),
        at: r.resolvedAt ?? r.createdAt,
        runId: r.runId,
        sessionId: r.sessionId,
        requestId: null,
        files: r.artifacts.map((a) => a.path),
        revertible: !!r.checkpointId,
        prompt: r.prompt,
      })
    }
    if (r.status === 'pending') {
      items.push({
        key: `review:${r.runId}`,
        kind: 'review',
        agentName: r.agentName,
        who: who(r.agentName, r.sessionName || 'Agent'),
        title: r.artifacts[0]?.name ?? shorten(r.prompt) ?? 'Result',
        text: shorten(r.prompt, 120),
        at: r.resolvedAt ?? r.createdAt,
        runId: r.runId,
        sessionId: r.sessionId,
        requestId: null,
        files: r.artifacts.map((a) => a.path),
        revertible: !!r.checkpointId,
        prompt: r.prompt,
      })
    }
  }

  // Failures: the latest per agent, recent, not dismissed. A background job's
  // own status beats the feed mirror (which folds "interrupted" into "error").
  const jobs = new Map(inp.jobs.map((j) => [j.id, j]))
  const latestFail = new Map<string, ReviewRun>()
  for (const r of inp.runs) {
    if (r.status !== 'error') continue
    const k = r.agentName ?? r.sessionId
    const prev = latestFail.get(k)
    if (!prev || r.createdAt > prev.createdAt) latestFail.set(k, r)
  }
  for (const r of latestFail.values()) {
    const at = r.resolvedAt ?? r.createdAt
    if (now - at > ERROR_WINDOW_MS) continue
    const job = jobs.get(r.runId)
    if (job?.status === 'cancelled') continue
    const kind: InboxKind = job?.status === 'interrupted' ? 'interrupted' : 'error'
    const key = `${kind}:${r.runId}`
    if (inp.dismissed.has(key)) continue
    // A later run of the same agent supersedes the failure.
    const later = inp.runs.some((o) => (o.agentName ?? o.sessionId) === (r.agentName ?? r.sessionId) && o.createdAt > r.createdAt)
    if (later) continue
    items.push({
      key,
      kind,
      agentName: r.agentName,
      who: who(r.agentName, r.sessionName || 'Agent'),
      title: kind === 'interrupted' ? 'Stopped before it finished' : 'The run failed',
      text: shorten(r.prompt, 120),
      at,
      runId: r.runId,
      sessionId: r.sessionId,
      requestId: null,
      files: r.artifacts.map((a) => a.path),
      revertible: !!r.checkpointId,
      prompt: r.prompt,
    })
  }

  // Mail that needs a reply is the same kind of obligation as a run awaiting
  // approval, so it joins the same list (as the Cockpit had it).
  for (const m of inp.mail ?? []) {
    if (m.status === 'sent' || m.status === 'dismissed') continue
    items.push({
      key: `mail:${m.id}`,
      kind: 'mail',
      agentName: null,
      who: m.fromLabel || 'Mail',
      title: m.subject || '(no subject)',
      text: m.reason || null,
      at: m.createdAt,
      runId: null,
      sessionId: null,
      requestId: null,
      files: [],
      revertible: false,
      prompt: null,
      mailId: m.id,
    })
  }

  return items.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || b.at - a.at)
}

/**
 * The prompt for a revision: the agent gets the original task, the files it
 * produced and what should change, as a new run whose result comes back here.
 */
export function revisionPrompt(original: string | null, files: string[], feedback: string): string {
  const parts = ['Revise the result of an earlier task.']
  if (original) parts.push(`Original task:\n${original.trim()}`)
  if (files.length) parts.push(`Files you produced:\n${files.map((f) => `- ${f}`).join('\n')}`)
  parts.push(`What should change:\n${feedback.trim()}`)
  parts.push('Edit those files in place and summarise what you changed.')
  return parts.join('\n\n')
}

export const KIND_LABEL: Record<InboxKind, string> = {
  question: 'Needs your answer',
  mail: 'Mail to answer',
  error: 'Needs attention',
  interrupted: 'Interrupted',
  paused: 'Paused',
  review: 'Ready for review',
}
