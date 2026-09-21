import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Plus, ChevronRight, Sparkles, FolderPlus, Maximize2 } from 'lucide-react'
import type { WorkCase } from '../../types/workspace-api'
import { useCaseActions } from './useCaseActions'
import { CaseAgentActivity } from './CaseAgentActivity'
import { PromptBar } from '../PromptBar/PromptBar'
import { ApprovalCard } from '../ApprovalCard/ApprovalCard'
import { NewCaseDialog } from './NewCaseDialog'
import { FullCaseView } from './FullCaseView'
import { StatusPill, caseTone } from '../ui/StatusPill'
import styles from './CasesBand.module.css'

/**
 * The cockpit's open cases.
 *
 * The cockpit showed agent ACTIVITY, and activity is not a thing anyone wants
 * to know about — nobody wakes up asking which agent ran at 14:02. They ask
 * where their five applications stand and which one needs them today. A case
 * answers that; a run does not. This band is the cockpit finally pointing at
 * the right noun.
 *
 * It is not a Kanban board and must never become one. A board is a thing you
 * MAINTAIN — you drag cards, and it rots the week you stop. Here a status
 * changes because something really happened: a document was produced, an
 * interview was booked. The band is a view of that, never the source. If it
 * ever needs grooming to stay true, it has failed and should be deleted.
 */

export const NEEDS_YOU = new Set(['drafted', 'interview', 'offer'])

export function CasesBand({
  onOpenFile,
  focusId,
}: {
  onOpenFile?: (path: string) => void
  /** Open this case — set when one was picked from a higher altitude. */
  focusId?: string | null
}): JSX.Element | null {
  const [cases, setCases] = useState<WorkCase[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // Arriving from above with a case in mind: open it, but never fight the
  // person for what is expanded afterwards.
  useEffect(() => {
    if (focusId) setOpenId(focusId)
  }, [focusId])

  const refresh = useCallback(async () => {
    try {
      setCases((await window.workspace.cases.list()) ?? [])
    } catch {
      setCases([])
    }
  }, [])

  /**
   * Re-read whenever this band becomes VISIBLE.
   *
   * The shell mounts every surface once and hides the inactive ones, so a fetch
   * on mount runs at app start — before any case exists — and would never run
   * again. The band then stays empty forever while the file sits on disk, which
   * is exactly how this first shipped and why it is worth a comment: the API
   * was right, the data was right, and the screen was blank.
   *
   * An IntersectionObserver rather than a poll: it fires when the surface is
   * actually shown, costs nothing while hidden, and does not care HOW the shell
   * hides things.
   */
  const hostRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    void refresh()
    const el = hostRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void refresh()
    })
    io.observe(el)
    return () => io.disconnect()
  }, [refresh])

  // Cases are workspace-scoped — a root switch must swap the band's contents.
  useEffect(() => window.workspace.fs.onRootChanged(() => void refresh()), [refresh])

  // Waiting on YOU first — that is the question the cockpit exists to answer.
  const ordered = [...cases].sort((a, b) => {
    const an = NEEDS_YOU.has(a.status) ? 0 : 1
    const bn = NEEDS_YOU.has(b.status) ? 0 : 1
    return an !== bn ? an - bn : a.updated < b.updated ? 1 : -1
  })

  const onCreated = useCallback((c: WorkCase) => {
    setCreating(false)
    void refresh()
    setOpenId(c.id) // open the just-started case
  }, [refresh])

  return (
    <section className={styles.band} aria-label="Open cases" ref={hostRef}>
      {/* Header is ALWAYS present now — it carries the "New case" button, so a
          person can start a thread of their own work (cases used to be born only
          from an agent hand-off, leaving no manual entry point at all). */}
      <div className={styles.bandHead}>
        <h2 className={styles.heading}>{cases.length > 0 ? 'Open cases' : 'Cases'}</h2>
        <button className={styles.newCase} onClick={() => setCreating(true)}>
          <FolderPlus size={13} /> New case
        </button>
      </div>

      {cases.length === 0 && (
        <button className={styles.emptyStart} onClick={() => setCreating(true)}>
          <FolderPlus size={15} /> Start a case to track a thread of work — an application, a project, your tax year.
        </button>
      )}

      <div className={styles.list}>
        {ordered.map((c) => (
          <CaseRow
            key={c.id}
            c={c}
            expanded={openId === c.id}
            onToggle={() => setOpenId(openId === c.id ? null : c.id)}
            onChanged={refresh}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>

      {creating && <NewCaseDialog onClose={() => setCreating(false)} onCreated={onCreated} />}
    </section>
  )
}

function CaseRow({
  c,
  expanded,
  onToggle,
  onChanged,
  onOpenFile,
}: {
  c: WorkCase
  expanded: boolean
  onToggle: () => void
  onChanged: () => void
  onOpenFile?: (path: string) => void
}): JSX.Element {
  const [full, setFull] = useState(false)
  const {
    note, setNote, pickCalendar, setPickCalendar, signals, statuses, busy, error,
    addNote, setStatus, setScope, schedule, runOffer, runAsk, run, agentBusy, continueRun,
  } = useCaseActions(c, onChanged, expanded)

  // Open an artifact via the case's own root — works across workspaces.
  const openArtifact = async (a: string): Promise<void> => {
    const abs = await window.workspace.cases.authorizeArtifact(c.id, a).catch(() => null)
    onOpenFile?.(abs ?? a)
  }

  const last = c.notes[c.notes.length - 1]

  return (
    <div className={`${styles.row} ${expanded ? styles.rowOpen : ''}`}>
      <div className={styles.headWrap}>
        <button className={styles.head} onClick={onToggle} aria-expanded={expanded}>
          <ChevronRight size={14} className={`${styles.chev} ${expanded ? styles.chevOpen : ''}`} />
          <span className={styles.title}>{c.title}</span>
          <StatusPill tone={caseTone(c.status, NEEDS_YOU.has(c.status))}>{c.status}</StatusPill>
          {agentBusy && <span className={styles.scopeTag}>{run?.requests.length ? 'Agent needs you' : 'Agent running'}</span>}
          {/* A life thread, visible from every workspace — worth saying quietly. */}
          {c.scope === 'global' && <span className={styles.scopeTag}>everywhere</span>}
          {c.artifacts.length > 0 && (
            <span className={styles.count}>
              <FileText size={12} /> {c.artifacts.length}
            </span>
          )}
        </button>
        {/* Open the case full screen — a place to work it, not just glance. */}
        <button className={styles.expand} onClick={() => setFull(true)} title="Open full screen">
          <Maximize2 size={13} />
        </button>
      </div>
      {full && <FullCaseView c={c} onClose={() => setFull(false)} onChanged={onChanged} onOpenFile={onOpenFile} />}

      {/* Collapsed, the one line that matters is what happened last. */}
      {/* Collapsed, say what this IS — the description if there is one, else
          whatever happened last. A status alone tells nobody anything. */}
      {!expanded && (c.description || last) && (
        <div className={styles.lastNote}>{c.description || last?.text}</div>
      )}

      {expanded && (
        <div className={styles.body}>
          {c.description && <p className={styles.description}>{c.description}</p>}

          {c.subject && (
            <a className={styles.subject} href={c.subject} onClick={(e) => e.preventDefault()} title={c.subject}>
              {c.subject}
            </a>
          )}

          {c.artifacts.length > 0 && (
            <div className={styles.files}>
              {c.artifacts.map((a) => (
                <button key={a} className={styles.file} onClick={() => void openArtifact(a)} title={a}>
                  <FileText size={12} /> {a.split('/').pop()}
                </button>
              ))}
            </div>
          )}

          <div className={styles.notes}>
            {c.notes.slice(-6).map((n, i) => (
              <div key={i} className={styles.note}>
                <span className={styles.noteWho}>{n.author}</span>
                <span>{n.text}</span>
              </div>
            ))}
          </div>

          <div className={styles.addRow}>
            <input
              className={styles.input}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addNote()}
              placeholder="What happened? e.g. invite with Maria Schmidt on Thursday"
              disabled={busy}
            />
            <button className={styles.add} onClick={() => void addNote()} disabled={busy || !note.trim()}>
              <Plus size={13} /> Note
            </button>
          </div>

          {/*
            What the note implies. These are OFFERS: the case moved, so something
            became possible. Nothing runs until the person picks it — a note that
            silently dispatched an agent would make people afraid to write notes,
            which would empty the one thing the case depends on.
          */}
          {signals.length > 0 && (
            <div className={styles.signals}>
              {signals.map((s, i) => (
                <button
                  key={i}
                  className={styles.signal}
                  onClick={() => void runOffer(s)}
                  disabled={busy || (s.kind !== 'schedule' && agentBusy)}
                  title="Hands this to an agent, with the whole case as context"
                >
                  <Sparkles size={12} /> {s.label}
                </button>
              ))}
            </div>
          )}

          {pickCalendar && (
            <ApprovalCard
              question="Which calendar should this go in?"
              options={pickCalendar.options.map((t) => ({
                id: t.id,
                label: t.label,
                hint: t.canInvite ? 'can invite people' : 'on this Mac only — no invitations',
              }))}
              busy={busy}
              onAnswer={({ optionId }) => { if (optionId) void schedule(pickCalendar.signal, optionId) }}
              onDismiss={() => setPickCalendar(null)}
            />
          )}

          {/*
            The general handoff. The offers above are shortcuts to this; anything
            we did not anticipate goes here, and the agent still gets everything.
          */}
          <div className={styles.addRow}>
            <PromptBar
              compact
              popover="down"
              placeholder="Hand this to an agent — @ file · # case"
              disabled={busy || agentBusy}
              onSubmit={(t, m, ids) => void runAsk(t, m, ids)}
            />
          </div>

          <CaseAgentActivity key={run?.runId} run={run} onOpenFile={onOpenFile} onContinue={continueRun} />

          {error && (
            <div className={styles.error} role="alert">
              That didn’t go through — {error}
            </div>
          )}

          <div className={styles.statuses}>
            {statuses.map((s) => (
              <button
                key={s}
                className={`${styles.chip} ${s === c.status ? styles.chipOn : ''}`}
                onClick={() => void setStatus(s)}
                disabled={busy || s === c.status}
              >
                {s}
              </button>
            ))}
          </div>

          {/*
            Where the case lives. A project thread belongs to its folder; a
            life thread (a job hunt) must not vanish because a different
            folder is open. A per-case choice, never a list mode — "what
            needs me" must not depend on which folder happens to be open.
          */}
          <div className={styles.scopeRow}>
            <span className={styles.scopeKey}>Lives in</span>
            <button
              className={`${styles.chip} ${(c.scope ?? 'workspace') === 'workspace' ? styles.chipOn : ''}`}
              onClick={() => void setScope('workspace')}
              disabled={busy || agentBusy || (c.scope ?? 'workspace') === 'workspace'}
            >
              this workspace
            </button>
            <button
              className={`${styles.chip} ${c.scope === 'global' ? styles.chipOn : ''}`}
              onClick={() => void setScope('global')}
              disabled={busy || agentBusy || c.scope === 'global'}
              title="Visible from every workspace — the file moves to ~/Workspace-OS/Cases"
            >
              everywhere
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
