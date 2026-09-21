import type { RoutineStore, Routine } from './store'
import { parseSchedule, nextRun } from './schedule'

/**
 * The app's own clock for routines. Not the agent's — its cron stays denied.
 *
 * Three rules:
 *  - ONE TIMER. Armed for the earliest due routine; re-armed after every tick,
 *    save, or run. Long waits are clamped and re-armed (a JS timer cannot
 *    hold a week).
 *  - CATCH UP ONCE. A routine due while the app was closed fires once at
 *    start, then is recomputed from now — never once per missed period.
 *  - NEVER STACK. A routine whose last run is still queued or running is
 *    skipped and recomputed; two morning sifts at once help nobody.
 *
 * Timers, clock and the enqueue are injected, so this is unit-tested with
 * fake time and never spawns anything.
 */

export interface SchedulerDeps {
  store: RoutineStore
  /** Enqueue a background job; returns its id. */
  enqueue: (routine: Routine) => string
  /** Is a run for this routine still queued or running? */
  isBusy: (routineId: string) => boolean
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /** Called after any change the UI should see. */
  onChange?: () => void
}

const MAX_WAIT_MS = 60 * 60_000

export class Scheduler {
  private handle: unknown = null
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  constructor(private readonly deps: SchedulerDeps) {
    this.now = deps.now ?? Date.now
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  }

  /** Compute what is missing, fire what is due, arm the timer. */
  start(): void {
    this.tick()
  }

  stop(): void {
    if (this.handle !== null) this.clearTimer(this.handle)
    this.handle = null
  }

  /** A routine was saved or toggled — recompute and re-arm. */
  refresh(): void {
    this.tick()
  }

  /** Fire a routine now, whatever its schedule. Returns the job id, or null if busy/unknown. */
  runNow(id: string): string | null {
    const r = this.deps.store.get(id)
    if (!r || this.deps.isBusy(id)) return null
    const jobId = this.fire(r)
    this.arm()
    return jobId
  }

  private fire(r: Routine): string {
    const t = this.now()
    const jobId = this.deps.enqueue(r)
    const s = parseSchedule(r.schedule)
    this.deps.store.mark(r.id, { lastRunAt: t, lastJobId: jobId, nextRunAt: s ? nextRun(s, t, t) : null })
    this.deps.onChange?.()
    return jobId
  }

  private tick(): void {
    const t = this.now()
    for (const r of this.deps.store.list()) {
      const s = parseSchedule(r.schedule)
      if (!s) continue
      if (!r.enabled) continue
      if (r.nextRunAt === null) {
        this.deps.store.mark(r.id, { nextRunAt: nextRun(s, t, r.lastRunAt) })
        continue
      }
      if (r.nextRunAt > t) continue
      if (this.deps.isBusy(r.id)) {
        // Still going — try again next period, do not stack.
        this.deps.store.mark(r.id, { nextRunAt: nextRun(s, t, t) })
        continue
      }
      this.fire(r)
    }
    this.arm()
  }

  private arm(): void {
    this.stop()
    const t = this.now()
    let next = Infinity
    for (const r of this.deps.store.list()) {
      if (r.enabled && r.nextRunAt !== null && r.nextRunAt < next) next = r.nextRunAt
    }
    if (next === Infinity) return
    const wait = Math.min(Math.max(0, next - t), MAX_WAIT_MS)
    this.handle = this.setTimer(() => {
      this.handle = null
      this.tick()
    }, wait)
  }
}
