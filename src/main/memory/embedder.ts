import { Worker } from 'worker_threads'
import { loadExtractor, embedWith, MODEL_KEY, type EmbedKind } from './embed-core'

/**
 * Who turns text into meaning vectors. Memory works without one (word search
 * only); with one, recall also finds what is meant, not only what is said.
 *
 * `status` is honest about the first run: the model is downloaded once
 * (~120 MB) and until then recall stays word-only rather than waiting.
 */
/** idle: not asked for yet; loading: first load (or download) under way. */
export type EmbedStatus = 'idle' | 'loading' | 'ready' | 'failed'

export interface Embedder {
  /** Identity of the vector space; stored with every vector. */
  readonly model: string
  status(): EmbedStatus
  /** Vectors for the texts, or null when the model is not available. */
  embed(texts: string[], kind: EmbedKind): Promise<Float32Array[] | null>
}

/** In this process (tests, the measurement). */
export function inProcessEmbedder(cacheDir: string): Embedder {
  let state: EmbedStatus = 'idle'
  return {
    model: MODEL_KEY,
    status: () => state,
    async embed(texts, kind) {
      if (state === 'idle') state = 'loading'
      try {
        const vecs = await embedWith(await loadExtractor(cacheDir), texts, kind)
        state = 'ready'
        return vecs
      } catch {
        state = 'failed'
        return null
      }
    },
  }
}

// Built as a sibling entry by electron-vite (see electron.vite.config.ts).
const WORKER_URL = new URL('./embedWorker.js', import.meta.url)
const JOB_TIMEOUT_MS = 10 * 60_000 // the first job may include the download

/** In a worker thread (the app). A crashed worker is replaced on the next call. */
export function workerEmbedder(cacheDir: string): Embedder {
  let w: Worker | null = null
  let state: EmbedStatus = 'idle'
  let next = 1
  const waiting = new Map<number, { resolve: (v: Float32Array[] | null) => void; timer: NodeJS.Timeout }>()
  const settle = (id: number, v: Float32Array[] | null): void => {
    const job = waiting.get(id)
    if (!job) return
    clearTimeout(job.timer)
    waiting.delete(id)
    job.resolve(v)
  }
  const worker = (): Worker => {
    if (w) return w
    const nw = new Worker(WORKER_URL)
    nw.unref()
    nw.on('message', (m: { id: number; vecs?: Float32Array[]; error?: string }) => {
      state = m.vecs ? 'ready' : 'failed'
      settle(m.id, m.vecs ?? null)
    })
    const lost = (): void => {
      if (w === nw) w = null
      for (const id of [...waiting.keys()]) settle(id, null)
    }
    nw.on('error', lost)
    nw.on('exit', lost)
    w = nw
    return nw
  }
  return {
    model: MODEL_KEY,
    status: () => state,
    embed(texts, kind) {
      if (texts.length === 0) return Promise.resolve([])
      if (state === 'idle' || state === 'failed') state = 'loading' // a failed one is retried
      return new Promise((resolve) => {
        const id = next++
        const timer = setTimeout(() => settle(id, null), JOB_TIMEOUT_MS)
        waiting.set(id, { resolve, timer })
        try {
          worker().postMessage({ id, cacheDir, texts, kind })
        } catch {
          state = 'failed'
          settle(id, null)
        }
      })
    },
  }
}
