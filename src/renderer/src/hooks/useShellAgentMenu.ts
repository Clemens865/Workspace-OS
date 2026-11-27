import { useEffect, useState } from 'react'
import { agentMenuData } from '../lib/agentMenuModel'

/** Keeps the native Agent menu showing this workspace's roster and the current run mode. */
export function useShellAgentMenu(root: string | null, mode: 'full' | 'safe'): void {
  const [agents, setAgents] = useState<{ name: string }[]>([])
  useEffect(() => {
    let live = true
    const read = (): void => {
      void window.workspace.agents
        .list()
        .then((a) => live && setAgents(a))
        .catch(() => {})
    }
    read()
    window.addEventListener('wos:agents-changed', read)
    return () => {
      live = false
      window.removeEventListener('wos:agents-changed', read)
    }
  }, [root])
  useEffect(() => {
    void window.workspace.menu.setAgentMenu(agentMenuData(agents, mode))
  }, [agents, mode])
}
