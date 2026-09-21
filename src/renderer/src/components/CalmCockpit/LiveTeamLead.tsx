import { useMemo, useState } from 'react'
import { NeedsYouCard } from './NeedsYouCard'
import { LivePresenceCell } from './LivePresenceCell'
import { LiveAgentZoom } from './LiveAgentZoom'
import { groupWorking, needsYouCategories, LENSES, type Lens, type CockpitData } from './cockpitModel'
import styles from './CalmCockpit.module.css'

interface Props {
  data: CockpitData
  onOpenFile?: (path: string) => void
  onWorkspaceChanged?: () => void
}

/**
 * The LIVE Team-lead altitude — the ONE center where real agent work converges.
 * Three zones, mapped from the shared reviewStore + live-activity store:
 *   NEEDS YOU (pending/error runs + HITL) — grouped by the categorical LABEL,
 *   WORKING (running runs) — breathing presence cells grouped by the active lens,
 *   LANDED (resolved runs with artifacts) — openable via the real office path.
 * Click a working agent to ZOOM into its real activity trail.
 */
export function LiveTeamLead({ data, onOpenFile, onWorkspaceChanged }: Props): JSX.Element {
  const [lens, setLens] = useState<Lens>('agent')
  const [zoomAgent, setZoomAgent] = useState<string | null>(null)
  const [landedOpen, setLandedOpen] = useState(false)

  const groups = useMemo(() => groupWorking(data.working, lens), [data.working, lens])
  const categories = useMemo(() => needsYouCategories(data.needsYou), [data.needsYou])

  if (zoomAgent) {
    return (
      <div className={styles.scroll}>
        <LiveAgentZoom
          agentId={zoomAgent}
          onBack={() => setZoomAgent(null)}
          onOpenFile={onOpenFile}
        />
      </div>
    )
  }

  const landedShown = landedOpen ? data.landed : data.landed.slice(0, 4)
  const landedMore = data.landed.length - landedShown.length

  return (
    <>
      <p className={styles.status}>{data.status}</p>

      <div className={styles.scroll}>
        {/* ── ● NEEDS YOU — the only warm zone, grouped by label category ── */}
        <section className={styles.zone}>
          <h2 className={`${styles.zoneTitle} ${styles.needsTitle}`}>
            <span className={styles.needsDot} /> Needs you
          </h2>
          {data.needsYou.length === 0 ? (
            <p className={styles.cleared}>All clear — nothing needs you right now.</p>
          ) : (
            categories.map((cat) => {
              const items = data.needsYou.filter((i) => i.label.category === cat)
              return (
                <div key={cat} className={styles.needsGroup}>
                  {items.map((item) => (
                    <NeedsYouCard
                      key={item.id}
                      item={item}
                      onOpenFile={onOpenFile}
                      onWorkspaceChanged={onWorkspaceChanged}
                    />
                  ))}
                </div>
              )
            })
          )}
        </section>

        {/* ── ◦ WORKING — recessed band of live presence cells ── */}
        <section className={styles.zone}>
          <h2 className={styles.zoneTitle}>
            <span className={styles.workingMark}>◦</span> Working
            {data.working.length > 0 && (
              <span className={styles.count}>
                {data.working.length} in flight · grouped by{' '}
                <select
                  className={styles.lensInline}
                  value={lens}
                  onChange={(e) => setLens(e.target.value as Lens)}
                  aria-label="Group working by"
                >
                  {LENSES.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </span>
            )}
          </h2>
          {data.working.length === 0 ? (
            <p className={styles.cleared}>
              All calm — no agents are running. Start one from the terminal (⌘J)
              and it&rsquo;ll appear here.
            </p>
          ) : (
            <div className={styles.working}>
              {groups.map(([label, cells]) => (
                <div key={label} className={styles.groupCol}>
                  <div className={styles.groupLabel}>{label}</div>
                  <div className={styles.cells}>
                    {cells.map((c) => (
                      <button
                        key={c.runId}
                        className={styles.cellButton}
                        onClick={() => setZoomAgent(c.agentId)}
                        title={`Zoom into ${c.who}`}
                      >
                        <LivePresenceCell cell={c} />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── ✓ LANDED — settled results, openable via the real office path ── */}
        {data.landed.length > 0 && (
          <section className={styles.zone}>
            <h2 className={styles.zoneTitle}>
              <span className={styles.landedMark}>✓</span> Landed
            </h2>
            <div className={styles.landed}>
              {landedShown.map((l) => (
                <div key={l.id} className={styles.result}>
                  <span className={styles.kind}>▤</span>
                  <span className={styles.resultLine}>{l.line}</span>
                  {l.moreCount > 0 && <span className={styles.resultMore}>+{l.moreCount} more</span>}
                  {l.openPath && (
                    <button className={styles.open} onClick={() => onOpenFile?.(l.openPath!)}>
                      → open
                    </button>
                  )}
                </div>
              ))}
              {landedMore > 0 && (
                <button className={styles.settled} onClick={() => setLandedOpen(true)}>
                  …{landedMore} more, settled
                </button>
              )}
              {landedOpen && data.landed.length > 4 && (
                <button className={styles.settled} onClick={() => setLandedOpen(false)}>
                  Hide settled
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </>
  )
}
