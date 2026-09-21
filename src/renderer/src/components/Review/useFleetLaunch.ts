import { useEffect, useState } from 'react'
import { sessionStore } from '../AgentTerminal/sessionStore'
import { loadSettings } from '../../hooks/useSettings'

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

/**
 * The window event AgentTerminal listens for to open a fresh agent tab in its
 * own lane. Reuses the existing session-start path — this does NOT build a new
 * agent runner. Detail carries the created session id + the chosen persona.
 */
export const FLEET_LAUNCH_EVENT = 'wos:fleet-launch-agent'

export interface FleetLaunchDetail {
  sessionId: string
  name: string
  agentName: string
}

/**
 * Launches a roster agent into a NEW lane: creates a session record (pre-pinning
 * the persona so its first run attributes to it), then asks AgentTerminal to
 * open + activate the tab via a window event. The Review store gets the lane the
 * moment that session's first run opens (agentId = sessionId).
 */
export function launchAgentIntoLane(agentName: string): FleetLaunchDetail {
  const rec = sessionStore.create({
    name: agentName,
    agentName,
    mode: loadSettings().agentMode,
  })
  sessionStore.setActive(rec.sessionId)
  const detail: FleetLaunchDetail = { sessionId: rec.sessionId, name: agentName, agentName }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<FleetLaunchDetail>(FLEET_LAUNCH_EVENT, { detail }))
  }
  return detail
}
