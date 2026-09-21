import { useState } from 'react'
import { FeedCard } from './FeedCard'
import { HitlCard } from './HitlCard'
import { reviewStore } from './reviewStore'
import { selectBatchApprovals, type FleetLane, type LaneStatus } from './reviewModel'
import { StatusPill, laneTone } from '../ui/StatusPill'
import styles from './FleetView.module.css'

interface FleetLaneCardProps {
  lane: FleetLane
  onOpenFile: (path: string) => void
  onWorkspaceChanged: () => void
}

const STATUS_LABEL: Record<LaneStatus, string> = {
  error: 'error',
  'awaiting-approval': 'awaiting you',
  running: 'running',
  done: 'idle',
}
const STATUS_DOT: Record<LaneStatus, string> = {
  error: '#e87878',
  'awaiting-approval': '#0071E3',
  running: '#e0b341',
  done: '#8A8A8E',
}

/**
 * One agent's lane in the fleet cockpit. Collapsed: a compact header (name,
 * status dot, pending count, latest activity). Expanded: the lane's own cards
 * (FeedCard / HitlCard, reused verbatim) plus a per-lane "approve reversible"
 * batch control. Gated/irreversible items are never batched — the header says
 * how many still need the human.
 */
export function FleetLaneCard({ lane, onOpenFile, onWorkspaceChanged }: FleetLaneCardProps): JSX.Element {
  const [open, setOpen] = useState(lane.pending > 0)
  const dot = STATUS_DOT[lane.status]

  // How many reversible items this lane could batch-approve, and how many gated
  // ones would be (correctly) left for the human.
  const sel = selectBatchApprovals(lane.runs, lane.hitl, lane.agentId)
  const batchable = sel.runs.length + sel.hitl.length

  const approveReversible = (): void => {
    reviewStore.approveReversible(lane.agentId)
  }

  return (
    <article className={styles.lane} data-testid="fleet-lane" data-agent={lane.agentId}>
      <button
        className={styles.laneHeader}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid="fleet-lane-header"
      >
        <span className={styles.dot} style={{ background: dot, boxShadow: `0 0 10px ${dot}66` }} />
        <span className={styles.laneName}>{lane.agentName}</span>
        <StatusPill tone={laneTone(lane.status)}>{STATUS_LABEL[lane.status]}</StatusPill>
        {lane.pending > 0 && <span className={styles.pendingPill}>{lane.pending}</span>}
        <span className={styles.spacer} />
        <span className={styles.laneMeta}>
          {lane.running > 0 && <span>{lane.running} running</span>}
          {lane.awaiting > 0 && <span>{lane.awaiting} to approve</span>}
          {lane.resolved > 0 && <span>{lane.resolved} done</span>}
          {lane.turns > 0 && <span className={styles.mono}>{lane.turns} turns</span>}
          {lane.costUsd > 0 && <span className={styles.mono}>${lane.costUsd.toFixed(4)}</span>}
        </span>
        <span className={styles.chevron}>{open ? '▾' : '▸'}</span>
      </button>

      {!open && lane.latestLine && (
        <div className={styles.latest} title={lane.latestLine}>{lane.latestLine}</div>
      )}

      {open && (
        <div className={styles.laneBody}>
          {batchable > 0 && (
            <div className={styles.batchRow}>
              <button className={styles.batchBtn} onClick={approveReversible} data-testid="fleet-lane-approve-reversible">
                Keep {batchable} undoable change{batchable === 1 ? '' : 's'}
              </button>
              {sel.gatedExcluded > 0 && (
                <span className={styles.batchNote}>{sel.gatedExcluded} still need you</span>
              )}
            </div>
          )}

          {lane.hitl.map((h) => (
            <HitlCard key={`hitl-${h.sessionId}`} item={h} />
          ))}
          {lane.runs.map((run) => (
            <FeedCard key={run.runId} run={run} onOpenFile={onOpenFile} onWorkspaceChanged={onWorkspaceChanged} />
          ))}
        </div>
      )}
    </article>
  )
}
