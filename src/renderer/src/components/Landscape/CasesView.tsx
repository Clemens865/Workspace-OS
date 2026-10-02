import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Check, FileText, FolderOpen, Search, Send } from 'lucide-react'
import type { WorkCase } from '../../types/workspace-api'
import { useGlass } from './backdrop/useBackdrop'
import { ago } from './agentPresence'
import { openFile } from './agentActions'
import styles from './CasesView.module.css'

type Tab = 'overview' | 'files' | 'notes' | 'history'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'files', label: 'Files' },
  { id: 'notes', label: 'Notes' },
  { id: 'history', label: 'History' },
]

const when = (iso: string): number => {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}

/** A draft of this case (Work/<id>/drafts/…), which can be accepted into outputs. */
export function isDraftOf(caseId: string, p: string): boolean {
  return new RegExp(`(^|/)Work/${caseId.replace(/[^a-z0-9-]/gi, '')}/drafts/`, 'i').test(p)
}

/** Cases, newest activity first, filtered by a search over title, subject and description. */
export function filterCases(list: WorkCase[], q: string): WorkCase[] {
  const s = q.trim().toLowerCase()
  return [...list]
    .filter((c) => !s || `${c.title} ${c.subject} ${c.description} ${c.id}`.toLowerCase().includes(s))
    .sort((a, b) => when(b.updated) - when(a.updated))
}

function Folio({ c, selected, i, onPick }: { c: WorkCase; selected: boolean; i: number; onPick: () => void }): JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  useGlass(ref, { radius: 18, bezel: 14, thickness: 30, frost: selected ? 0.32 : 0.2 })
  return (
    <button ref={ref} type="button" className={`${styles.folio} ${selected ? styles.sel : ''}`} onClick={onPick} style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }} data-case={c.id}>
      <span className={styles.ftab} />
      <span className={styles.ftitle}>{c.title}</span>
      <span className={styles.fmeta}>
        {c.status} · {ago(when(c.updated))}
      </span>
    </button>
  )
}

/**
 * Cases, in the landscape: a shelf of folios on the left, the chosen case open
 * on the right (overview, files, notes, history). Reading a case never starts
 * work; files open on the stage, notes and status are written through the
 * cases API like everywhere else in the app.
 */
export function CasesView({ initialCase = null }: { initialCase?: string | null } = {}): JSX.Element {
  const [cases, setCases] = useState<WorkCase[] | null>(null)
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<string | null>(initialCase)
  useEffect(() => {
    if (initialCase) setPick(initialCase)
  }, [initialCase])
  const [tab, setTab] = useState<Tab>('overview')
  const [statuses, setStatuses] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const main = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      setCases(await window.workspace.cases.list())
    } catch {
      setCases([])
    }
  }, [])
  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(id)
  }, [load])

  const shown = useMemo(() => filterCases(cases ?? [], q), [cases, q])
  const c = shown.find((x) => x.id === pick) ?? shown[0] ?? null
  useGlass(main, c ? { radius: 26, bezel: 24, thickness: 46, frost: 0.82 } : null)

  useEffect(() => {
    if (!c) return
    let alive = true
    void window.workspace.cases
      .statuses(c.type)
      .then((s) => alive && setStatuses(s))
      .catch(() => alive && setStatuses([]))
    return () => {
      alive = false
    }
  }, [c?.type, c?.id])

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (cases && !cases.length) {
    return (
      <div className={styles.empty} data-testid="cases-view" data-count={0}>
        <div className={styles.emptyTitle}>No cases yet</div>
        <p className={styles.emptyText}>A case keeps one thread of work together: its documents, notes and status. Agents and you create them as work starts.</p>
      </div>
    )
  }

  return (
    <div className={styles.cases} data-testid="cases-view" data-count={cases?.length ?? 0}>
      <div className={styles.shelf}>
        <label className={styles.search}>
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cases…" aria-label="Search cases" data-testid="cases-search" />
        </label>
        <div className={styles.folios}>
          {shown.map((x, i) => (
            <Folio key={x.id} c={x} i={i} selected={x.id === c?.id} onPick={() => setPick(x.id)} />
          ))}
          {!shown.length && cases && <div className={styles.none}>No matching cases</div>}
        </div>
      </div>

      {c && (
        <div ref={main} className={styles.open} data-testid="case-open" data-case={c.id}>
          <div className={styles.crumb}>
            {c.scope === 'global' ? 'Everywhere' : 'This workspace'} · {c.type} · Case {c.id}
          </div>
          <h2 className={styles.title}>{c.title}</h2>
          {c.description && <p className={styles.desc}>{c.description}</p>}
          <div className={styles.statusRow}>
            <select
              className={styles.status}
              value={c.status}
              disabled={busy || !statuses.length}
              onChange={(e) => void act(() => window.workspace.cases.setStatus(c.id, e.target.value))}
              aria-label="Status"
              data-testid="case-status"
            >
              {(statuses.includes(c.status) ? statuses : [c.status, ...statuses]).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <span className={styles.meta}>
              {c.artifacts.length} files · {c.notes.length} notes · updated {ago(when(c.updated))}
            </span>
            <button
              className={styles.btn}
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const w = await window.workspace.cases.workFolder(c.id)
                  window.dispatchEvent(new CustomEvent('wos:reveal-path', { detail: w.folder }))
                })
              }
              data-testid="case-folder"
            >
              <FolderOpen size={13} /> Case folder
            </button>
          </div>

          <nav className={styles.tabs}>
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? styles.tabOn : styles.tab} onClick={() => setTab(t.id)} data-tab={t.id}>
                {t.label}
                {t.id === 'files' && c.artifacts.length > 0 && <b>{c.artifacts.length}</b>}
                {t.id === 'notes' && c.notes.length > 0 && <b>{c.notes.length}</b>}
              </button>
            ))}
          </nav>

          <div className={styles.pane}>
            {tab === 'overview' && (
              <div className={styles.overview}>
                <section>
                  <h3 className={styles.h}>What we have</h3>
                  {c.artifacts.length ? (
                    <div className={styles.cards}>
                      {c.artifacts.slice(0, 6).map((p) => (
                        <button key={p} className={styles.fcard} onClick={() => openFile(p)}>
                          <FileText size={16} />
                          <span>{p.split('/').pop()}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className={styles.muted}>No documents yet.</p>
                  )}
                </section>
                <section>
                  <h3 className={styles.h}>Latest</h3>
                  {c.notes.length ? (
                    <ol className={styles.timeline}>
                      {[...c.notes].reverse().slice(0, 5).map((n, i) => (
                        <li key={i} data-author={n.author}>
                          <span>
                            {ago(when(n.at))} · {n.author === 'you' ? 'You' : 'Agent'}
                          </span>
                          <div>{n.text}</div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className={styles.muted}>Nothing noted yet.</p>
                  )}
                </section>
              </div>
            )}

            {tab === 'files' && (
              <ul className={styles.flist}>
                {c.artifacts.map((p) => (
                  <li key={p}>
                    <FileText size={16} />
                    <span className={styles.fname}>{p}</span>
                    {isDraftOf(c.id, p) && (
                      <button className={styles.btn} disabled={busy} onClick={() => void act(() => window.workspace.cases.promote(c.id, p))} data-testid="case-accept">
                        <Check size={13} /> Accept
                      </button>
                    )}
                    <button className={styles.btn} onClick={() => openFile(p)}>
                      Open <ArrowUpRight size={13} />
                    </button>
                  </li>
                ))}
                {!c.artifacts.length && <li className={styles.muted}>No documents yet.</li>}
              </ul>
            )}

            {tab === 'notes' && (
              <div className={styles.notes}>
                <ol className={styles.conv}>
                  {c.notes.map((n, i) => (
                    <li key={i} className={n.author === 'you' ? styles.you : styles.agent}>
                      <span>
                        {n.author === 'you' ? 'You' : 'Agent'} · {ago(when(n.at))}
                      </span>
                      <div>{n.text}</div>
                    </li>
                  ))}
                </ol>
                <label className={styles.composer}>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add to this case…" data-testid="case-note" />
                  <button
                    className={styles.send}
                    disabled={busy || !note.trim()}
                    onClick={() =>
                      void act(async () => {
                        await window.workspace.cases.addNote(c.id, note.trim(), 'you')
                        setNote('')
                      })
                    }
                    aria-label="Add note"
                    data-testid="case-note-send"
                  >
                    <Send size={14} />
                  </button>
                </label>
              </div>
            )}

            {tab === 'history' && (
              <ol className={styles.timeline}>
                <li data-author="system">
                  <span>{new Date(when(c.created)).toLocaleString()}</span>
                  <div>Case created</div>
                </li>
                {c.notes.map((n, i) => (
                  <li key={i} data-author={n.author}>
                    <span>
                      {new Date(when(n.at)).toLocaleString()} · {n.author === 'you' ? 'You' : 'Agent'}
                    </span>
                    <div>{n.text}</div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
