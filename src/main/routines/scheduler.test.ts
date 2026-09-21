import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { RoutineStore } from './store'
import { Scheduler } from './scheduler'

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
const HOUR = 3_600_000

let dir: string
let file: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-sched-'))
  file = path.join(dir, 'routines.json')
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

/** A fake clock + a single fake timer the test advances by hand. */
function harness(start: number) {
  let now = start
  let timer: { fn: () => void; at: number } | null = null
  const fired: { routine: string; at: number }[] = []
  const busy = new Set<string>()
  const store = new RoutineStore(file, () => now)
  const sched = new Scheduler({
    store,
    enqueue: (r) => {
      fired.push({ routine: r.name, at: now })
      return `bg-${fired.length}`
    },
    isBusy: (id) => busy.has(id),
    now: () => now,
    setTimer: (fn, ms) => {
      timer = { fn, at: now + ms }
      return 1
    },
    clearTimer: () => {
      timer = null
    },
  })
  const advance = (ms: number) => {
    const target = now + ms
    while (timer && timer.at <= target) {
      now = timer.at
      const fn = timer.fn
      timer = null
      fn()
    }
    now = target
  }
  return { store, sched, fired, busy, advance, get now() { return now }, get timer() { return timer } }
}

describe('Scheduler', () => {
  it('computes next runs for enabled routines, fires at the time, and re-arms', () => {
    const h = harness(local(2026, 9, 3, 6, 0))
    const r = h.store.upsert({ name: 'Morning', prompt: 'p', schedule: 'daily@07:00', enabled: true })
    h.sched.start()
    expect(h.store.get(r.id)?.nextRunAt).toBe(local(2026, 9, 3, 7, 0))
    expect(h.fired).toEqual([])
    h.advance(2 * HOUR)
    expect(h.fired).toEqual([{ routine: 'Morning', at: local(2026, 9, 3, 7, 0) }])
    expect(h.store.get(r.id)).toMatchObject({ lastRunAt: local(2026, 9, 3, 7, 0), lastJobId: 'bg-1', nextRunAt: local(2026, 9, 4, 7, 0) })
    expect(h.timer).not.toBeNull()
  })

  it('a routine due while the app was closed fires ONCE at start, then from now', () => {
    const h = harness(local(2026, 9, 1, 6, 0))
    const r = h.store.upsert({ name: 'Daily', prompt: 'p', schedule: 'daily@07:00', enabled: true })
    h.store.mark(r.id, { nextRunAt: local(2026, 9, 1, 7, 0) })
    // Three days pass with the app closed.
    const h2 = harness(local(2026, 9, 4, 12, 0))
    h2.sched.start()
    expect(h2.fired).toHaveLength(1)
    expect(h2.store.get(r.id)?.nextRunAt).toBe(local(2026, 9, 5, 7, 0))
  })

  it('never stacks: a busy routine is skipped and pushed to the next period', () => {
    const h = harness(local(2026, 9, 3, 6, 0))
    const r = h.store.upsert({ name: 'Every', prompt: 'p', schedule: 'every:1h', enabled: true })
    h.sched.start()
    h.advance(HOUR)
    expect(h.fired).toHaveLength(1)
    h.busy.add(r.id)
    h.advance(HOUR)
    expect(h.fired).toHaveLength(1)
    expect(h.store.get(r.id)?.nextRunAt).toBe(h.now + HOUR)
    h.busy.delete(r.id)
    h.advance(HOUR)
    expect(h.fired).toHaveLength(2)
  })

  it('disabled routines never fire; runNow fires regardless of schedule unless busy', () => {
    const h = harness(local(2026, 9, 3, 6, 0))
    const off = h.store.upsert({ name: 'Off', prompt: 'p', schedule: 'daily@07:00', enabled: false })
    h.sched.start()
    h.advance(48 * HOUR)
    expect(h.fired).toEqual([])
    expect(h.sched.runNow(off.id)).toBe('bg-1')
    expect(h.fired).toHaveLength(1)
    h.busy.add(off.id)
    expect(h.sched.runNow(off.id)).toBeNull()
    expect(h.sched.runNow('rt-nope')).toBeNull()
  })

  it('long waits are clamped and re-armed without firing early', () => {
    const h = harness(local(2026, 9, 3, 6, 0))
    h.store.upsert({ name: 'Weekly', prompt: 'p', schedule: 'weekly@mon 09:00', enabled: true })
    h.sched.start()
    expect(h.timer!.at - h.now).toBeLessThanOrEqual(HOUR)
    h.advance(3 * 24 * HOUR)
    expect(h.fired).toEqual([])
    h.advance(2 * 24 * HOUR)
    expect(h.fired).toHaveLength(1)
    expect(new Date(h.fired[0].at).getDay()).toBe(1)
  })
})
