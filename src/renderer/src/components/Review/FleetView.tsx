import { useMemo, useState } from 'react'
import { FleetLaneCard } from './FleetLaneCard'
import { useReviewStore } from './useReviewStore'
import { groupByAgent, selectBatchApprovals } from './reviewModel'
import { reviewStore } from './reviewStore'
import { launchAgentIntoLane, useAgentRoster } from './useFleetLaunch'
import styles from './FleetView.module.css'

interface FleetViewProps {
  onOpenFile: (path: string) => void
  onWorkspaceChanged: () => void
}

/**
 * The fleet cockpit: N concurrent agents as lanes. Each lane rolls up its
 * agent's runs + live requests (groupByAgent), and the fleet header offers a
 * cross-lane "approve all reversible" (gated/irreversible items are never
 * batched — the note says how many are left) plus a launch-agent affordance.
 * Reuses FeedCard/HitlCard inside each lane — identical behavior to the feed.
 */
export function FleetView({ onOpenFile, onWorkspaceChanged }: FleetViewProps): JSX.Element {
  const { runs, hitl } = useReviewStore()
  const roster = useAgentRoster()
  const [launchOpen, setLaunchOpen] = useState(false)

  const lanes = useMemo(() => groupByAgent(runs, hitl), [runs, hitl])
  const sel = useMemo(() => selectBatchApprovals(runs, hitl), [runs, hitl])
  const batchable = sel.runs.length + sel.hitl.length

  return (
    <div className={styles.root} data-testid="fleet-view">
      <div className={styles.fleetBar}>
        <span className={styles.fleetTitle}>
          {lanes.length} agent{lanes.length === 1 ? '' : 's'} in the fleet
        </span>
        <span className={styles.spacer} />
        {batchable > 0 && (
          <button className={styles.approveAll} onClick={() => reviewStore.approveReversible()} data-testid="fleet-approve-all">
            Approve all safe changes ({batchable}) — never sends anything
          </button>
        )}
        {sel.gatedExcluded > 0 && (
          <span className={styles.gatedNote}>{sel.gatedExcluded} still need you</span>
        )}
        <div className={styles.launchWrap}>
          <button className={styles.launchBtn} onClick={() => setLaunchOpen((o) => !o)} data-testid="fleet-launch">
            + Launch agent
          </button>
          {launchOpen && (
            <div className={styles.launchMenu} role="menu">
              {roster.length === 0 && <div className={styles.launchEmpty}>No custom agents. Add one in .claude/agents.</div>}
              {roster.map((a) => (
                <button
                  key={a.name}
                  className={styles.launchItem}
                  role="menuitem"
                  onClick={() => { launchAgentIntoLane(a.name); setLaunchOpen(false) }}
                  title={a.description}
                >
                  {a.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={styles.lanes}>
        {lanes.length === 0 ? (
          <div className={styles.empty}>No agents yet. Launch one, or run a prompt from the terminal.</div>
        ) : (
          lanes.map((lane) => (
            <FleetLaneCard
              key={lane.agentId}
              lane={lane}
              onOpenFile={onOpenFile}
              onWorkspaceChanged={onWorkspaceChanged}
            />
          ))
        )}
      </div>
    </div>
  )
}
