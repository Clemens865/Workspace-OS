import { useEffect, useState } from 'react'

/** Where a roster agent is defined (global or this project), for deleting it in the right place. */
export function useAgentScope(name: string): 'global' | 'project' | undefined {
  const [scope, setScope] = useState<'global' | 'project' | undefined>(undefined)
  useEffect(() => {
    let live = true
    void window.workspace.agents
      .list()
      .then((l) => live && setScope(l.find((x) => x.name === name)?.scope))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [name])
  return scope
}
