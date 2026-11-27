/**
 * The one launch path for a roster agent ('' = the default assistant): the shell
 * opens the Terminal Dock on a new tab bound to it, and the landscape steps
 * aside to show it.
 *
 * WorkspaceShell owns the dock's open state (settings.terminalOpen), so we
 * dispatch a renderer CustomEvent it listens for rather than reaching across.
 */
export const LAUNCH_AGENT_EVENT = 'wos:launch-agent'

export function launchAgent(name: string): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LAUNCH_AGENT_EVENT, { detail: { name } }))
}
