import { useCallback, useEffect, useState } from 'react'
import { AgentCard, type AgentCardData } from './AgentCard'
import { AgentDetail } from './AgentDetail'
import { AgentFoundry } from './AgentFoundry'
import { launchAgent } from './launch'
import styles from './AgentRoster.module.css'

/**
 * The "Team" roster: the user's specialized agents shown as calm portrait cards.
 * Reads the roster via the existing agents API (renderer-only). Clicking a card
 * opens the detail drawer; Run launches a bound agent tab; the final dashed
 * "New specialist" card stubs the upcoming agent Foundry.
 */
export function AgentRoster(): JSX.Element {
  const [agents, setAgents] = useState<AgentCardData[]>([])
  const [selected, setSelected] = useState<{ name: string; scope: 'global' | 'project' } | null>(null)

  const refresh = useCallback(() => {
    window.workspace.agents
      .list()
      .then((list) => setAgents(list as AgentCardData[]))
      .catch(() => setAgents([]))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // The Foundry dispatches `wos:agents-changed` after a save — re-list so the
  // freshly forged specialist appears in the roster.
  useEffect(() => {
    window.addEventListener('wos:agents-changed', refresh)
    return () => window.removeEventListener('wos:agents-changed', refresh)
  }, [refresh])

  const openNew = useCallback(() => {
    // TODO(foundry): open the agent Foundry ("describe it — we build the agent").
    window.dispatchEvent(new CustomEvent('wos:new-agent'))
  }, [])

  const scopeOf = (name: string): 'global' | 'project' =>
    agents.find((a) => a.name === name)?.scope ?? 'global'

  return (
    <section className={styles.surface} data-testid="agent-roster">
      {agents.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyHero}>
            <div className={styles.emptyTitle}>Build your team of specialists</div>
            <p className={styles.emptyText}>
              Custom agents are assistants tuned for one job — a researcher, an editor, an
              analyst. Describe what you need and we’ll build the agent.
            </p>
          </div>
          <div className={styles.grid}>
            <NewSpecialist onClick={openNew} />
          </div>
        </div>
      ) : (
        <div className={styles.grid}>
          {agents.map((a) => (
            <AgentCard
              key={`${a.scope}:${a.name}`}
              agent={a}
              onOpen={(name) => setSelected({ name, scope: scopeOf(name) })}
              onRun={launchAgent}
            />
          ))}
          <NewSpecialist onClick={openNew} />
        </div>
      )}

      {selected && (
        <AgentDetail
          name={selected.name}
          scope={selected.scope}
          onClose={() => setSelected(null)}
          onRun={(name) => {
            launchAgent(name)
            setSelected(null)
          }}
          onDeleted={() => {
            setSelected(null)
            refresh()
          }}
        />
      )}

      {/* The Agent Foundry — opens on the `wos:new-agent` event (roster + detail). */}
      <AgentFoundry />
    </section>
  )
}

function NewSpecialist({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button className={styles.newCard} onClick={onClick} data-testid="agent-new">
      <span className={styles.plus}>+</span>
      <span className={styles.newTitle}>New specialist</span>
      <span className={styles.newText}>describe it — we build the agent</span>
    </button>
  )
}
