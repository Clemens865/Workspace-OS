/**
 * The native Agent menu, seen from the shell: what is pushed into it and what
 * each of its ids does (the menu itself is main/menu-agent.ts). Ids it does not
 * know (file actions, Checkpoints) belong to other listeners.
 */
export interface AgentMenuShell {
  focusAgents: () => void
  newAgent: () => void
  /** Whether the terminal dock has already been started (hidden or not). */
  dockRunning: () => boolean
  showTerminal: () => void
  addShellTab: () => void
  setMode: (mode: 'full' | 'safe') => void
  /** A new session in a dock tab; '' is the default assistant. */
  startAgent: (name: string) => void
}

const START = 'agent.start:'

export function runAgentMenuAction(id: string, shell: AgentMenuShell): boolean {
  if (id === 'agent.focus') shell.focusAgents()
  else if (id === 'agent.new') shell.newAgent()
  else if (id === 'shell.new') {
    // A dock that starts now opens with a shell tab of its own: adding one would make two.
    if (shell.dockRunning()) shell.addShellTab()
    shell.showTerminal()
  } else if (id === 'agent.mode:full') shell.setMode('full')
  else if (id === 'agent.mode:safe') shell.setMode('safe')
  else if (id.startsWith(START)) shell.startAgent(id.slice(START.length))
  else return false
  return true
}

/** What the shell pushes to the menu. No skills or active agent: nothing in the shell would act on them. */
export function agentMenuData(agents: { name: string }[], mode: 'full' | 'safe') {
  return { agents: agents.map((a) => ({ id: START + a.name, label: a.name })), skills: [] as { id: string; label: string }[], mode, activeAgent: null }
}
