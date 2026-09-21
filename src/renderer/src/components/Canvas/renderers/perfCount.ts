// Dev-only render/callback instrument for the responsiveness pass.
//
// Increments named counters on `window.__perf` so an e2e can MEASURE that the
// hot-path fixes (memoized callbacks, setActive equality guard, unchanged-rect
// early-returns) actually eliminate re-renders/allocations. Zero-cost in prod:
// the whole thing compiles out unless `window.__wosPerf` is truthy (only set by
// the e2e), so shipping builds never touch it.

interface PerfBag {
  [key: string]: number
}

/** Bump a named counter — a no-op unless the e2e has armed the instrument. */
export function perfBump(key: string): void {
  const w = window as unknown as { __wosPerf?: boolean; __perf?: PerfBag }
  if (!w.__wosPerf) return
  const bag = w.__perf ?? (w.__perf = {})
  bag[key] = (bag[key] ?? 0) + 1
}
