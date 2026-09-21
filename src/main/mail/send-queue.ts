/**
 * Undo send — a hold window between clicking Send and the SMTP handoff.
 *
 * Sending is the one genuinely irreversible act in this mail client. Everything
 * else is journalled with an inverse; a delivered message cannot be recalled by
 * anyone, whatever Outlook's "recall" button implies. So the only honest way to
 * offer undo is to NOT SEND YET.
 *
 * The window is short and real: the message sits here, in memory, and the timer
 * is the only thing that will hand it to SMTP. Cancelling within the window
 * means nothing ever left the machine. Once the timer fires, the offer is
 * withdrawn — the UI must never show "Undo" for something already delivered,
 * because that is a lie the user only discovers afterwards.
 *
 * Deliberately in-memory: a queued send must NOT survive a crash or a quit. A
 * message that silently posts itself on next launch, minutes or days later, is
 * far worse than one that was never sent — the user has moved on and no longer
 * expects it.
 */

export type QueuedState = 'holding' | 'sending' | 'sent' | 'cancelled' | 'failed'

export interface QueuedSend<T> {
  id: string
  state: QueuedState
  /** When the hold expires and the send actually begins. */
  dueAt: number
  payload: T
  error: string | null
}

export interface SendQueueOptions {
  /** Hold duration in ms. Kept modest — a long hold feels like mail not sending. */
  holdMs?: number
  now?: () => number
  /** Injected so tests drive the clock rather than sleeping. */
  schedule?: (fn: () => void, ms: number) => unknown
  cancelScheduled?: (handle: unknown) => void
}

export class SendQueue<T> {
  private items = new Map<string, QueuedSend<T>>()
  private handles = new Map<string, unknown>()
  private seq = 0

  constructor(
    private readonly deliver: (payload: T) => Promise<{ ok: boolean; error?: string }>,
    private readonly opts: SendQueueOptions = {},
  ) {}

  private get holdMs(): number {
    return this.opts.holdMs ?? 8000
  }
  private now(): number {
    return (this.opts.now ?? Date.now)()
  }

  /** Queues a message and starts the hold. Returns immediately. */
  enqueue(payload: T): QueuedSend<T> {
    const id = `send-${++this.seq}`
    const item: QueuedSend<T> = {
      id,
      state: 'holding',
      dueAt: this.now() + this.holdMs,
      payload,
      error: null,
    }
    this.items.set(id, item)

    const sched = this.opts.schedule ?? ((fn, ms) => setTimeout(fn, ms))
    this.handles.set(id, sched(() => void this.flush(id), this.holdMs))
    return item
  }

  /**
   * Cancels a held send. Only possible while `holding` — once delivery has
   * begun there is nothing to cancel, and pretending otherwise would be the
   * lie this whole mechanism exists to avoid.
   */
  cancel(id: string): boolean {
    const item = this.items.get(id)
    if (!item || item.state !== 'holding') return false
    item.state = 'cancelled'
    const cancelScheduled = this.opts.cancelScheduled ?? ((h) => clearTimeout(h as NodeJS.Timeout))
    const handle = this.handles.get(id)
    if (handle !== undefined) cancelScheduled(handle)
    this.handles.delete(id)
    return true
  }

  /** Sends immediately, skipping the remaining hold ("Send now"). */
  async sendNow(id: string): Promise<QueuedSend<T> | null> {
    const item = this.items.get(id)
    if (!item || item.state !== 'holding') return null
    const cancelScheduled = this.opts.cancelScheduled ?? ((h) => clearTimeout(h as NodeJS.Timeout))
    const handle = this.handles.get(id)
    if (handle !== undefined) cancelScheduled(handle)
    this.handles.delete(id)
    return this.flush(id)
  }

  /** Performs the delivery. Idempotent per id — a double flush cannot double-send. */
  private async flush(id: string): Promise<QueuedSend<T> | null> {
    const item = this.items.get(id)
    if (!item || item.state !== 'holding') return null
    item.state = 'sending'
    this.handles.delete(id)

    const res = await this.deliver(item.payload)
    item.state = res.ok ? 'sent' : 'failed'
    item.error = res.ok ? null : (res.error ?? 'Sending failed.')
    return item
  }

  get(id: string): QueuedSend<T> | null {
    return this.items.get(id) ?? null
  }

  /** Everything still inside its hold window — what the UI offers to undo. */
  holding(): QueuedSend<T>[] {
    return [...this.items.values()].filter((i) => i.state === 'holding')
  }

  /** Drops finished entries so the queue does not grow for a whole session. */
  prune(): void {
    for (const [id, item] of this.items) {
      if (item.state === 'sent' || item.state === 'cancelled') this.items.delete(id)
    }
  }
}
