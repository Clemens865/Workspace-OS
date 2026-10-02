/**
 * agentPresence: ONE honest state per named agent (PLAN.md §5, P0 item 1).
 *
 * Workspace OS keeps runs per session and spreads them over several stores:
 * the review feed (runs + PTY approvals), the activity trail, background jobs
 * from main, and Codex's structured questions. This joins them by agent name
 * (and runId) and decides what each agent is doing, without inventing states.
 * Pure: inputs in, presences out, so it is unit-tested against fixtures.
 */
import type { ReviewRun, HitlItem } from '../Review/reviewModel'
import type { RunActivity } from '../Review/activityStore'
import type { AgentPresence, PresenceStatus, Provider } from './presenceTypes'
import { STATUS_PRIORITY } from './presenceTypes'

export interface RosterAgent {
  name: string
  description: string
  model?: string
}

/** A background job as main reports it (only the fields presence needs). */
export interface JobLite {
  id: string
  label: string
  prompt: string
  agentName: string | null
  status: 'queued' | 'running' | 'pending' | 'error' | 'interrupted' | 'cancelled'
  enqueuedAt: number
  startedAt: number | null
  finishedAt: number | null
}

/** A pending Codex request (approval or input), keyed to its run. */
export interface CodexAsk {
  runId: string
  requestId: string
  method: string
  text: string
}

export interface PresenceInputs {
  roster: RosterAgent[]
  runs: ReviewRun[]
  hitl: HitlItem[]
  activity: Map<string, RunActivity>
  jobs: JobLite[]
  codex: CodexAsk[]
}

const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase()

/** First line of a prompt, shortened for a screen. */
export function shorten(text: string | null | undefined, max = 72): string | null {
  const line = (text ?? '').split('\n').map((l) => l.trim()).find((l) => l.length > 0)
  if (!line) return null
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

/** "just now", "8 min ago", "3 h ago", "2 d ago". */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

/** Provider: what the latest run says, else what the agent's `wos_model` asks for. */
export function providerOf(agent: RosterAgent, latestRunProvider?: string | null): Provider {
  const p = norm(latestRunProvider)
  if (p === 'codex' || p === 'claude') return p
  return norm(agent.model).startsWith('codex') ? 'codex' : 'claude'
}

/**
 * Agent files are often named "Elias — Application Tailor": the screen shows
 * the name, and the part after the dash is the role.
 */
export function splitName(full: string): { name: string; role: string | null } {
  const m = full.match(/^(.+?)\s+[—–-]\s+(.+)$/)
  return m ? { name: m[1].trim(), role: m[2].trim() } : { name: full.trim(), role: null }
}

function blank(agent: RosterAgent): AgentPresence {
  const { name, role } = splitName(agent.name)
  return {
    id: agent.name,
    name,
    provider: providerOf(agent),
    role: role ?? shorten(agent.description, 60) ?? '',
    about: agent.description.trim(),
    status: 'idle',
    task: null,
    activity: null,
    since: null,
    runId: null,
    caseId: null,
    caseTitle: null,
    question: null,
    outputs: [],
  }
}

/**
 * Derive one presence per roster agent. Precedence, from what needs the user
 * most to what needs them least:
 *   question  (a PTY approval or a Codex request on one of its live runs)
 *   working   (any run or background job running)
 *   the latest settled run: pending → review · error → error ·
 *              interrupted job → interrupted · kept/reverted/cancelled → idle
 */
export function derivePresence(inp: PresenceInputs): AgentPresence[] {
  return inp.roster.map((agent) => {
    const key = norm(agent.name)
    const out = blank(agent)
    const runs = inp.runs.filter((r) => norm(r.agentName) === key).sort((a, b) => b.createdAt - a.createdAt)
    const jobs = inp.jobs.filter((j) => norm(j.agentName) === key).sort((a, b) => (b.startedAt ?? b.enqueuedAt) - (a.startedAt ?? a.enqueuedAt))
    const latest = runs[0]
    out.provider = providerOf(agent, latest?.provider)

    // ── needs your answer ──
    const sessions = new Set(runs.filter((r) => r.status === 'running').map((r) => r.sessionId))
    const hitl = inp.hitl.filter((h) => sessions.has(h.sessionId)).sort((a, b) => b.createdAt - a.createdAt)[0]
    const runIds = new Set(runs.map((r) => r.runId))
    const ask = inp.codex.find((q) => runIds.has(q.runId))
    if (hitl || ask) {
      const run = runs.find((r) => (hitl ? r.sessionId === hitl.sessionId : r.runId === ask!.runId)) ?? latest
      return {
        ...out,
        status: 'question',
        question: hitl?.question ?? ask!.text,
        task: shorten(run?.prompt),
        since: hitl?.createdAt ?? run?.createdAt ?? null,
        runId: run?.runId ?? null,
      }
    }

    // ── working ──
    const running = runs.find((r) => r.status === 'running')
    const job = jobs.find((j) => j.status === 'running' || j.status === 'queued')
    if (running || job) {
      const act = running ? inp.activity.get(running.runId) : undefined
      return {
        ...out,
        status: 'working',
        task: shorten(running?.prompt ?? job?.label ?? job?.prompt),
        activity: act?.label ?? null,
        since: act?.at ?? running?.createdAt ?? job?.startedAt ?? job?.enqueuedAt ?? null,
        runId: running?.runId ?? job?.id ?? null,
      }
    }

    // ── the latest settled run decides ──
    const lastJob = jobs[0]
    const lastJobAt = lastJob ? (lastJob.finishedAt ?? lastJob.startedAt ?? lastJob.enqueuedAt) : -1
    const lastRunAt = latest ? (latest.resolvedAt ?? latest.createdAt) : -1
    if (lastJob && lastJobAt >= lastRunAt) {
      // Background runs mirror into the feed with interrupted/cancelled folded
      // into 'error'; the job itself still knows which it was.
      const status: PresenceStatus = lastJob.status === 'interrupted' ? 'interrupted' : lastJob.status === 'error' ? 'error' : lastJob.status === 'pending' ? 'review' : 'idle'
      if (status !== 'idle') {
        const mirrored = runs.find((r) => r.runId === lastJob.id)
        return {
          ...out,
          status,
          task: shorten(lastJob.label || lastJob.prompt),
          since: lastJobAt,
          runId: lastJob.id,
          outputs: mirrored?.artifacts.map((a) => a.path) ?? [],
        }
      }
      return { ...out, since: lastJobAt }
    }
    if (latest) {
      const status: PresenceStatus = latest.status === 'pending' ? 'review' : latest.status === 'error' ? 'error' : 'idle'
      return {
        ...out,
        status,
        task: status === 'idle' ? null : shorten(latest.prompt),
        since: latest.resolvedAt ?? latest.createdAt,
        runId: status === 'idle' ? null : latest.runId,
        outputs: status === 'review' ? latest.artifacts.map((a) => a.path) : [],
      }
    }
    return out
  })
}

/**
 * Who stands in the front row: everyone the user should see first (questions,
 * errors, reviews, work), then the most recently active idle agents, so the
 * row is full; the rest stand behind. With seven or fewer agents, everyone is
 * in front.
 */
export function arrangeRows(p: AgentPresence[], frontMin = 7): { front: string[]; back: string[] } {
  const sorted = [...p].sort(
    (a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] || (b.since ?? 0) - (a.since ?? 0) || a.name.localeCompare(b.name),
  )
  if (sorted.length <= frontMin + 1) return { front: sorted.map((a) => a.id), back: [] }
  const active = sorted.filter((a) => a.status !== 'idle').length
  const n = Math.max(frontMin, Math.min(active, 12))
  return { front: sorted.slice(0, n).map((a) => a.id), back: sorted.slice(n).map((a) => a.id) }
}

/** The header line: "16 agents • 2 working • 1 question • 1 to review". */
export function teamSummary(p: AgentPresence[]): string {
  const count = (s: PresenceStatus): number => p.filter((a) => a.status === s).length
  const parts = [`${p.length} ${p.length === 1 ? 'agent' : 'agents'}`]
  const w = count('working')
  const q = count('question')
  const r = count('review')
  const e = count('error') + count('interrupted')
  if (w) parts.push(`${w} working`)
  if (q) parts.push(`${q} ${q === 1 ? 'question' : 'questions'}`)
  if (r) parts.push(`${r} to review`)
  if (e) parts.push(`${e} need${e === 1 ? 's' : ''} attention`)
  return parts.join('  •  ')
}

/** A Codex request, as one line for a screen. */
export function codexAskText(method: string, params: { reason?: string; message?: string; command?: string; questions?: { question: string }[] } | undefined): string {
  if (params?.questions?.[0]?.question) return params.questions[0].question
  if (params?.reason) return params.reason
  if (params?.message) return params.message
  if (params?.command) return `Run: ${params.command}`
  if (method.includes('fileChange')) return 'Approve a file change'
  if (method.includes('permissions')) return 'Grant a permission'
  return 'Codex needs your input'
}
