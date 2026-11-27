import { useEffect, useState } from 'react'

/** A launchable custom agent from the `.claude/agents/*.md` roster. */
export interface RosterAgent {
  name: string
  description: string
}

/**
 * Loads the custom-agent roster (`.claude/agents/*.md`) for the launch menu.
 * Read-only: the same IPC the Agent dropdown already uses.
 */
export function useAgentRoster(): RosterAgent[] {
  const [roster, setRoster] = useState<RosterAgent[]>([])
  useEffect(() => {
    let cancelled = false
    window.workspace.agents
      .list()
      .then((a) => {
        if (!cancelled) setRoster(a.map((x) => ({ name: x.name, description: x.description ?? '' })))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  return roster
}

/** The retired agent console's launch event (AgentTerminal.tsx). The live path is Agents/launch.ts. */
export const FLEET_LAUNCH_EVENT = 'wos:fleet-launch-agent'

export interface FleetLaunchDetail {
  sessionId: string
  name: string
  agentName: string
}
