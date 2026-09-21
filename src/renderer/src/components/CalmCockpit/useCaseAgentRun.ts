import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { WorkCase } from '../../types/workspace-api'
import { workspaceScope } from '../../lib/workspaceScope'
import { CaseAgentRuns, caseAgentKey, caseAgentBusy } from './caseAgentRuns'

export const caseAgentRuns = new CaseAgentRuns(() => window.workspace)

export function useCaseAgentRun(c: WorkCase, onChanged: () => void) {
  useSyncExternalStore(workspaceScope.subscribe, workspaceScope.get, workspaceScope.get)
  const key = caseAgentKey(c, workspaceScope.root())
  const run = useSyncExternalStore(caseAgentRuns.subscribe, () => caseAgentRuns.get(key), () => null)
  const refreshed = useRef<string | null>(null)
  useEffect(() => {
    if (!run || caseAgentBusy(run) || refreshed.current === run.runId) return
    refreshed.current = run.runId
    onChanged() // refresh notes and artifacts written back by either provider
  }, [run, onChanged])
  return { run, key, agentBusy: caseAgentBusy(run) }
}
