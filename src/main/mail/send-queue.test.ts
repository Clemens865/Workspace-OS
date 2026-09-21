import { describe, it, expect, vi } from 'vitest'
import { SendQueue } from './send-queue'

/**
 * Sending is the one irreversible act here, so the tests are weighted toward
 * the ways this could deliver something the user cancelled — or claim to have
 * cancelled something already delivered.
 */

/** A controllable scheduler: nothing fires until the test says so. */
function manualClock() {
  const jobs = new Map<number, () => void>()
  let next = 0
  let now = 1_000
  return {
    now: () => now,
    schedule: (fn: () => void) => { const h = ++next; jobs.set(h, fn); return h },
    cancelScheduled: (h: unknown) => { jobs.delete(h as number) },
    /** Fire every pending job, as the real timer eventually would. */
    async fire() {
      const pending = [...jobs.values()]
      jobs.clear()
      for (const j of pending) await j()
    },
    pending: () => jobs.size,
    advance: (ms: number) => { now += ms },
  }
}

const makeQueue = (deliver: (p: string) => Promise<{ ok: boolean; error?: string }>) => {
  const clock = manualClock()
  const q = new SendQueue(deliver, {
    holdMs: 8000,
    now: clock.now,
    schedule: clock.schedule,
    cancelScheduled: clock.cancelScheduled,
  })
  return { q, clock }
}

describe('SendQueue — the hold', () => {
  it('does NOT deliver while holding', async () => {
    const deliver = vi.fn(async () => ({ ok: true }))
    const { q } = makeQueue(deliver)
    q.enqueue('hello')
    expect(deliver).not.toHaveBeenCalled()
  })

  it('delivers once the hold expires', async () => {
    const deliver = vi.fn(async () => ({ ok: true }))
    const { q, clock } = makeQueue(deliver)
    const item = q.enqueue('hello')
    await clock.fire()
    expect(deliver).toHaveBeenCalledOnce()
    expect(q.get(item.id)?.state).toBe('sent')
  })

  it('reports what is still holding, for the Undo affordance', () => {
    const { q } = makeQueue(async () => ({ ok: true }))
    q.enqueue('a')
    q.enqueue('b')
    expect(q.holding()).toHaveLength(2)
  })
})

describe('SendQueue — cancelling', () => {
  it('a cancelled message NEVER leaves the machine', async () => {
    // The whole point: undo is real because nothing was sent yet.
    const deliver = vi.fn(async () => ({ ok: true }))
    const { q, clock } = makeQueue(deliver)
    const item = q.enqueue('regret')
    expect(q.cancel(item.id)).toBe(true)
    await clock.fire()
    expect(deliver).not.toHaveBeenCalled()
    expect(q.get(item.id)?.state).toBe('cancelled')
  })

  it('clears the timer, so a cancelled send cannot fire later', async () => {
    const { q, clock } = makeQueue(async () => ({ ok: true }))
    const item = q.enqueue('x')
    q.cancel(item.id)
    expect(clock.pending()).toBe(0)
  })

  it('refuses to cancel once delivery has begun', async () => {
    // Claiming to cancel a delivered message is the lie this mechanism exists
    // to avoid — the user finds out only from the reply.
    const { q, clock } = makeQueue(async () => ({ ok: true }))
    const item = q.enqueue('x')
    await clock.fire()
    expect(q.cancel(item.id)).toBe(false)
    expect(q.get(item.id)?.state).toBe('sent')
  })

  it('refuses to cancel an unknown id', () => {
    const { q } = makeQueue(async () => ({ ok: true }))
    expect(q.cancel('nope')).toBe(false)
  })

  it('cancelling twice does not resurrect anything', async () => {
    const { q } = makeQueue(async () => ({ ok: true }))
    const item = q.enqueue('x')
    expect(q.cancel(item.id)).toBe(true)
    expect(q.cancel(item.id)).toBe(false)
  })
})

describe('SendQueue — send now', () => {
  it('skips the remaining hold', async () => {
    const deliver = vi.fn(async () => ({ ok: true }))
    const { q } = makeQueue(deliver)
    const item = q.enqueue('urgent')
    await q.sendNow(item.id)
    expect(deliver).toHaveBeenCalledOnce()
    expect(q.get(item.id)?.state).toBe('sent')
  })

  it('cannot double-send when the timer also fires', async () => {
    // The dangerous race: "Send now" plus the expiring hold, delivering twice.
    const deliver = vi.fn(async () => ({ ok: true }))
    const { q, clock } = makeQueue(deliver)
    const item = q.enqueue('x')
    await q.sendNow(item.id)
    await clock.fire()
    expect(deliver).toHaveBeenCalledOnce()
  })

  it('is a no-op for something already cancelled', async () => {
    const deliver = vi.fn(async () => ({ ok: true }))
    const { q } = makeQueue(deliver)
    const item = q.enqueue('x')
    q.cancel(item.id)
    expect(await q.sendNow(item.id)).toBeNull()
    expect(deliver).not.toHaveBeenCalled()
  })
})

describe('SendQueue — failure', () => {
  it('records a delivery failure rather than reporting success', async () => {
    const { q, clock } = makeQueue(async () => ({ ok: false, error: 'smtp refused' }))
    const item = q.enqueue('x')
    await clock.fire()
    expect(q.get(item.id)?.state).toBe('failed')
    expect(q.get(item.id)?.error).toBe('smtp refused')
  })

  it('a failed send is not offered as undoable', async () => {
    const { q, clock } = makeQueue(async () => ({ ok: false }))
    q.enqueue('x')
    await clock.fire()
    expect(q.holding()).toHaveLength(0)
  })
})

describe('SendQueue — housekeeping', () => {
  it('prunes finished entries but keeps failures for inspection', async () => {
    const { q, clock } = makeQueue(async (p: string) => ({ ok: p !== 'bad' }))
    const good = q.enqueue('good')
    const bad = q.enqueue('bad')
    const cancelled = q.enqueue('cancelled')
    q.cancel(cancelled.id)
    await clock.fire()

    q.prune()
    expect(q.get(good.id)).toBeNull()
    expect(q.get(cancelled.id)).toBeNull()
    expect(q.get(bad.id)?.state).toBe('failed')
  })
})
