import { Worker } from 'worker_threads'

/**
 * A small pool of extraction workers. `extract(path)` resolves with the file's
 * text (or null). Robustness:
 *  - bounded concurrency (one job per worker)
 *  - per-job timeout — a parser that hangs on a pathological file resolves null
 *    and its worker is recycled, so the queue never wedges
 *  - crash recovery — a worker that errors/exits is respawned and its in-flight
 *    job resolves null
 */

// Built as a sibling entry by electron-vite (see electron.vite.config.ts).
const WORKER_URL = new URL('./extractWorker.js', import.meta.url)
const JOB_TIMEOUT_MS = 25_000

interface Job {
  id: number
  filePath: string
  resolve: (v: string | null) => void
}

export class ExtractPool {
  private workers: Worker[] = []
  private idle: Worker[] = []
  private busy = new Map<Worker, { job: Job; timer: NodeJS.Timeout }>()
  private queue: Job[] = []
  private nextId = 1
  private stopped = false

  constructor(private size: number) {
    for (let i = 0; i < size; i++) this.spawn()
  }

  private spawn(): void {
    if (this.stopped) return
    let w: Worker
    try {
      w = new Worker(WORKER_URL)
    } catch {
      return // can't spawn (e.g. worker file missing) — extract() will time out → null
    }
    w.on('message', (m: { id: number; content: string | null }) => this.onDone(w, m.id, m.content))
    w.on('error', () => this.recycle(w))
    w.on('exit', () => { if (this.busy.has(w) || this.idle.includes(w)) this.recycle(w) })
    this.workers.push(w)
    this.idle.push(w)
    this.pump()
  }

  private recycle(w: Worker): void {
    const entry = this.busy.get(w)
    if (entry) {
      clearTimeout(entry.timer)
      this.busy.delete(w)
      entry.job.resolve(null) // failed job → no content
    }
    this.workers = this.workers.filter((x) => x !== w)
    this.idle = this.idle.filter((x) => x !== w)
    void w.terminate().catch(() => {})
    this.spawn() // keep the pool at size
  }

  private onDone(w: Worker, id: number, content: string | null): void {
    const entry = this.busy.get(w)
    if (!entry || entry.job.id !== id) return
    clearTimeout(entry.timer)
    this.busy.delete(w)
    entry.job.resolve(content)
    this.idle.push(w)
    this.pump()
  }

  extract(filePath: string): Promise<string | null> {
    if (this.stopped) return Promise.resolve(null)
    return new Promise((resolve) => {
      this.queue.push({ id: this.nextId++, filePath, resolve })
      this.pump()
    })
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const w = this.idle.pop()!
      const job = this.queue.shift()!
      const timer = setTimeout(() => this.recycle(w), JOB_TIMEOUT_MS)
      this.busy.set(w, { job, timer })
      w.postMessage({ id: job.id, filePath: job.filePath })
    }
  }

  async terminate(): Promise<void> {
    this.stopped = true
    for (const { timer, job } of this.busy.values()) { clearTimeout(timer); job.resolve(null) }
    for (const job of this.queue) job.resolve(null)
    this.busy.clear()
    this.queue = []
    await Promise.all(this.workers.map((w) => w.terminate().catch(() => {})))
    this.workers = []
    this.idle = []
  }
}
