import { useSyncExternalStore } from 'react'
import { useReviewStore } from '../Review/useReviewStore'
import { activityStore } from '../Review/activityStore'
import { laneKey } from '../Review/reviewModel'
import { elapsed } from './cockpitModel'
import styles from './Altitude.module.css'
import { ArtifactThumb } from './ArtifactThumb'

interface Props {
  agentId: string
  onBack: () => void
  onOpenFile?: (path: string) => void
}

/**
 * LIVE agent zoom — the deepest altitude, one agent, all REAL data. It reads the
 * agent's runs from the reviewStore and the newest run's activity trail from the
 * activityStore: the recent steps it actually took, its real turns + cost, and
 * the artifact taking shape (a real path → open in the Canvas). No confidence
 * bar (claude -p emits none) — elapsed replaces it as the honest live read.
 */
export function LiveAgentZoom({ agentId, onBack, onOpenFile }: Props): JSX.Element {
  const { runs } = useReviewStore()
  const trails = useSyncExternalStore(
    activityStore.subscribe,
    () => activityStore.getSnapshot().trails,
    () => activityStore.getSnapshot().trails,
  )

  const laneRuns = runs
    .filter((r) => laneKey(r) === agentId)
    .sort((a, b) => b.createdAt - a.createdAt)
  const newest = laneRuns[0]
  const name = newest?.agentName || newest?.sessionName || 'Agent'
  const running = laneRuns.some((r) => r.status === 'running')

  const totals = laneRuns.reduce(
    (acc, r) => ({ turns: acc.turns + r.turns, cost: acc.cost + r.costUsd }),
    { turns: 0, cost: 0 },
  )
  const trail = newest ? trails.get(newest.runId) ?? [] : []
  const artifact = laneRuns.flatMap((r) => r.artifacts)[0] ?? null
  const live = newest ? activityStore.get(newest.runId)?.label : null

  // No run for this lane → a calm, human empty line, never a broken/blank look.
  if (!newest) {
    return (
      <p className={styles.altStatus}>
        <button className={styles.zoomBack} onClick={onBack}>← team</button> All calm —
        no agents are running. Start one from the terminal (⌘J) and it&rsquo;ll appear here.
      </p>
    )
  }

  return (
    <>
      <p className={styles.altStatus}>
        <button className={styles.zoomBack} onClick={onBack}>← team</button> Zoomed into{' '}
        <strong>{name}</strong>.{' '}
        {running ? (live || 'working…') : 'idle — its last run has settled.'}
      </p>

      <section className={styles.agentGrid}>
        {/* Left — the REAL activity trail (recent tool_use steps). */}
        <div className={styles.agentCol}>
          <h2 className={styles.sectionTitle}>Activity trail</h2>
          {trail.length === 0 ? (
            <p className={styles.altStatus}>No activity captured yet for this run.</p>
          ) : (
            <ol className={styles.trail}>
              {trail.map((t, i) => {
                const isLive = running && i === trail.length - 1
                return (
                  <li key={`${t.at}-${i}`} className={`${styles.step} ${isLive ? styles.stepLive : styles.stepDone}`}>
                    <span className={styles.stepMark} aria-hidden>{isLive ? '◦' : '✓'}</span>
                    <span className={styles.stepLine}>{t.label}</span>
                  </li>
                )
              })}
            </ol>
          )}

          <div className={styles.reads}>
            <div className={styles.readRow}>
              {running && newest && (
                <span className={styles.read}>
                  <span className={styles.readLabel}>Elapsed</span>
                  <span className={styles.readBig}>{elapsed(newest.createdAt)}</span>
                </span>
              )}
              <span className={styles.read}>
                <span className={styles.readLabel}>Turns</span>
                <span className={styles.readBig}>{totals.turns}</span>
              </span>
              <span className={styles.read}>
                <span className={styles.readLabel}>Cost so far</span>
                <span className={styles.readBig}>${totals.cost.toFixed(2)}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Right — the artifact taking shape (a real openable path). */}
        <div className={styles.agentCol}>
          <h2 className={styles.sectionTitle}>Taking shape</h2>
          {artifact ? (
            <div className={styles.artifact}>
              <ArtifactThumb path={artifact.path} name={artifact.name} />
              <div className={styles.artifactMeta}>
                <span className={styles.artifactLabel}>{artifact.name}</span>
                <button className={styles.artifactOpen} onClick={() => onOpenFile?.(artifact.path)}>
                  → open
                </button>
              </div>
            </div>
          ) : (
            <p className={styles.altStatus}>No artifact yet — nothing has landed for this agent.</p>
          )}
        </div>
      </section>
    </>
  )
}
