import type { MI } from './menu-office'

/**
 * The top-level Agent menu, as data (no electron at run time, so it is
 * unit-testable). Every item sends an id the renderer shell handles
 * (renderer/src/lib/agentMenuModel.ts, plus the shell's own Checkpoints).
 */
export interface AgentMenuData {
  agents: { id: string; label: string }[]
  mode: 'full' | 'safe'
}

export function agentMenuTemplate(data: AgentMenuData, send: (id: string) => void): MI {
  return {
    label: 'Agent',
    submenu: [
      { label: 'Focus Agent', accelerator: 'CmdOrCtrl+Shift+A', click: () => send('agent.focus') },
      { label: 'New Agent…', click: () => send('agent.new') },
      { label: 'New Shell', click: () => send('shell.new') },
      { type: 'separator' },
      // Checkpoint timeline — every agent-run snapshot, with diff + restore.
      { label: 'Checkpoints…', click: () => send('agent.checkpoints') },
      { type: 'separator' },
      {
        label: 'Mode',
        submenu: [
          { label: 'Full (run any command)', type: 'radio', checked: data.mode === 'full', click: () => send('agent.mode:full') },
          { label: 'Safe (read + generate only)', type: 'radio', checked: data.mode === 'safe', click: () => send('agent.mode:safe') },
        ],
      },
      {
        // A session keeps the agent it started with, so these start one.
        label: 'New Session With',
        submenu: [
          { label: 'Default assistant', click: () => send('agent.start:') },
          ...data.agents.map((a): MI => ({ label: a.label, click: () => send(a.id) })),
        ],
      },
    ],
  }
}
