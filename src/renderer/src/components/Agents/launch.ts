import { launchAgentIntoLane } from '../Review/useFleetLaunch'

/**
 * Fire-and-open launch path for a roster agent. Reuses the EXACT fleet launch
 * (session record + FLEET_LAUNCH_EVENT that AgentTerminal listens for), and
 * also asks the shell to open the Terminal Dock so the new tab is visible.
 *
 * WorkspaceShell owns the dock's open state (settings.terminalOpen), so we
 * dispatch a renderer CustomEvent it listens for rather than reaching across.
 */
export const LAUNCH_AGENT_EVENT = 'wos:launch-agent'

export function launchAgent(name: string): void {
  if (typeof window !== 'undefined') {
    // Ask the shell to reveal the dock (WorkspaceShell listens + opens it).
    window.dispatchEvent(new CustomEvent(LAUNCH_AGENT_EVENT, { detail: { name } }))
  }
  // Reuse the proven fleet path: create the session + open its AgentTerminal tab.
  launchAgentIntoLane(name)
}
