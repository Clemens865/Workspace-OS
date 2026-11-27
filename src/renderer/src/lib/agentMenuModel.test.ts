import { describe, expect, it, vi } from 'vitest'
import { agentMenuData, runAgentMenuAction, type AgentMenuShell } from './agentMenuModel'

function shell(dockRunning = false): AgentMenuShell & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    focusAgents: vi.fn(() => void calls.push('focus')),
    newAgent: vi.fn(() => void calls.push('new-agent')),
    dockRunning: () => dockRunning,
    showTerminal: vi.fn(() => void calls.push('show-terminal')),
    addShellTab: vi.fn(() => void calls.push('add-shell')),
    setMode: vi.fn((m) => void calls.push(`mode:${m}`)),
    startAgent: vi.fn((n) => void calls.push(`start:${n}`)),
  }
}
const run = (id: string, s = shell()): string[] => {
  runAgentMenuAction(id, s)
  return s.calls
}

describe('the native Agent menu', () => {
  it('focuses the Agents surface and opens the new-agent flow', () => {
    expect(run('agent.focus')).toEqual(['focus'])
    expect(run('agent.new')).toEqual(['new-agent'])
  })

  it('New Shell adds a tab to a running terminal', () => {
    expect(run('shell.new', shell(true))).toEqual(['add-shell', 'show-terminal'])
  })

  it('New Shell on a terminal not started yet only shows it: it opens with a shell', () => {
    expect(run('shell.new', shell(false))).toEqual(['show-terminal'])
  })

  it('sets the mode new runs start in', () => {
    expect(run('agent.mode:safe')).toEqual(['mode:safe'])
    expect(run('agent.mode:full')).toEqual(['mode:full'])
    expect(run('agent.mode:anything')).toEqual([])
  })

  it('starts a session with the picked agent, or the default assistant', () => {
    expect(run('agent.start:Elias — Writer')).toEqual(['start:Elias — Writer'])
    expect(run('agent.start:')).toEqual(['start:'])
  })

  it('leaves other menu ids alone', () => {
    for (const id of ['agent.checkpoints', 'go.quickopen', 'office.save']) {
      const s = shell()
      expect(runAgentMenuAction(id, s)).toBe(false)
      expect(s.calls).toEqual([])
    }
  })

  it('pushes the roster and the mode to the menu, and no skills (nothing runs them)', () => {
    expect(agentMenuData([{ name: 'Elias' }], 'safe')).toEqual({ agents: [{ id: 'agent.start:Elias', label: 'Elias' }], skills: [], mode: 'safe', activeAgent: null })
  })
})
