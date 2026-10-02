/**
 * The last lines each run has written, for the landscape's agent screens.
 * Runs stream assistant text through `agent.onOutput` (dock and background
 * alike, keyed by run id), but nothing kept a shared tail; the dock keeps its
 * own transcript and the job queue only republishes its tail on the next patch.
 * Bounded: the last TAIL chars per run, the last RUNS runs.
 */
const TAIL = 1200
const RUNS = 40

export interface OutputTail {
  text: string
  at: number
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g

/** Strip terminal colour codes and carriage returns; keep line breaks. */
export function clean(chunk: string): string {
  return chunk.replace(ANSI, '').replace(/\r(?!\n)/g, '\n').replace(/\r/g, '')
}

/** Append a chunk to a bounded tail. */
export function appendTail(prev: string, chunk: string, max = TAIL): string {
  const next = prev + clean(chunk)
  return next.length > max ? next.slice(next.length - max) : next
}

/** The last `n` non-empty lines of a tail. */
export function lastLines(text: string, n = 4): string[] {
  return text
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0)
    .slice(-n)
}

class OutputStore {
  private tails = new Map<string, OutputTail>()
  private listeners = new Set<() => void>()
  private version = 0
  private off: (() => void) | null = null

  /** Start listening (idempotent). */
  attach(): void {
    if (this.off || typeof window === 'undefined') return
    this.off = window.workspace?.agent?.onOutput?.((runId: string, chunk: string) => this.push(runId, chunk)) ?? null
  }

  push(runId: string, chunk: string): void {
    const prev = this.tails.get(runId)
    this.tails.delete(runId)
    this.tails.set(runId, { text: appendTail(prev?.text ?? '', chunk), at: Date.now() })
    while (this.tails.size > RUNS) this.tails.delete(this.tails.keys().next().value as string)
    this.version++
    this.listeners.forEach((l) => l())
  }

  get(runId: string | null): OutputTail | undefined {
    return runId ? this.tails.get(runId) : undefined
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  getVersion = (): number => this.version
}

export const outputStore = new OutputStore()

// Expose for e2e harnesses (like window.__reviewStore), to seed a run's output.
if (typeof window !== 'undefined') {
  ;(window as unknown as { __landscapeOutput?: OutputStore }).__landscapeOutput = outputStore
}
