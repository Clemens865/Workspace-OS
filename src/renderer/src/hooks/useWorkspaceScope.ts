import { useEffect, useSyncExternalStore } from 'react'
import { workspaceScope } from '../lib/workspaceScope'
import { sessionStore } from '../components/AgentTerminal/sessionStore'
import { reviewStore } from '../components/Review/reviewStore'

/** The live scope key; components that seeded from a store key themselves by it. */
export function useWorkspaceScope(): string {
  return useSyncExternalStore(
    (l) => workspaceScope.subscribe(() => l()),
    () => workspaceScope.get(),
    () => workspaceScope.get(),
  )
}

/**
 * App-level: follow the workspace root and point the per-workspace stores at
 * it. Called ONCE, above the shell switch. The stores switch inside the
 * subscription, before any subscriber re-renders, so a keyed remount reads
 * the new workspace's tabs and the feed shows its runs.
 */
export function useBindWorkspaceScope(): void {
  useEffect(() => {
    const off = workspaceScope.subscribe((scope) => {
      sessionStore.switchScope(scope)
      reviewStore.switchScope(scope)
    })
    void window.workspace.fs
      .getWorkspaceRoot()
      .then((r) => workspaceScope.set(r))
      .catch(() => workspaceScope.set(null))
    const offRoot = window.workspace.fs.onRootChanged((r) => workspaceScope.set(r))
    return () => {
      off()
      offRoot()
    }
  }, [])
}
