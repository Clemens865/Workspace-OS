/**
 * Latest-activity adjunct store — the ONE place the live "what the agent is
 * doing right now" line is kept per run.
 *
 * The AGENT_ACTIVITY IPC event ({ tool, label }) is broadcast for every
 * tool_use in a run's stream, but nothing persisted the *latest* one per run:
 * useAgentSession never subscribed to it, so the cockpit had no honest source
 * for a WORKING agent's live line. This tiny observable captures exactly that —
 * the most recent activity label + its timestamp, keyed by runId — with no new
 * IPC and no extra tokens (it rides the stream we already receive).
 *
 * Same observable shape as reviewStore (subscribe/getSnapshot) so the cockpit
 * reads it via useSyncExternalStore. Live-only: never persisted (a live line is
 * meaningless after a reload); entries are dropped when a run finishes.
 */

export interface RunActivity {
  /** The tool that produced this step (e.g. 'WebFetch', 'Edit', 'Bash'). */
  tool: string
  /** The friendly one-liner ("deep-reading notion.so", "editing report.md"). */
  label: string
  /** When this activity was observed (epoch ms) — drives "live N ago". */
  at: number
}

/** How many recent steps to retain per run for the agent-zoom trail. */
const TRAIL_MAX = 12

export class ActivityStore {
  private latest = new Map<string, RunActivity>()
  /** Bounded recent-step trail per run — the agent-zoom "activity trail". */
  private trails = new Map<string, RunActivity[]>()
  private listeners = new Set<() => void>()
  private version = 0
  private cached: ActivitySnapshot | null = null

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): ActivitySnapshot => {
    if (!this.cached) {
      this.cached = {
        version: this.version,
        byRun: new Map(this.latest),
        trails: new Map(this.trails),
      }
    }
    return this.cached
  }

  /** Records the newest activity for a run (overwrites latest; appends to trail). */
  record(runId: string, activity: { tool: string; label: string }): void {
    const entry: RunActivity = { tool: activity.tool, label: activity.label, at: Date.now() }
    this.latest.set(runId, entry)
    const trail = this.trails.get(runId) ?? []
    // De-dupe consecutive identical labels (a busy tool can repeat the same line).
    if (trail.length === 0 || trail[trail.length - 1].label !== entry.label) {
      trail.push(entry)
      if (trail.length > TRAIL_MAX) trail.shift()
      this.trails.set(runId, trail)
    }
    this.emit()
  }

  /** The latest activity for one run, or null if none seen. */
  get(runId: string): RunActivity | null {
    return this.latest.get(runId) ?? null
  }

  /** The recent activity trail for a run (oldest→newest), or []. */
  trail(runId: string): RunActivity[] {
    return this.trails.get(runId) ?? []
  }

  /** Drops a finished run's live line — it's no longer "happening". Keeps the
   *  trail so the zoom view can still show what it just did. */
  clear(runId: string): void {
    if (this.latest.delete(runId)) this.emit()
  }

  reset(): void {
    if (this.latest.size === 0 && this.trails.size === 0) return
    this.latest.clear()
    this.trails.clear()
    this.emit()
  }

  private emit(): void {
    this.version++
    this.cached = null
    for (const l of this.listeners) l()
  }
}

export interface ActivitySnapshot {
  version: number
  byRun: Map<string, RunActivity>
  trails: Map<string, RunActivity[]>
}

export const activityStore = new ActivityStore()
