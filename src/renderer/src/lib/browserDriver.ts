/**
 * Which run drives which browser tab, and when. Agent browser actions carry
 * their run id (actionBridge → AGENT_ACTION_INVOKE) and, when they target a
 * tab of their own, its id (`{"tab": …}`, or the id browser.newTab returned).
 * The executor records it here, so the landscape shows each agent the page
 * IT drives, and the browser can name a tab's agent (docs/landscape/
 * ADOPTION.md B5). A drive without a tab means the active tab: that page
 * belongs to whichever run drove it last.
 */
export interface BrowserDriver {
  runId: string
  at: number
  /** The tab this run drives; null = the active tab. */
  tab: string | null
}

let current: BrowserDriver | null = null
const byRun = new Map<string, BrowserDriver>()
const listeners = new Set<() => void>()

export const browserDriver = {
  /** The latest drive of all. */
  get: (): BrowserDriver | null => current,
  /** The latest drive of one run. */
  forRun: (runId: string | null | undefined): BrowserDriver | null => (runId ? (byRun.get(runId) ?? null) : null),
  record(runId: string | undefined, actionId: string, tab?: string | null): void {
    if (!runId || !actionId.startsWith('browser.')) return
    const d: BrowserDriver = { runId, at: Date.now(), tab: tab ?? null }
    byRun.set(runId, d)
    current = d
    if (byRun.size > 200) byRun.delete(byRun.keys().next().value as string)
    listeners.forEach((l) => l())
  },
  subscribe(l: () => void): () => void {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}

// Expose for e2e harnesses: a test records a drive without a real agent run.
if (typeof window !== 'undefined') {
  ;(window as unknown as { __browserDriver?: typeof browserDriver }).__browserDriver = browserDriver
}
