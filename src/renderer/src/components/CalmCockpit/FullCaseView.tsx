import { useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Minimize2, X, FileText, Folder, Sparkles, Pencil, Check } from 'lucide-react'
import type { WorkCase, ArtifactInsight, CaseViewResult } from '../../types/workspace-api'
import { useCaseActions } from './useCaseActions'
import { CaseAgentActivity } from './CaseAgentActivity'
import { PromptBar } from '../PromptBar/PromptBar'
import { ApprovalCard } from '../ApprovalCard/ApprovalCard'
import styles from './FullCaseView.module.css'

/**
 * The case, full screen — a place you work, not a card you glance at.
 *
 * Header with a FREE-FORM stage tracker (whatever stages the case's type
 * defines — nothing is a fixed enum), tabs (Overview / Timeline / Artifacts),
 * and a right input rail that drives the exact same case actions as the cockpit
 * row (via useCaseActions). Portalled to <body> so it sits above the terminal
 * dock (the surfaces are isolated stacking contexts — a fixed modal rendered
 * inside one can't paint over the dock; the mail compose learned this).
 *
 * The generic data-visualisation panel (KPIs / chart / inline table computed
 * from the case's artifacts) is deliberately deferred — it's its own subsystem.
 */
export function FullCaseView({
  c,
  onClose,
  onChanged,
  onOpenFile,
}: {
  c: WorkCase
  onClose: () => void
  onChanged: () => void
  onOpenFile?: (path: string) => void
}): JSX.Element {
  const [tab, setTab] = useState<'over' | 'notes' | 'arts' | 'data'>('over')
  const a = useCaseActions(c, onChanged, true)

  // The case's own numbers, read from its CSV artifacts. Loaded once so the tab
  // can show a count; null = still reading, [] = nothing to show.
  const [data, setData] = useState<ArtifactInsight[] | null>(null)
  const [view, setView] = useState<CaseViewResult | null>(null)
  useEffect(() => {
    let live = true
    void window.workspace.cases.insights(c.id).then((d) => live && setData(d)).catch(() => live && setData([]))
    void window.workspace.cases.view(c.id).then((v) => live && setView(v)).catch(() => live && setView(null))
    return () => {
      live = false
    }
  }, [c.id])
  const hasData = !!view || (data?.length ?? 0) > 0

  // Open an artifact through the case's own root (works even when this case's
  // workspace isn't the active one), falling back to the raw path.
  const openArtifact = async (p: string): Promise<void> => {
    const abs = await window.workspace.cases.authorizeArtifact(c.id, p).catch(() => null)
    onOpenFile?.(abs ?? p)
  }

  // The stage tracker: the case's own status vocabulary, with the current one
  // marked "now" and everything before it "done". Terminal cases show all done.
  const stages = a.statuses.length ? a.statuses : [c.status]
  const curIx = Math.max(0, stages.indexOf(c.status))

  const notes = useMemo(() => [...c.notes].reverse(), [c.notes]) // newest first

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.win} onClick={(e) => e.stopPropagation()}>
        {/* titlebar */}
        <div className={styles.titlebar}>
          <span className={styles.tbTitle}>Case · {c.title}</span>
          <div className={styles.tbSpacer} />
          <button className={styles.tbIcon} onClick={onClose} title="Back to the cockpit"><Minimize2 size={15} /></button>
          <button className={styles.tbIcon} onClick={onClose} title="Close"><X size={16} /></button>
        </div>

        {/* header */}
        <div className={styles.chead}>
          <div className={styles.crow1}>
            <div style={{ flex: 1 }}>
              <div className={styles.ctitle}>{c.title}</div>
              {c.description && <div className={styles.cdesc}>{c.description}</div>}
            </div>
            <span className={styles.badge}><span className={styles.dot} /> {c.type}</span>
            {c.scope === 'global' && <span className={styles.badge}><span className={styles.dot} style={{ background: '#8a8a8e' }} /> Everywhere</span>}
          </div>
          {c.subject && (
            <a className={styles.subject} href={c.subject} onClick={(e) => e.preventDefault()} title={c.subject}>{c.subject}</a>
          )}

          {/* free-form stage tracker */}
          <div className={styles.stages}>
            {stages.map((s, i) => (
              <span key={s} style={{ display: 'contents' }}>
                {i > 0 && <span className={`${styles.bar} ${i <= curIx ? styles.barDone : ''}`} />}
                <span className={`${styles.stage} ${i < curIx ? styles.done : ''} ${i === curIx ? styles.now : ''}`}>
                  <span className={styles.num}>{i < curIx ? <Check size={14} /> : i + 1}</span>{s}
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* tabs */}
        <div className={styles.tabs}>
          <div className={`${styles.tab} ${tab === 'over' ? styles.tabOn : ''}`} onClick={() => setTab('over')}>Overview</div>
          <div className={`${styles.tab} ${tab === 'notes' ? styles.tabOn : ''}`} onClick={() => setTab('notes')}>Timeline<span className={styles.cnt}>{c.notes.length}</span></div>
          <div className={`${styles.tab} ${tab === 'arts' ? styles.tabOn : ''}`} onClick={() => setTab('arts')}>Artifacts<span className={styles.cnt}>{c.artifacts.length}</span></div>
          {hasData && (
            <div className={`${styles.tab} ${tab === 'data' ? styles.tabOn : ''}`} onClick={() => setTab('data')}>Data{data && data.length > 0 && <span className={styles.cnt}>{data.reduce((n, d) => n + d.rows, 0)}</span>}</div>
          )}
        </div>

        {/* body: main + rail */}
        <div className={styles.cbody}>
          <div className={styles.main}>
            {tab === 'over' && (
              <>
                {c.subject && <div className={styles.sectH}>About</div>}
                {c.subject && <p className={styles.about}>{c.description || c.subject}</p>}
                <div className={styles.sectH}>Latest</div>
                <div className={styles.tl}>
                  {notes.slice(0, 4).map((n, i) => (
                    <div key={i} className={`${styles.ev} ${styles['ev_' + n.author] ?? ''}`}>
                      <div className={styles.who}>{n.author}<span className={styles.dt}>{fmt(n.at)}</span></div>
                      <div className={styles.txt}>{n.text}</div>
                    </div>
                  ))}
                  {notes.length === 0 && <p className={styles.empty}>No notes yet — add one, or hand this case to an agent.</p>}
                </div>
              </>
            )}

            {tab === 'notes' && (
              <div className={styles.tl}>
                {notes.map((n, i) => (
                  <div key={i} className={`${styles.ev} ${styles['ev_' + n.author] ?? ''}`}>
                    <div className={styles.who}>{n.author}<span className={styles.dt}>{fmt(n.at)}</span></div>
                    <div className={styles.txt}>{n.text}</div>
                  </div>
                ))}
                {notes.length === 0 && <p className={styles.empty}>No notes yet.</p>}
                <div className={styles.noteIn}>
                  <input
                    className={styles.input}
                    value={a.note}
                    onChange={(e) => a.setNote(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void a.addNote()}
                    placeholder="What happened? e.g. invite with Maria Schmidt on Thursday"
                    disabled={a.busy}
                  />
                  <button className={styles.primary} onClick={() => void a.addNote()} disabled={a.busy || !a.note.trim()}>Note</button>
                </div>
              </div>
            )}

            {tab === 'arts' && (
              <div className={styles.gal}>
                {c.artifacts.map((p) => (
                  <button key={p} className={styles.art} onClick={() => void openArtifact(p)} title={p}>
                    <div className={styles.thumb}><ArtThumb path={p} /></div>
                    <div className={styles.artMeta}>
                      <div className={styles.nm}>{p.split('/').pop()}</div>
                      <div className={styles.ty}>{(p.split('.').pop() || 'file').toLowerCase()}</div>
                    </div>
                  </button>
                ))}
                {c.artifacts.length === 0 && <p className={styles.empty}>No files attached yet — an agent’s outputs land here.</p>}
              </div>
            )}

            {tab === 'data' && (
              <div className={styles.data}>
                {/* Curated view the case declares for itself (Layer 2). */}
                {view && (
                  <div className={styles.dcard}>
                    <div className={styles.sectH}>{view.title ?? 'Überblick'}</div>
                    {view.kpis.length > 0 && <Kpis kpis={view.kpis} />}
                    {view.chart && <Chart chart={view.chart} />}
                    {view.table && <Preview preview={view.table.preview} />}
                  </div>
                )}
                {/* Auto-derived per-file cards (Layer 1) — the always-on fallback. */}
                {data && data.length > 0 && (
                  <>
                    {view && <div className={styles.sectSub}>Aus den einzelnen Dateien</div>}
                    {data.map((d) => (
                      <div key={d.file} className={styles.dcard}>
                        <div className={styles.sectH}>{d.file}</div>
                        <Kpis kpis={d.kpis} />
                        {d.chart && <Chart chart={d.chart} />}
                        {d.preview.length > 1 && <Preview preview={d.preview} />}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* input rail — same actions as the cockpit row */}
          <div className={styles.rail}>
            <h4>Do</h4>
            <div className={styles.railPrompt}>
              <PromptBar compact popover="down" placeholder="Hand to an agent — @ file · # case" disabled={a.busy || a.agentBusy} onSubmit={(t, m, ids) => void a.runAsk(t, m, ids)} />
            </div>
            <CaseAgentActivity key={a.run?.runId} run={a.run} onOpenFile={onOpenFile} onContinue={a.continueRun} />
            <div className={styles.action} onClick={() => setTab('notes')}><Pencil size={15} className={styles.aIc} /> Add a note</div>

            {a.signals.length > 0 && <h4>Offers — from your notes</h4>}
            {a.signals.map((s, i) => (
              <button key={i} className={`${styles.action} ${styles.warm}`} disabled={a.busy || (s.kind !== 'schedule' && a.agentBusy)} onClick={() => void a.runOffer(s)}>
                <Sparkles size={15} className={styles.aIc} /> {s.label}
              </button>
            ))}

            {a.statuses.length > 1 && <h4>Move</h4>}
            <div className={styles.chips}>
              {a.statuses.map((s) => (
                <button key={s} className={`${styles.chip} ${s === c.status ? styles.chipOn : ''}`} onClick={() => void a.setStatus(s)} disabled={a.busy || s === c.status}>{s}</button>
              ))}
            </div>

            <h4>Lives in</h4>
            <div className={styles.chips}>
              <button className={`${styles.chip} ${(c.scope ?? 'workspace') === 'workspace' ? styles.chipOn : ''}`} onClick={() => void a.setScope('workspace')} disabled={a.busy || a.agentBusy || (c.scope ?? 'workspace') === 'workspace'}>this workspace</button>
              <button className={`${styles.chip} ${c.scope === 'global' ? styles.chipOn : ''}`} onClick={() => void a.setScope('global')} disabled={a.busy || a.agentBusy || c.scope === 'global'}>everywhere</button>
            </div>

            {a.error && <div className={styles.error}>{a.error}</div>}
          </div>
        </div>

        {a.pickCalendar && (
          <ApprovalCard
            question="Which calendar should this go in?"
            options={a.pickCalendar.options.map((t) => ({ id: t.id, label: t.label, hint: t.canInvite ? 'can invite people' : 'on this Mac only — no invitations' }))}
            busy={a.busy}
            onAnswer={({ optionId }) => { if (optionId) void a.schedule(a.pickCalendar!.signal, optionId) }}
            onDismiss={() => a.setPickCalendar(null)}
          />
        )}
      </div>
    </div>,
    document.body,
  )
}

/** The KPI grid — shared by the curated view and the auto-derived cards. */
function Kpis({ kpis }: { kpis: CaseViewResult['kpis'] }): JSX.Element {
  return (
    <div className={styles.kpis}>
      {kpis.map((k, i) => (
        <div key={i} className={styles.kpi}>
          <div className={styles.kpiLab}>{k.label}</div>
          <div className={`${styles.kpiVal} ${k.sign === 'neg' ? styles.neg : k.sign === 'pos' ? styles.pos : ''}`}>{k.value}</div>
        </div>
      ))}
    </div>
  )
}

/** The mini bar chart — one amount column grouped by a category. */
function Chart({ chart }: { chart: NonNullable<ArtifactInsight['chart']> }): JSX.Element {
  const max = Math.max(...chart.bars.map((b) => Math.abs(b.value)), 1)
  return (
    <>
      <div className={styles.sectSub}>{chart.valueColumn} nach {chart.byColumn}</div>
      <div className={styles.chart}>
        {chart.bars.map((b, i) => (
          <div key={i} className={styles.col}>
            <div className={styles.cv}>{b.text}</div>
            <div className={styles.bar} style={{ height: `${Math.max(2, (Math.abs(b.value) / max) * 100)}%`, ...(b.value < 0 ? { background: '#b4431a' } : {}) }} />
            <div className={styles.cl} title={b.label}>{b.label}</div>
          </div>
        ))}
      </div>
    </>
  )
}

/** A capped table preview of a CSV. */
function Preview({ preview }: { preview: string[][] }): JSX.Element {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr>{preview[0]?.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>
          {preview.slice(1).map((r, ri) => (
            <tr key={ri}>{r.map((cell, ci) => <td key={ci}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** An artifact thumbnail: a real image for image files, an icon otherwise. */
function ArtThumb({ path }: { path: string }): JSX.Element {
  const isImg = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(path)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!isImg) return
    let live = true
    void window.workspace.cases.artifactUrl(path).then((u) => live && setUrl(u)).catch(() => {})
    return () => {
      live = false
    }
  }, [path, isImg])
  if (path.endsWith('/')) return <Folder size={30} />
  if (isImg && url) return <img src={url} alt="" className={styles.thumbImg} />
  return <FileText size={30} />
}

/** A short, human date for a note timestamp (ISO → e.g. "24 Aug · 20:25"). */
function fmt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
