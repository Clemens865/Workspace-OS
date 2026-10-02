/**
 * Which run last drove the in-app browser, and when. Agent browser actions
 * carry their run id (actionBridge → AGENT_ACTION_INVOKE); the executor
 * records it here so the landscape can show the page on the right agent's
 * screen. Tabs have no owner field; "the run that drove it last" is the honest
 * answer the runtime can give.
 */
export interface BrowserDriver {
  runId: string
  at: number
}

let current: BrowserDriver | null = null
const listeners = new Set<() => void>()

export const browserDriver = {
  get: (): BrowserDriver | null => current,
  record(runId: string | undefined, actionId: string): void {
    if (!runId || !actionId.startsWith('browser.')) return
    current = { runId, at: Date.now() }
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
