import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useReviewStore } from '../Review/useReviewStore'
import { StatusPill, caseTone } from '../ui/StatusPill'
import type { Metric, TransclusionLink, WorkCase } from '../../types/workspace-api'
import { NEEDS_YOU } from './CasesBand'
import { buildMap, fileGlyph, type MapFile, type MapModel } from './mapModel'
import styles from './MapView.module.css'

interface Raw {
  root: string | null
  cases: WorkCase[]
  metrics: Metric[]
  links: TransclusionLink[]
  terminal: string[]
}

interface Curve {
  id: string
  d: string
  stale: boolean
}

/**
 * MAP — how the work connects.
 *
 * Cases are territories holding their documents; what agents made outside a
 * case sits loose beside them; live links are drawn between documents. Every
 * edge comes from disk (see mapModel). The curves are drawn AFTER layout from
 * where the chips actually landed, so the picture never disagrees with the grid.
 */
export function MapView({
  onOpenFile,
  onOpenCase,
}: {
  onOpenFile?: (path: string) => void
  /** Jump to a case on Home. */
  onOpenCase?: (id: string) => void
}): JSX.Element {
  const [raw, setRaw] = useState<Raw | null>(null)
  const { runs } = useReviewStore()

  const refresh = useCallback(async () => {
    const [root, cases, metrics, links, terminal] = await Promise.all([
      window.workspace.fs.getWorkspaceRoot().catch(() => null),
      window.workspace.cases.list().catch(() => [] as WorkCase[]),
      window.workspace.metrics.list().catch(() => [] as Metric[]),
      window.workspace.transclusions.allLinks().catch(() => [] as TransclusionLink[]),
      window.workspace.cases.terminalStatuses().catch(() => [] as string[]),
    ])
    setRaw({ root, cases: cases ?? [], metrics: metrics ?? [], links: links ?? [], terminal: terminal ?? [] })
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])
  useEffect(() => window.workspace.fs.onRootChanged(() => void refresh()), [refresh])

  const model: MapModel | null = useMemo(
    () =>
      raw &&
      buildMap({
        root: raw.root,
        cases: raw.cases,
        runs: runs.map((r) => ({ agentName: r.agentName, sessionName: r.sessionName, artifacts: r.artifacts })),
        metrics: raw.metrics,
        links: raw.links,
        waiting: NEEDS_YOU,
        terminal: new Set(raw.terminal),
      }),
    [raw, runs],
  )

  // ── Link curves, measured from the rendered chips ──
  const fieldRef = useRef<HTMLDivElement>(null)
  const [curves, setCurves] = useState<Curve[]>([])
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })

  const measure = useCallback(() => {
    const field = fieldRef.current
    if (!field || !model) return
    const fr = field.getBoundingClientRect()
    const center = (el: Element | null): { x: number; y: number } | null => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left - fr.left + r.width / 2, y: r.top - fr.top + r.height / 2 }
    }
    const next: Curve[] = []
    for (const l of model.links) {
      const to = center(field.querySelector(`[data-fk="${cssEscape(l.to)}"]`))
      const from = center(
        (l.from && field.querySelector(`[data-fk="${cssEscape(l.from)}"]`)) || field.querySelector(`[data-mk="${cssEscape(l.metricId)}"]`),
      )
      if (!to || !from) continue
      const my = (from.y + to.y) / 2
      next.push({ id: l.id, d: `M ${from.x} ${from.y} C ${from.x} ${my}, ${to.x} ${my}, ${to.x} ${to.y}`, stale: l.stale })
    }
    setCurves(next)
    setSize({ w: field.scrollWidth, h: field.scrollHeight })
  }, [model])

  useLayoutEffect(() => {
    measure()
    const field = fieldRef.current
    if (!field || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure())
    ro.observe(field)
    return () => ro.disconnect()
  }, [measure])

  const openFile = async (f: MapFile, caseId: string | null): Promise<void> => {
    if (f.abs) return onOpenFile?.(f.abs)
    // A case artifact is relative to the case's own root — let the case resolve it.
    const abs = caseId ? await window.workspace.cases.authorizeArtifact(caseId, f.key).catch(() => null) : null
    onOpenFile?.(abs ?? f.key)
  }

  if (!model) return <p className={styles.status}>Reading the workspace…</p>

  const chip = (f: MapFile, caseId: string | null): JSX.Element => (
    <button
      key={f.key}
      className={`${styles.chip} ${f.warm ? styles.chipWarm : ''}`}
      data-fk={f.key}
      onClick={() => void openFile(f, caseId)}
      title={f.warm ? `${f.key} — a live value here is out of step` : f.key}
    >
      <span className={styles.chipGlyph} aria-hidden>
        {fileGlyph(f.kind)}
      </span>
      <span className={styles.chipName}>{f.name}</span>
      {f.agents.length > 0 && <span className={styles.chipBy}>by {f.agents.join(', ')}</span>}
    </button>
  )

  const empty = model.territories.length === 0 && model.loose.length === 0

  return (
    <div className={styles.root} data-testid="cockpit-map">
      <p className={styles.status}>{model.status}</p>

      {empty ? (
        <p className={styles.empty}>
          The map draws itself from what exists: a case and its documents, the agent that made them, the live
          links between them. Open a case or ask an agent for something and it appears here.
        </p>
      ) : (
        <div className={styles.field} ref={fieldRef}>
          {/* The curves live under the chips and follow them on every resize. */}
          <svg className={styles.wires} width={size.w} height={size.h} aria-hidden>
            {curves.map((c) => (
              <path key={c.id} d={c.d} className={c.stale ? styles.wireStale : styles.wire} />
            ))}
          </svg>

          <div className={styles.territories}>
            {model.territories.map((t) => (
              <section
                key={t.id}
                className={`${styles.territory} ${t.warm ? styles.territoryWarm : ''} ${t.settled ? styles.territorySettled : ''}`}
                data-testid="map-territory"
              >
                <header className={styles.tHead}>
                  <button className={styles.tTitle} onClick={() => onOpenCase?.(t.id)} title="Open the case on Home">
                    {t.title}
                  </button>
                  <StatusPill tone={caseTone(t.status, t.warm)}>{t.status}</StatusPill>
                </header>
                {t.files.length === 0 ? (
                  <p className={styles.tNone}>No documents yet.</p>
                ) : (
                  <div className={styles.chips}>{t.files.map((f) => chip(f, t.id))}</div>
                )}
              </section>
            ))}

            {model.loose.length > 0 && (
              <section className={`${styles.territory} ${styles.territoryLoose}`} data-testid="map-loose">
                <header className={styles.tHead}>
                  <span className={styles.tTitleQuiet}>Not in a case yet</span>
                </header>
                <div className={styles.chips}>{model.loose.map((f) => chip(f, null))}</div>
              </section>
            )}
          </div>

          {model.metrics.length > 0 && (
            <section className={styles.sources}>
              <h2 className={styles.sourcesTitle}>Live values</h2>
              <div className={styles.metricRow}>
                {model.metrics.map((m) => (
                  <div
                    key={m.id}
                    className={`${styles.metric} ${m.stale > 0 ? styles.metricStale : ''}`}
                    data-mk={m.id}
                    title={m.sourceKey ? `Read from ${m.sourceKey}` : 'Typed by hand'}
                  >
                    <span className={styles.metricName}>{m.name}</span>
                    <span className={styles.metricValue}>{formatValue(m.value)}</span>
                    <span className={styles.metricMeta}>
                      {m.links === 0 ? 'not linked' : `in ${m.links} place${m.links === 1 ? '' : 's'}`}
                      {m.stale > 0 && ` · ${m.stale} out of step`}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function formatValue(v: number): string {
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

/** Attribute-selector escaping for paths (quotes, backslashes). */
function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&')
}
