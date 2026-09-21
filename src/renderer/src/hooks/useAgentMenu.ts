import { useEffect } from 'react'

interface AgentMenuArgs {
  /** Only the visible/active agent session drives the native Agent menu. */
  active: boolean
  model?: string
  mode: 'full' | 'safe'
  setMode: (m: 'full' | 'safe') => void
  agentName: string | null
  selectAgent: (name: string | null) => void
  agents: { name: string }[]
  onRunSkill: (name: string) => void
  onNewAgent: () => void
}

/**
 * Mirrors the active agent session's state into the native Agent menu and
 * routes the menu's clicks back. App-level actions (focus, new shell) are
 * dispatched as window events handled higher up. Coexists with the file-action
 * `menu:run-action` listener — each ignores the other's ids.
 */
export function useAgentMenu(a: AgentMenuArgs): void {
  // Push current agents/skills/mode/active into the menu while active.
  useEffect(() => {
    if (!a.active) return
    let cancelled = false
    window.workspace.skills.list(a.model).then((skills) => {
      if (cancelled) return
      void window.workspace.menu.setAgentMenu({
        agents: a.agents.map((x) => ({ id: 'agent.select:' + x.name, label: x.name })),
        skills: skills.map((s) => ({ id: 'skill.run:' + s.name, label: s.name })),
        mode: a.mode,
        activeAgent: a.agentName,
      })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [a.model, a.active, a.mode, a.agentName, a.agents])

  // Route menu clicks while active.
  useEffect(() => {
    if (!a.active) return
    return window.workspace.menu.onRunAction((id) => {
      if (id === 'agent.focus') window.dispatchEvent(new CustomEvent('wos:focus-agent'))
      else if (id === 'agent.new') a.onNewAgent()
      else if (id === 'shell.new') window.dispatchEvent(new CustomEvent('wos:new-shell'))
      else if (id === 'agent.mode:full') a.setMode('full')
      else if (id === 'agent.mode:safe') a.setMode('safe')
      else if (id.startsWith('agent.select:')) a.selectAgent(id.slice('agent.select:'.length) || null)
      else if (id.startsWith('skill.run:')) a.onRunSkill(id.slice('skill.run:'.length))
      // other ids (file actions) are handled elsewhere
    })
  }, [a.model, a.active, a.setMode, a.selectAgent, a.onRunSkill, a.onNewAgent])
}
