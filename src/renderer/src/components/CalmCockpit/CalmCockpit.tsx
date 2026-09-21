import { useMemo, useRef, useState } from 'react'
import { ALTITUDES, LENSES, MOCK } from './mock'
import type { Altitude, CockpitData, Lens, Presence } from './mock'
import { DecisionItem } from './DecisionItem'
import { PresenceCell } from './PresenceCell'
import { AltitudeCEO } from './AltitudeCEO'
import { AltitudeHeadOf } from './AltitudeHeadOf'
import { AltitudeAgent } from './AltitudeAgent'
import { LiveTeamLead } from './LiveTeamLead'
import { CasesBand } from './CasesBand'
import { LiveAgentZoom } from './LiveAgentZoom'
import { useCockpitData } from './useCockpitData'
import { StreamView } from './StreamView'
import { MapView } from './MapView'
import styles from './CalmCockpit.module.css'

/** The altitudes that are LIVE-wired; the rest are the mock "future" vision. */
const LIVE_ALTITUDES: ReadonlySet<Altitude> = new Set<Altitude>(['Head-of', 'Team-lead', 'Agent'])

/**
 * The three views answer three questions on the SAME data. Home: what needs
 * me now. Stream: what happened, in order. Map: how it all connects. The
 * altitude control is orthogonal — it is how far out you stand on Home.
 */
type CockpitView = 'home' | 'stream' | 'map'
const VIEWS: { id: CockpitView; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'stream', label: 'Stream' },
  { id: 'map', label: 'Map' },
]

interface CalmCockpitProps {
  /** Preview only — mock data for the design prototype (`?cockpit=field`). */
  items?: CockpitData
  /**
   * LIVE mode — the Team-lead altitude reads real agent runs from the review +
   * activity stores. CEO/Head-of/Agent stay the mock "future" vision views.
   */
  live?: boolean
  /** Opens an artifact in the Canvas (the real office.openFile path). */
  onOpenFile?: (path: string) => void
  /** Called after a revert so the host can refresh the workspace view. */
  onWorkspaceChanged?: () => void
}

/**
 * HOME — the Calm Cockpit. A vertical, document-like surface for a human
 * directing an AI team. NOT columns, NOT a Kanban. Three zones stacked by
 * WEIGHT: a warm/forward NEEDS-YOU band, a pale/recessed WORKING band of
 * breathing presence cells, and a settled LANDED band. The blend = language
 * leads, life is felt.
 *
 * The Team-lead altitude is LIVE when `live` — the ONE center where real agent
 * work converges. The other altitudes remain the mock vision story.
 */
export function CalmCockpit({
  items = MOCK,
  live = false,
  onOpenFile,
  onWorkspaceChanged,
}: CalmCockpitProps): JSX.Element {
  const [view, setView] = useState<CockpitView>('home')
  const [lens, setLens] = useState<Lens>('team')
  const [altitude, setAltitude] = useState<Altitude>('Team-lead')
  // Resolved decisions VANISH from the needs-you band.
  const [resolved, setResolved] = useState<Set<string>>(new Set())
  const [landedOpen, setLandedOpen] = useState(false)
  /**
   * A case spotted from above, to open on landing.
   *
   * Standing back only pays if the thing you notice is one move away —
   * otherwise the flow view is a picture you then have to go and find your way
   * back into by hand.
   */
  const [focusCase, setFocusCase] = useState<string | null>(null)
  // Live cockpit read — subscribed always (hooks rule); used only when `live`.
  const liveData = useCockpitData()
  // The agent to ZOOM into at the live Agent altitude: prefer a running agent,
  // else the newest thing needing you. Null → calm empty state (never mock).
  const liveAgentId =
    liveData.working[0]?.agentId ?? liveData.needsYou[0]?.agentId ?? null

  // FLYING: on each altitude change, replay the enter animation. Direction
  // decides the zoom: UP (toward CEO) zooms OUT, DOWN (toward Agent) zooms IN.
  const [flyKey, setFlyKey] = useState(0)
  const [dir, setDir] = useState<'up' | 'down'>('down')
  const prevIdx = useRef(ALTITUDES.indexOf('Team-lead'))

  function flyTo(a: Altitude): void {
    const next = ALTITUDES.indexOf(a)
    if (next === prevIdx.current) return
    // ALTITUDES is [CEO, Head-of, Team-lead, Agent] — lower index = higher up.
    setDir(next < prevIdx.current ? 'up' : 'down')
    prevIdx.current = next
    setAltitude(a)
    setFlyKey((k) => k + 1)
  }

  /** A case spotted in Stream or Map opens on Home, one move away. */
  function openCaseOnHome(id: string): void {
    setFocusCase(id)
    setView('home')
    flyTo('Team-lead')
  }

  const decisions = items.decisions.filter((d) => !resolved.has(d.id))

  // The PRISM: the SAME working items re-group live by the active lens.
  const groups = useMemo(() => groupBy(items.working, lens), [items.working, lens])

  return (
    <div className={`wos ${styles.root}`} data-testid="calm-cockpit">
      {/* ── Quiet header: views · lens · altitude · search ── */}
      <header className={styles.header}>
        <nav className={styles.views} aria-label="View">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={`${styles.view} ${v.id === view ? styles.viewOn : ''}`}
              onClick={() => setView(v.id)}
              aria-current={v.id === view ? 'page' : undefined}
              data-testid={`cockpit-view-${v.id}`}
            >
              {v.label}
            </button>
          ))}
        </nav>

        {/* Lens and altitude are Home's controls — Stream and Map carry their own. */}
        {view === 'home' && (
        <div className={styles.controls}>
          {/* Lens / Prism — actually re-groups the bands below. */}
          <label className={styles.selectWrap} title="Group everything by…">
            <span className={styles.selectIcon}>◇</span>
            <select
              className={styles.select}
              value={lens}
              onChange={(e) => setLens(e.target.value as Lens)}
              aria-label="Lens"
            >
              {LENSES.map((l) => (
                <option key={l} value={l}>
                  by {l}
                </option>
              ))}
            </select>
          </label>

          {/* Altitude — click to FLY the whole surface to that view. In LIVE
              mode, the vision-only altitudes wear a quiet "Preview" pill so their
              mock data is never mistaken for real. */}
          <div className={styles.altitude} role="group" aria-label="Altitude">
            {ALTITUDES.map((a) => {
              const preview = live && !LIVE_ALTITUDES.has(a)
              return (
                <button
                  key={a}
                  className={`${styles.alt} ${a === altitude ? styles.altOn : ''}`}
                  onClick={() => flyTo(a)}
                  title={
                    preview
                      ? `Fly to ${a} · vision preview, not wired to live data`
                      : a === altitude
                        ? 'You are here'
                        : `Fly to ${a}`
                  }
                >
                  {a}
                  {preview && <span className={styles.previewPill}>Preview</span>}
                </button>
              )
            })}
          </div>

          <button className={styles.search} aria-label="Search">
            ⌕
          </button>
        </div>
        )}
      </header>

      {/* ── STREAM: history. ── */}
      {view === 'stream' && (
        <div className={styles.scroll}>
          <StreamView onOpenFile={onOpenFile} onOpenCase={openCaseOnHome} />
        </div>
      )}

      {/* ── MAP: structure. ── */}
      {view === 'map' && (
        <div className={styles.scroll}>
          <MapView onOpenFile={onOpenFile} onOpenCase={openCaseOnHome} />
        </div>
      )}

      {/* ── HOME — the FLYING surface: a keyed wrapper replays the enter animation on
           every altitude change; data-dir tells the keyframe which way to zoom. ── */}
      {view === 'home' && (
      <div
        key={flyKey}
        className={styles.fly}
        data-dir={dir}
        data-testid={`altitude-${altitude}`}
      >
        {altitude === 'CEO' && (
          <div className={styles.scroll}>
            {live && <PreviewBanner />}
            <AltitudeCEO onDrill={() => flyTo('Head-of')} />
          </div>
        )}
        {altitude === 'Head-of' && (
          <div className={styles.scroll}>
            <AltitudeHeadOf
              onDrill={() => flyTo('Team-lead')}
              onOpenCase={(id) => {
                setFocusCase(id)
                flyTo('Team-lead')
              }}
            />
          </div>
        )}
        {/* Agent altitude: LIVE zoom into a real agent when live; mock otherwise. */}
        {altitude === 'Agent' && live && (
          <div className={styles.scroll}>
            {liveAgentId ? (
              <LiveAgentZoom
                agentId={liveAgentId}
                onBack={() => flyTo('Team-lead')}
                onOpenFile={onOpenFile}
              />
            ) : (
              <p className={styles.cleared}>
                All calm — no agents are running. Start one from the terminal (⌘J)
                and it&rsquo;ll appear here.
              </p>
            )}
          </div>
        )}
        {altitude === 'Agent' && !live && (
          <div className={styles.scroll}>
            <AltitudeAgent />
          </div>
        )}
        {altitude === 'Team-lead' && live && (
          <div className={styles.scroll}>
            {/*
              Cases first, and above the run zones on purpose.
              A run is something the machine did; a case is something the PERSON
              is pursuing. When both are on screen the pursuit is the one worth
              reading first — it is the question the cockpit is asked.
            */}
            <CasesBand onOpenFile={onOpenFile} focusId={focusCase} />
            <LiveTeamLead
              data={liveData}
              onOpenFile={onOpenFile}
              onWorkspaceChanged={onWorkspaceChanged}
            />
          </div>
        )}
        {altitude === 'Team-lead' && !live && (
          <>
            {/* ── One plain-language status line ── */}
            <p className={styles.status}>{items.status}</p>

            <div className={styles.scroll}>
              {/* ── ● NEEDS YOU — the only warm, forward zone ── */}
              <section className={styles.zone}>
          <h2 className={`${styles.zoneTitle} ${styles.needsTitle}`}>
            <span className={styles.needsDot} /> Needs you
          </h2>
          {decisions.length === 0 ? (
            <p className={styles.cleared}>All clear — nothing needs you right now.</p>
          ) : (
            <div className={styles.decisions}>
              {decisions.slice(0, 3).map((d) => (
                <DecisionItem
                  key={d.id}
                  d={d}
                  onResolve={(id) => setResolved((s) => new Set(s).add(id))}
                />
              ))}
              {decisions.length > 3 && (
                <button className={styles.moreDecisions}>
                  ＋{decisions.length - 3} more decisions
                </button>
              )}
            </div>
          )}
        </section>

        {/* ── ◦ WORKING — faint, recessed band of breathing presence cells ── */}
        <section className={styles.zone}>
          <h2 className={styles.zoneTitle}>
            <span className={styles.workingMark}>◦</span> Working
            <span className={styles.count}>{items.working.length} in flight · grouped by {lens}</span>
          </h2>
          <div className={styles.working}>
            {groups.map(([label, cells]) => (
              <div key={label} className={styles.groupCol}>
                <div className={styles.groupLabel}>{label}</div>
                <div className={styles.cells}>
                  {cells.map((p) => (
                    <PresenceCell key={p.id} p={p} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── ✓ LANDED — settled, quiet results ── */}
        <section className={styles.zone}>
          <h2 className={styles.zoneTitle}>
            <span className={styles.landedMark}>✓</span> Landed
          </h2>
          <div className={styles.landed}>
            {items.landed.map((l) => (
              <div key={l.id} className={styles.result}>
                <span className={styles.kind}>{kindGlyph(l.kind)}</span>
                <span className={styles.resultLine}>{l.line}</span>
                <button className={styles.open}>→ open</button>
              </div>
            ))}
            {landedOpen &&
              Array.from({ length: items.landedMore }).map((_, i) => (
                <div key={`more-${i}`} className={styles.result}>
                  <span className={styles.kind}>•</span>
                  <span className={styles.resultLine}>Earlier result, settled.</span>
                  <button className={styles.open}>→ open</button>
                </div>
              ))}
            <button className={styles.settled} onClick={() => setLandedOpen((o) => !o)}>
              {landedOpen ? 'Hide settled' : `…${items.landedMore} more, settled`}
            </button>
          </div>
        </section>
            </div>
          </>
        )}
      </div>
      )}
    </div>
  )
}

/** A quiet one-line banner atop the vision-only altitudes in LIVE mode, so the
 * mock data below is never mistaken for real. Hairline, --wos-ink-3, no blue. */
function PreviewBanner(): JSX.Element {
  return (
    <p className={styles.previewBanner} role="note">
      Vision preview — not wired to live data yet.
    </p>
  )
}

/** Group presence cells by the active lens — the Prism's actual work. */
function groupBy(items: Presence[], lens: Lens): [string, Presence[]][] {
  const map = new Map<string, Presence[]>()
  for (const p of items) {
    const key = p.group[lens]
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(p)
  }
  return [...map.entries()]
}

function kindGlyph(kind: string): string {
  switch (kind) {
    case 'deck':
      return '◧'
    case 'xlsx':
      return '▦'
    case 'docx':
      return '▤'
    case 'email':
      return '✉'
    default:
      return '•'
  }
}
