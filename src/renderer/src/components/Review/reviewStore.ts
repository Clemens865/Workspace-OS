/**
 * Shared store for the Agent Review surface — the single source of truth for
 * reviewable agent runs, the active feed filter, and live HITL requests.
 *
 * It is a plain observable singleton (same shape as AgentSessionStore): the
 * agent session hook records runs into it as they start/finish, the PTY session
 * publishes live permission requests into it, and the Review feed + rail read
 * from it via useSyncExternalStore. Runs persist to localStorage (bounded) so
 * the feed survives a reload; HITL items and their responders are live-only.
 *
 * No new IPC: everything here is fed by existing agent events and acts through
 * the existing checkpoint diff/rollback IPC.
 */

import type { ReviewRun, HitlItem, FeedFilter, RunStatus } from './reviewModel'
import { selectBatchApprovals, isHitlBatchable } from './reviewModel'
import { loadSettings } from '../../hooks/useSettings'
import { readScoped, scopedKey, EVERYWHERE } from '../../lib/workspaceScope'
import type { HitlDecision } from '../AgentTerminal/hitlGate'

type StringStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const STORE_KEY = 'workspace-os:review-runs:v1'
const RUNS_MAX = 40
const SAVE_DELAY_MS = 300
// Bounds on the live HITL map. Live permission requests are normally cleared as
// they're answered/dismissed, but an orphaned entry (a session that vanished
// mid-prompt without a clear) must not accrete forever. We cap the map and
// evict entries older than the TTL whenever a new one is published.
const HITL_MAX = 20
const HITL_TTL_MS = 10 * 60 * 1000

function memoryStorage(): StringStorage {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

/** Fields a completed/updated run contributes — all optional (patch semantics). */
export type RunPatch = Partial<Omit<ReviewRun, 'runId'>>

/** What a caller provides to open a run in the feed (the rest defaults). */
export interface RunSeed {
  runId: string
  sessionId: string
  sessionName: string
  prompt: string
  mode: 'full' | 'safe'
  agentName: string | null
  /** Fleet lane key. Optional for backward-compat; defaults to the sessionId. */
  agentId?: string
  /** Who started it; absent = the dock. */
  origin?: 'dock' | 'background' | 'routine'
}

export class ReviewStore {
  private runs: ReviewRun[] = []
  private filter: FeedFilter = 'all'
  private hitl = new Map<string, HitlItem>()
  private responders = new Map<string, (d: HitlDecision) => void>()
  private listeners = new Set<() => void>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  /**
   * Opt-in (default OFF) auto-approval of reversible-tier requests. When ON, a
   * read-only live HITL request is resolved automatically AND logged as a
   * resolved card — never silent. Gated/irreversible requests are unaffected.
   * Injected so tests can flip it without touching the settings module.
   */
  private autoApproveReversible: () => boolean = () => false
  /** Bumped on every mutation so useSyncExternalStore's snapshot is stable-by-ref. */
  private version = 0
  private cachedSnapshot: ReviewSnapshot | null = null
  /** Which workspace the runs belong to (see lib/workspaceScope). */
  private scope = EVERYWHERE

  constructor(private storage: StringStorage) {
    this.load()
  }

  /**
   * Point the store at another workspace's runs. Live HITL requests belong to
   * the PTY sessions that raised them and are kept; runs are swapped.
   */
  switchScope(scope: string): void {
    if (scope === this.scope) return
    this.flushNow()
    this.scope = scope
    this.runs = []
    this.load()
    this.emit()
  }

  currentScope(): string {
    return this.scope
  }

  private flushNow(): void {
    if (!this.saveTimer) return
    clearTimeout(this.saveTimer)
    this.saveTimer = null
    try {
      this.storage.setItem(scopedKey(STORE_KEY, this.scope), JSON.stringify(this.runs))
    } catch {
      /* best-effort */
    }
  }

  private load(): void {
    try {
      const raw = readScoped(this.storage, STORE_KEY, this.scope)
      if (!raw) return
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        this.runs = parsed
          .filter((r): r is ReviewRun => typeof (r as ReviewRun)?.runId === 'string')
          // Backward-compat: legacy runs predate lanes — fold each onto its session.
          .map((r) => (r.agentId ? r : { ...r, agentId: r.sessionId }))
      }
    } catch {
      this.runs = []
    }
  }

  private emit(): void {
    this.version++
    this.cachedSnapshot = null
    for (const l of this.listeners) l()
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      try {
        this.storage.setItem(scopedKey(STORE_KEY, this.scope), JSON.stringify(this.runs))
      } catch {
        // best-effort
      }
    }, SAVE_DELAY_MS)
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Immutable snapshot for React; identity changes only when something mutates. */
  getSnapshot = (): ReviewSnapshot => {
    if (!this.cachedSnapshot) {
      this.cachedSnapshot = {
        version: this.version,
        runs: this.runs,
        filter: this.filter,
        hitl: [...this.hitl.values()].sort((a, b) => b.createdAt - a.createdAt),
      }
    }
    return this.cachedSnapshot
  }

  // ── Runs ────────────────────────────────────────────────────────────────
  /** Opens (or re-opens) a run in the feed as 'running'. */
  openRun(seed: RunSeed): void {
    const existing = this.runs.find((r) => r.runId === seed.runId)
    if (existing) return
    const run: ReviewRun = {
      ...seed,
      // Lane key defaults to the session (see ReviewRun.agentId rationale).
      agentId: seed.agentId || seed.sessionId,
      status: 'running',
      checkpointId: null,
      code: null,
      costUsd: 0,
      turns: 0,
      artifacts: [],
      createdAt: Date.now(),
      resolvedAt: null,
    }
    this.runs = [run, ...this.runs].slice(0, RUNS_MAX)
    this.emit()
  }

  /** Patches an existing run (no-op if unknown). */
  patchRun(runId: string, patch: RunPatch): void {
    let changed = false
    this.runs = this.runs.map((r) => {
      if (r.runId !== runId) return r
      changed = true
      return { ...r, ...patch }
    })
    if (changed) this.emit()
  }

  /** Marks a run resolved (kept or reverted) — the equal-weight terminal states. */
  resolveRun(runId: string, status: Extract<RunStatus, 'kept' | 'reverted'>): void {
    this.patchRun(runId, { status, resolvedAt: Date.now() })
  }

  setFilter(filter: FeedFilter): void {
    if (this.filter === filter) return
    this.filter = filter
    this.emit()
  }

  /** Empties the store (runs, filter, live requests). For tests/e2e isolation. */
  reset(): void {
    this.runs = []
    this.filter = 'all'
    this.hitl.clear()
    this.responders.clear()
    this.emit()
  }

  clearResolved(): void {
    const before = this.runs.length
    this.runs = this.runs.filter((r) => r.status === 'running' || r.status === 'pending' || r.status === 'error')
    if (this.runs.length !== before) this.emit()
  }

  /**
   * Wires the opt-in auto-approve predicate (typically the persisted setting).
   * Default is OFF — this is called once at app start to bind the live setting.
   */
  setAutoApprovePredicate(pred: () => boolean): void {
    this.autoApproveReversible = pred
  }

  // ── Live HITL (outbound permission requests) ─────────────────────────────
  /** Publishes/updates a live permission request for a PTY session. Evicts
   *  stale/overflowing entries so an orphaned request can't leak indefinitely.
   *  If auto-approve is ON and the request is reversible (read-only), it is
   *  resolved immediately and AUDITED as a resolved card — never silent. Gated
   *  requests always fall through to the human. */
  setHitl(item: HitlItem, respond: (d: HitlDecision) => void): void {
    if (this.autoApproveReversible() && isHitlBatchable(item)) {
      this.logAutoApproved(item)
      respond('allow-once')
      // Do not park it as a live request — it's already handled + audited.
      this.clearHitl(item.sessionId)
      return
    }
    this.hitl.set(item.sessionId, item)
    this.responders.set(item.sessionId, respond)
    this.pruneHitl(item.sessionId)
    this.emit()
  }

  /**
   * Records an auto-approved reversible request as a resolved feed card so the
   * decision is always auditable. The card is 'kept' (an approval), tagged with
   * the lane so the fleet view attributes it, and carries the request text.
   */
  private logAutoApproved(item: HitlItem): void {
    const now = Date.now()
    const card: ReviewRun = {
      runId: `auto-${item.sessionId}-${now}`,
      sessionId: item.sessionId,
      sessionName: item.sessionName,
      agentId: item.agentId || item.sessionId,
      agentName: item.sessionName,
      prompt: `Auto-approved (reversible): ${item.question}`,
      mode: 'safe',
      // A reversible request logs WITHOUT a checkpoint but is still an auto-kept
      // record; it renders resolved, so the missing checkpoint never gates a UI.
      status: 'kept',
      checkpointId: null,
      code: 0,
      costUsd: 0,
      turns: 0,
      artifacts: [],
      createdAt: now,
      resolvedAt: now,
    }
    this.runs = [card, ...this.runs].slice(0, RUNS_MAX)
    this.emit()
  }

  /** Drops HITL entries older than the TTL, then trims the oldest past the cap.
   *  `keep` (the just-set session) is never evicted. */
  private pruneHitl(keep: string): void {
    const now = Date.now()
    for (const [sid, it] of this.hitl) {
      if (sid !== keep && now - it.createdAt > HITL_TTL_MS) {
        this.hitl.delete(sid)
        this.responders.delete(sid)
      }
    }
    if (this.hitl.size > HITL_MAX) {
      // Oldest-first (Map preserves insertion order); evict until at the cap.
      const ordered = [...this.hitl.values()].sort((a, b) => a.createdAt - b.createdAt)
      for (const it of ordered) {
        if (this.hitl.size <= HITL_MAX) break
        if (it.sessionId === keep) continue
        this.hitl.delete(it.sessionId)
        this.responders.delete(it.sessionId)
      }
    }
  }

  clearHitl(sessionId: string): void {
    if (!this.hitl.has(sessionId)) return
    this.hitl.delete(sessionId)
    this.responders.delete(sessionId)
    this.emit()
  }

  /** Routes the feed's Approve/Deny back to the PTY session that owns the prompt. */
  respondHitl(sessionId: string, decision: HitlDecision): void {
    this.responders.get(sessionId)?.(decision)
    this.clearHitl(sessionId)
  }

  // ── Batched approval ──────────────────────────────────────────────────────
  /**
   * Approves every REVERSIBLE-tier pending item — reversible edit runs (Keep)
   * and read-only live HITL requests (Allow once) — optionally scoped to one
   * lane. Gated/irreversible items are NEVER touched here: they are excluded by
   * `selectBatchApprovals` and the count is returned so the UI can report what
   * still needs the human. Returns how many items were approved.
   */
  approveReversible(agentId?: string): { runs: number; hitl: number; gatedExcluded: number } {
    const sel = selectBatchApprovals(this.runs, [...this.hitl.values()], agentId)
    for (const run of sel.runs) {
      // Reversible = 'kept' (a batch Keep). Never a revert, never a gated action.
      this.patchRun(run.runId, { status: 'kept', resolvedAt: Date.now() })
    }
    for (const item of sel.hitl) {
      this.respondHitl(item.sessionId, 'allow-once')
    }
    return { runs: sel.runs.length, hitl: sel.hitl.length, gatedExcluded: sel.gatedExcluded }
  }
}

export interface ReviewSnapshot {
  version: number
  runs: ReviewRun[]
  filter: FeedFilter
  hitl: HitlItem[]
}

export const reviewStore = new ReviewStore(
  typeof localStorage === 'undefined' ? memoryStorage() : localStorage
)

// Bind the opt-in auto-approve setting to the store. Reads the live persisted
// value on every request (default OFF). Only wired in a browser context so a
// freshly-constructed store (as in unit tests) stays deterministically OFF.
if (typeof window !== 'undefined') {
  reviewStore.setAutoApprovePredicate(() => loadSettings().autoApproveReversible)
}

// Expose the singleton for e2e/dev harnesses to seed a run without a real agent.
if (typeof window !== 'undefined') {
  ;(window as unknown as { __reviewStore?: ReviewStore }).__reviewStore = reviewStore
}
