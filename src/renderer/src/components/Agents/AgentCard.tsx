import { AgentAvatar } from './AgentAvatar'
import styles from './AgentCard.module.css'

export interface AgentCardData {
  name: string
  description: string
  scope: 'global' | 'project'
  mode?: 'full' | 'safe'
  /** Loaded lazily on detail; used for chips when present. */
  skills?: string[]
}

interface AgentCardProps {
  agent: AgentCardData
  onOpen: (name: string) => void
  onRun: (name: string) => void
}

/** Capability chips: prefer real skills, else fall back to the mode label. */
function chipsFor(agent: AgentCardData): string[] {
  if (agent.skills && agent.skills.length) return agent.skills.slice(0, 3)
  return [agent.mode === 'safe' ? 'Safe mode' : 'Full access']
}

/**
 * One agent as a calm portrait card: avatar + name + one-line specialty +
 * capability chips + an idle status dot + a subtle blue Run affordance.
 * Clicking the card body opens the detail; Run launches a bound agent tab.
 */
export function AgentCard({ agent, onOpen, onRun }: AgentCardProps): JSX.Element {
  const chips = chipsFor(agent)
  return (
    <div
      className={styles.card}
      data-testid={`agent-card-${agent.name}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(agent.name)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(agent.name)
        }
      }}
    >
      <div className={styles.head}>
        <AgentAvatar seed={agent.name} size={52} />
        <span className={styles.dot} title="Idle" aria-label="Idle" />
      </div>
      <div className={styles.name}>{agent.name}</div>
      <div className={styles.desc}>{agent.description || 'A specialist assistant.'}</div>
      <div className={styles.chips}>
        {chips.map((c) => (
          <span key={c} className={styles.chip}>
            {c}
          </span>
        ))}
        {agent.scope === 'project' && <span className={styles.chipScope}>Project</span>}
      </div>
      <div className={styles.foot}>
        <button
          className={styles.run}
          onClick={(e) => {
            e.stopPropagation()
            onRun(agent.name)
          }}
          data-testid={`agent-run-${agent.name}`}
        >
          Run
        </button>
      </div>
    </div>
  )
}
