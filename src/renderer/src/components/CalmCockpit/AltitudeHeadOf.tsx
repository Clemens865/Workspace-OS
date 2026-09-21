import { useCallback, useEffect, useState } from 'react'
import { buildFlow, type Flow } from './flowModel'
import type { WorkCase } from '../../types/workspace-api'
import styles from './Altitude.module.css'

/**
 * Head-of altitude — ONE area's work as a calm river.
 *
 * Horizontal stages, left to right, with the one that is waiting on the person
 * running warm and the rest receding. That shape came from the mock; the cases
 * in it are real, and the stages are the type's own vocabulary rather than four
 * invented headings, so this screen and the stage row on a card can never
 * disagree about what the steps are.
 *
 * Clicking a case flies DOWN to Team-lead with it open. Standing back is only
 * useful if the thing you spot is one move away.
 */
export function AltitudeHeadOf({
  onDrill,
  onOpenCase,
}: {
  /** Fly down a level. */
  onDrill?: () => void
  /** Fly down to a specific case. */
  onOpenCase?: (id: string) => void
}): JSX.Element {
  const [cases, setCases] = useState<WorkCase[] | null>(null)
  const [terminal, setTerminal] = useState<ReadonlySet<string> | null>(null)
  const [area, setArea] = useState<string | undefined>(undefined)
  const [flow, setFlow] = useState<Flow | null>(null)

  const refresh = useCallback(async () => {
    try {
      const list = (await window.workspace.cases.list()) ?? []
      setCases(list)
    } catch {
      setCases([])
    }
  }, [])

  useEffect(() => {
    void refresh()
    void window.workspace.cases
      .terminalStatuses()
      .then((t) => setTerminal(new Set(t ?? [])))
      .catch(() => setTerminal(new Set()))
  }, [refresh])

  // Cases are workspace-scoped — a root switch must swap this view too.
  useEffect(() => window.workspace.fs.onRootChanged(() => void refresh()), [refresh])

  /*
   * The stage vocabulary comes from the main process, not from a copy here.
   *
   * It is the same call the card's stage row makes. Duplicating the list would
   * work until a type gained a stage, and then this screen would silently drop
   * every case sitting in it.
   */
  useEffect(() => {
    if (!cases || !terminal) return
    let cancelled = false
    void (async () => {
      const first = buildFlow(cases, [], terminal, { area })
      const statuses = first.fn ? ((await window.workspace.cases.statuses(first.fn)) ?? []) : []
      if (!cancelled) setFlow(buildFlow(cases, statuses, terminal, { area }))
    })()
    return () => {
      cancelled = true
    }
  }, [cases, area, terminal])

  if (!flow) return <p className={styles.altStatus}>Reading the cases…</p>

  return (
    <>
      <p className={styles.altStatus}>{flow.status}</p>

      {flow.total === 0 ? (
        <p className={styles.flowEmpty}>
          Ask an agent for something worth keeping — a tailored application, a piece of
          research — and it opens a case here.
        </p>
      ) : (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            {flow.fn} · flow
            {/* Only when there is genuinely more than one area to be in. */}
            {flow.areas.length > 1 && (
              <span className={styles.areaSwitch}>
                {flow.areas.map((a) => (
                  <button
                    key={a}
                    className={`${styles.areaChip} ${a === flow.fn ? styles.areaChipOn : ''}`}
                    onClick={() => setArea(a)}
                  >
                    {a}
                  </button>
                ))}
              </span>
            )}
          </h2>

          <div className={styles.river}>
            {flow.stages.map((s, i) => (
              <div key={s.id} className={styles.stageWrap}>
                <div className={`${styles.stage} ${s.warm ? styles.stageWarm : ''}`}>
                  <div className={styles.stageHead}>
                    <span className={styles.stageTitle}>{s.title}</span>
                    <span className={styles.stageHint}>{s.hint}</span>
                  </div>
                  <div className={styles.stageItems}>
                    {s.items.map((it) => (
                      <button
                        key={it.id}
                        className={`${styles.flowItem} ${it.warm ? styles.flowItemWarm : ''}`}
                        onClick={() => (onOpenCase ? onOpenCase(it.id) : onDrill?.())}
                        title={it.note || it.label}
                      >
                        <span className={styles.flowLabel}>{it.label}</span>
                        {/* The reason, only when there is one. A subtitle on every
                            item is noise; on the one that needs you it is the point. */}
                        {it.why && <span className={styles.flowWho}>{it.why}</span>}
                      </button>
                    ))}
                  </div>
                </div>
                {i < flow.stages.length - 1 && (
                  <span className={styles.flowArrow} aria-hidden>
                    →
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
