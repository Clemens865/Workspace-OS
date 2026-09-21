import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  Check, ChevronDown, EyeOff, FileText, FolderOpen, GalleryHorizontal, Globe, GripVertical, LayoutGrid,
  Rows3, Scaling, Settings2, Sheet, Sparkles,
} from 'lucide-react'
import type { RailId } from '../shellModel'
import { useWorkspaceRoot } from '../../../hooks/useWorkspaceRoot'
import { docLabel } from '../shellModel'
import type { RecentEntry } from '../../../hooks/useWorkspaceLibrary'
import { useCreatedAssets } from '../../../hooks/useCreatedAssets'
import { reviewStore } from '../../Review/reviewStore'
import { activityStore } from '../../Review/activityStore'
import { peekSession } from '../../Browser/session-restore'
import { StatusPill, caseTone } from '../../ui/StatusPill'
import { PixelLoader } from '../../ui/PixelLoader'
import { RunTrace } from '../../AgentTerminal/RunTrace'
import { appendStep, type TraceStep } from '../../AgentTerminal/runTraceModel'
import { PromptBar } from '../../PromptBar/PromptBar'
import { buildDeskAsk, deskSummary, nextMorning, parseSnoozes, pickHero, type Hero } from './deskModel'
import { agoLabel, buildActivity, greeting, moveWidget, parseLayout, serializeLayout, type WidgetConfig, type WidgetId } from './homeModel'
import styles from './HomeDashboard.module.css'

/**
 * Home — "the desk", v2: one loud thing plus DENSITY where the person asked
 * for it. Support cards hold more (inner scroll), files and pages are
 * horizontal sliders (just-created + last-opened; open tabs + visited), and
 * the right column is the desk ASSISTANT — an agent grounded in exactly this
 * overview, able to look deeper via the case actions.
 */

const NEEDS_YOU = new Set(['drafted', 'interview', 'offer'])
const SNOOZE_KEY = 'wos:hero-snooze'
const LAYOUT_KEY = 'workspace-os:home-widgets:v1'
const SIDE: WidgetId[] = ['agents', 'calendar', 'cases', 'mail']

interface DeskCase {
  id: string
  title: string
  status: string
  updated: string
  description: string
  lastNote: string
  lastNoteAt: number
  lastNoteAuthor: string
  noteCount: number
  fileCount: number
}

interface DeskData {
  cases: DeskCase[]
  events: { uid: string; summary: string; start: number; allDay: boolean }[]
  agentsCount: number
  history: { url: string; title?: string }[]
  mailAccounts: number
}

const EMPTY: DeskData = { cases: [], events: [], agentsCount: 0, history: [], mailAccounts: 0 }

type Msg = { role: 'user' | 'agent'; text: string }

interface Props {
  recent: RecentEntry[]
  onNavigate: (rail: RailId) => void
  onOpenFile: (path: string) => void
}

/** One loader per app run — returning to Home later refreshes silently. */
let loadedOnce = false

const isSheet = (p: string): boolean => /\.(xlsx|csv|numbers|ods)$/i.test(p)

export function HomeDashboard({ recent, onNavigate, onOpenFile }: Props): JSX.Element {
  const [layout, setLayout] = useState<WidgetConfig[]>(() => parseLayout(localStorage.getItem(LAYOUT_KEY)))
  const [editing, setEditing] = useState(false)
  // Workspace switcher — coming home includes choosing WHICH home.
  const wsRoot = useWorkspaceRoot()
  const [wsOpen, setWsOpen] = useState(false)
  const [wsRecents, setWsRecents] = useState<string[]>([])
  const [loading, setLoading] = useState(!loadedOnce)
  const [data, setData] = useState<DeskData>(EMPTY)
  const [casePage, setCasePage] = useState(0)
  const created = useCreatedAssets()
  const review = useSyncExternalStore(reviewStore.subscribe, reviewStore.getSnapshot)
  const activity = useSyncExternalStore(activityStore.subscribe, activityStore.getSnapshot)
  const dragId = useRef<WidgetId | null>(null)

  // ── the assistant's little conversation ──
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [askBusy, setAskBusy] = useState(false)
  const [steps, setSteps] = useState<TraceStep[]>([])
  const runRef = useRef<string | null>(null)
  const convoRef = useRef('home-desk-assistant')
  const logRef = useRef<HTMLDivElement>(null)

  const persist = useCallback((next: WidgetConfig[]) => {
    setLayout(next)
    localStorage.setItem(LAYOUT_KEY, serializeLayout(next))
  }, [])

  const fetchAll = useCallback(async () => {
    const now = Date.now()
    const [cases, calendar, agents, history, mailAccounts] = await Promise.all([
      window.workspace.cases.list().catch(() => []),
      window.workspace.calendar.events(now, now + 48 * 3600_000).catch(() => ({ events: [], sources: [] })),
      window.workspace.agents.list().catch(() => []),
      window.workspace.history.recent(12).catch(() => []),
      window.workspace.mail.accounts.list().catch(() => []),
    ])
    setData({
      cases: cases.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        updated: c.updated,
        description: c.description ?? '',
        lastNote: c.notes[c.notes.length - 1]?.text ?? '',
        lastNoteAt: Date.parse(c.notes[c.notes.length - 1]?.at ?? '') || 0,
        lastNoteAuthor: c.notes[c.notes.length - 1]?.author ?? '',
        noteCount: c.notes.length,
        fileCount: c.artifacts.length,
      })),
      events: calendar.events.filter((e) => e.end > now).slice(0, 6),
      agentsCount: agents.length,
      history: history as { url: string; title?: string }[],
      mailAccounts: mailAccounts.length,
    })
  }, [])

  useEffect(() => {
    const started = Date.now()
    void fetchAll().finally(() => {
      const wait = loadedOnce ? 0 : Math.max(0, 700 - (Date.now() - started))
      setTimeout(() => { loadedOnce = true; setLoading(false) }, wait)
    })
  }, [fetchAll])

  // The desk belongs to the WORKSPACE — switching the root must swap the
  // cases (and everything else), not leave the old workspace's desk standing.
  useEffect(
    () =>
      window.workspace.fs.onRootChanged(() => {
        setCasePage(0)
        void fetchAll()
      }),
    [fetchAll],
  )

  // Assistant stream wiring — same backbone as the dock, minimal chrome.
  useEffect(() => {
    const offOut = window.workspace.agent.onOutput((runId, chunk) => {
      if (runId !== runRef.current) return
      setMsgs((prev) => {
        if (prev.length && prev[prev.length - 1].role === 'agent') {
          const next = prev.slice()
          next[next.length - 1] = { role: 'agent', text: next[next.length - 1].text + chunk }
          return next
        }
        return [...prev, { role: 'agent', text: chunk }]
      })
    })
    const offAct = window.workspace.agent.onActivity((runId, act) => {
      if (runId !== runRef.current) return
      activityStore.record(runId, act)
      setSteps((prev) => appendStep(prev, { kind: act.kind ?? 'run', label: act.label, chip: act.chip }, Date.now()))
    })
    const offDone = window.workspace.agent.onDone((runId, code, checkpointId) => {
      if (runId !== runRef.current) return
      activityStore.clear(runId)
      reviewStore.patchRun(runId, { status: code === 0 ? 'pending' : 'error', code, checkpointId: checkpointId ?? null })
      runRef.current = null
      setAskBusy(false)
      void fetchAll() // whatever it did may have changed the desk
    })
    return () => { offOut(); offAct(); offDone() }
  }, [fetchAll])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [msgs])

  const running = review.runs.filter((r) => r.status === 'running')
  const liveLine = (runId: string): string | undefined => activity.byRun.get(runId)?.label
  // "Not now" — a snoozed case stops being the hero until tomorrow morning,
  // without touching the case itself (its status still tells the truth).
  const [snoozes, setSnoozes] = useState<Record<string, number>>(() => parseSnoozes(localStorage.getItem(SNOOZE_KEY)))
  const snoozeHero = useCallback((caseId: string) => {
    setSnoozes((cur) => {
      const next = { ...cur, [caseId]: nextMorning() }
      localStorage.setItem(SNOOZE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const warmCases = data.cases.filter((c) => NEEDS_YOU.has(c.status) && !(snoozes[c.id] > Date.now()))
  const openTabs = peekSession()

  const ask = useCallback((raw: string, mentions: string[]) => {
    if (askBusy) return
    const shown = raw.trim() || 'Brief me.'
    setMsgs((prev) => [...prev, { role: 'user', text: shown }])
    setSteps([])
    setAskBusy(true)
    const runId = `home-ask-${Date.now()}`
    runRef.current = runId
    const prompt = buildDeskAsk(raw, {
      cases: data.cases.map((c) => ({ id: c.id, title: c.title, status: c.status })),
      events: data.events,
      running: running.map((r) => ({ name: r.agentName ?? r.sessionName, live: liveLine(r.runId) })),
      files: recent.slice(0, 5).map((r) => r.path),
      pages: [...openTabs.map((t) => ({ title: t.title, url: t.url })), ...data.history.slice(0, 3).map((h) => ({ title: h.title ?? '', url: h.url }))],
    })
    reviewStore.openRun({
      runId, sessionId: 'home-desk', sessionName: 'Desk assistant', prompt: shown,
      mode: 'full', agentName: null, agentId: 'home-desk',
    })
    window.workspace.agent.run(runId, prompt, mentions, null, 'full', null, convoRef.current).catch((err: Error) => {
      setMsgs((prev) => [...prev, { role: 'agent', text: `[error] ${err.message}` }])
      reviewStore.patchRun(runId, { status: 'error', code: null })
      runRef.current = null
      setAskBusy(false)
    })
  }, [askBusy, data, running, recent, openTabs, activity])

  const hero: Hero = pickHero({
    warmCases,
    running: running.map((r) => ({ runId: r.runId, name: r.agentName ?? r.sessionName, live: liveLine(r.runId) })),
    nextEvent: data.events[0] ? { summary: data.events[0].summary, start: data.events[0].start } : null,
    now: Date.now(),
  })

  if (loading) {
    return (
      <div className={styles.loading}>
        <PixelLoader label="Loading your workspace" variant="drive" />
      </div>
    )
  }

  const cfg = (id: WidgetId): WidgetConfig | undefined => layout.find((w) => w.id === id)
  const showAssistant = cfg('assistant')?.visible !== false
  const hidden = layout.filter((w) => !w.visible)
  const clock = new Date().toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  const dragProps = (id: WidgetId): React.HTMLAttributes<HTMLElement> =>
    editing
      ? {
          draggable: true,
          onDragStart: () => { dragId.current = id },
          onDragOver: (e) => { if (dragId.current && dragId.current !== id) e.preventDefault() },
          onDrop: (e) => {
            e.preventDefault()
            const from = dragId.current
            dragId.current = null
            if (from && from !== id) persist(moveWidget(layout, from, layout.findIndex((x) => x.id === id)))
          },
        }
      : {}

  const cycleSizeOf = (id: WidgetId): void =>
    persist(layout.map((x) => (x.id === id ? { ...x, size: x.size === 's' ? 'm' : x.size === 'm' ? 'l' : 's' } : x)))

  const editControls = (id: WidgetId, sizable = false): JSX.Element | null =>
    editing ? (
      <span className={styles.editCtl}>
        <GripVertical size={12} />
        {sizable && (
          <button
            className={styles.hideBtn}
            title={`Size: ${cfg(id)?.size.toUpperCase()}`}
            onClick={(e) => { e.stopPropagation(); cycleSizeOf(id) }}
          >
            <Scaling size={12} />
          </button>
        )}
        <button
          className={styles.hideBtn}
          aria-label="Hide"
          onClick={(e) => { e.stopPropagation(); persist(layout.map((x) => (x.id === id ? { ...x, visible: false } : x))) }}
        >
          <EyeOff size={12} />
        </button>
      </span>
    ) : null

  /** The always-visible view switcher for a strip: slider · list · grid. */
  const viewSwitch = (id: WidgetId): JSX.Element => {
    const v = cfg(id)?.view ?? 'slider'
    const opts = [
      { key: 'slider' as const, icon: GalleryHorizontal, hint: 'Slider' },
      { key: 'list' as const, icon: Rows3, hint: 'List' },
      { key: 'grid' as const, icon: LayoutGrid, hint: 'Icons' },
    ]
    return (
      <span className={styles.viewGroup}>
        {opts.map((o) => (
          <button
            key={o.key}
            className={`${styles.viewToggle} ${v === o.key ? styles.viewToggleOn : ''}`}
            title={o.hint}
            onClick={() => persist(layout.map((x) => (x.id === id ? { ...x, view: o.key } : x)))}
          >
            <o.icon size={12} />
          </button>
        ))}
      </span>
    )
  }

  /** Height class for a sizable support card. */
  const sizeClass = (id: WidgetId): string => {
    const s = cfg(id)?.size ?? 'm'
    return s === 's' ? styles.sideS : s === 'l' ? styles.sideL : ''
  }

  const cards: Partial<Record<WidgetId, () => JSX.Element>> = {
    agents: () => (
      <div className={`${styles.side} ${sizeClass('agents')}`} key="agents" {...dragProps('agents')}>
        <div className={styles.k}>Working now {editControls('agents', true)}</div>
        <div className={styles.scroll}>
          {running.length === 0 ? (
            <p className={styles.prose}>
              {data.agentsCount > 0
                ? `${data.agentsCount} specialist${data.agentsCount === 1 ? '' : 's'} on the team, none out right now.`
                : 'No specialists yet — the Foundry builds one from a description.'}
            </p>
          ) : (
            running.map((r) => (
              <button key={r.runId} className={styles.liveLine} onClick={() => onNavigate('agents')}>
                <span className={`${styles.dot} ${styles.breathe}`} />
                <span className={styles.who}>{r.agentName ?? r.sessionName}</span>
                <span className={styles.what}>{liveLine(r.runId) ?? 'working'}</span>
              </button>
            ))
          )}
        </div>
      </div>
    ),
    calendar: () => (
      <div className={`${styles.side} ${sizeClass('calendar')}`} key="calendar" {...dragProps('calendar')}>
        <div className={styles.k}>Next {editControls('calendar', true)}</div>
        <div className={styles.scroll}>
          {data.events.length === 0 ? (
            <p className={styles.prose}>Nothing scheduled in the next two days.</p>
          ) : (
            data.events.map((e) => (
              <button key={`${e.uid}-${e.start}`} className={styles.ev} onClick={() => onNavigate('calendar')}>
                <span className={styles.evT}>
                  {e.allDay
                    ? new Date(e.start).toLocaleDateString(undefined, { weekday: 'short' })
                    : new Date(e.start).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className={styles.evS}>{e.summary}</span>
              </button>
            ))
          )}
        </div>
      </div>
    ),
    cases: () => {
      const ordered = [...data.cases].sort((a, b) => {
        const aw = NEEDS_YOU.has(a.status) ? 0 : 1
        const bw = NEEDS_YOU.has(b.status) ? 0 : 1
        return aw !== bw ? aw - bw : a.updated < b.updated ? 1 : -1
      })
      const listView = cfg('cases')?.view === 'list'
      const page = Math.min(casePage, Math.max(0, ordered.length - 1))
      const c = ordered[page]
      return (
        <div className={`${styles.side} ${sizeClass('cases')}`} key="cases" {...dragProps('cases')}>
          <div className={styles.k}>
            Open cases · {data.cases.length} {editControls('cases', true)}
            {ordered.length > 0 && (
              <button
                className={styles.viewToggle}
                title={listView ? 'One case per page' : 'All as a list'}
                onClick={() => persist(layout.map((x) => (x.id === 'cases' ? { ...x, view: listView ? 'slider' : 'list' } : x)))}
              >
                {listView ? <GalleryHorizontal size={12} /> : <Rows3 size={12} />}
              </button>
            )}
          </div>
          {ordered.length === 0 ? (
            <p className={styles.prose}>No open cases — agents open one with every run.</p>
          ) : listView ? (
            <div className={styles.scroll}>
              {ordered.map((x) => (
                <button key={x.id} className={styles.caseRow} onClick={() => onNavigate('cockpit')}>
                  <span className={styles.caseN}>{x.title}</span>
                  <StatusPill tone={caseTone(x.status, NEEDS_YOU.has(x.status))}>{x.status}</StatusPill>
                </button>
              ))}
            </div>
          ) : (
            <div className={styles.pager}>
              <button className={styles.pageBody} onClick={() => onNavigate('cockpit')}>
                <span className={styles.pageTitleRow}>
                  <span className={styles.pageTitle}>{c.title}</span>
                  <StatusPill tone={caseTone(c.status, NEEDS_YOU.has(c.status))}>{c.status}</StatusPill>
                </span>
                {c.description && <span className={styles.pageDesc}>{c.description}</span>}
                {c.lastNote && <span className={styles.pageNote}>Latest: {c.lastNote}</span>}
                <span className={styles.pageMeta}>
                  {c.noteCount} note{c.noteCount === 1 ? '' : 's'} · {c.fileCount} file{c.fileCount === 1 ? '' : 's'}
                </span>
              </button>
              <div className={styles.pageNav}>
                <button
                  className={styles.pageArrow}
                  aria-label="Previous case"
                  disabled={page === 0}
                  onClick={() => setCasePage(page - 1)}
                >‹</button>
                <span className={styles.dots}>
                  {ordered.slice(0, 8).map((x, i) => (
                    <button
                      key={x.id}
                      aria-label={`Case ${i + 1}`}
                      className={`${styles.pdot} ${i === page ? styles.pdotOn : ''}`}
                      onClick={() => setCasePage(i)}
                    />
                  ))}
                </span>
                <button
                  className={styles.pageArrow}
                  aria-label="Next case"
                  disabled={page >= ordered.length - 1}
                  onClick={() => setCasePage(page + 1)}
                >›</button>
              </div>
            </div>
          )}
        </div>
      )
    },
    activity: () => {
      const items = buildActivity({
        cases: data.cases,
        runs: review.runs.map((r) => ({ agentName: r.agentName, sessionName: r.sessionName, status: r.status, prompt: r.prompt, at: r.createdAt })),
        files: created,
        nextEvent: data.events[0] ? { summary: data.events[0].summary, start: data.events[0].start } : null,
      })
      return (
        <div className={`${styles.side} ${sizeClass('activity')}`} key="activity" {...dragProps('activity')}>
          <div className={styles.k}>While you were away {editControls('activity', true)}</div>
          {items.length === 0 && <p className={styles.prose}>All quiet — nothing needed you.</p>}
          {items.length > 0 && (
            <div className={styles.actList}>
              {items.map((it, i) => (
                <div key={i} className={styles.actRow}>
                  <span className={`${styles.actDot} ${styles['act_' + it.kind] ?? ''}`} />
                  <span className={styles.actText}>{it.text}</span>
                  <span className={styles.actWhen}>
                    {it.kind === 'calendar'
                      ? new Date(it.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : agoLabel(it.at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )
    },
    mail: () => (
      <div className={`${styles.side} ${sizeClass('mail')}`} key="mail" {...dragProps('mail')}>
        <div className={styles.k}>Mail {editControls('mail', true)}</div>
        <p className={styles.prose}>
          {data.mailAccounts > 0
            ? `${data.mailAccounts} account${data.mailAccounts === 1 ? '' : 's'} connected — open Mail for the inbox.`
            : 'Connect an account to bring mail into the workspace.'}
        </p>
        <button className={styles.quietGo} onClick={() => onNavigate('mail')}>Open Mail →</button>
      </div>
    ),
  }

  // ── sliders ──
  const createdPaths = new Set(created.map((c) => c.path))
  const fileTiles = [
    ...created.map((c) => ({ path: c.path, tag: 'new' as const })),
    ...recent.filter((r) => !createdPaths.has(r.path)).map((r) => ({ path: r.path, tag: null })),
  ].slice(0, 14)
  const openUrls = new Set(openTabs.map((t) => t.url))
  const pageTiles = [
    ...openTabs.map((t) => ({ url: t.url, title: t.title || t.url, favicon: t.favicon, tag: 'open' as const })),
    ...data.history.filter((h) => !openUrls.has(h.url)).map((h) => ({ url: h.url, title: h.title || h.url, favicon: '', tag: null })),
  ].slice(0, 14)

  return (
    <div className={styles.root}>
      <div className={styles.top}>
        <div className={styles.hi}>
          <b>{greeting(new Date().getHours())}.</b> {deskSummary(warmCases.length, running.length)}
        </div>
        <div className={styles.topRight}>
          <div className={styles.wsWrap}>
            <button
              className={styles.wsSwitch}
              onClick={() => {
                setWsOpen((o) => !o)
                if (!wsOpen) void window.workspace.fs.recentWorkspaces?.().then((r) => setWsRecents(r ?? [])).catch(() => setWsRecents([]))
              }}
              title={wsRoot ?? 'Open a workspace'}
            >
              <FolderOpen size={12} /> {wsRoot ? wsRoot.split('/').pop() : 'Open workspace'} <ChevronDown size={11} />
            </button>
            {wsOpen && (
              <div className={styles.wsMenu}>
                {wsRecents.filter((r) => r !== wsRoot).slice(0, 6).map((r) => (
                  <button key={r} className={styles.wsItem} title={r}
                    onClick={() => { setWsOpen(false); void window.workspace.fs.openWorkspace?.(r) }}>
                    {r.split('/').pop()}
                    <span className={styles.wsPath}>{r.replace(/^\/Users\/[^/]+/, '~')}</span>
                  </button>
                ))}
                <button className={`${styles.wsItem} ${styles.wsOther}`}
                  onClick={() => { setWsOpen(false); void window.workspace.fs.openFolderDialog?.() }}>
                  Open folder…
                </button>
              </div>
            )}
          </div>
          <span className={styles.clock}>{clock}</span>
          <button className={`${styles.customize} ${editing ? styles.customizeOn : ''}`} onClick={() => setEditing((e) => !e)}>
            {editing ? <Check size={12} /> : <Settings2 size={12} />}
            {editing ? 'Done' : 'Customize'}
          </button>
        </div>
      </div>

      <div className={`${styles.deskCols} ${showAssistant ? '' : styles.deskColsSolo}`}>
        <div className={styles.main}>
          <div className={`${styles.hero} ${hero.kind === 'case' ? styles.heroWarm : ''}`}>
            <div className={styles.heroK}>{hero.kicker}</div>
            <h3 className={styles.heroH}>{hero.headline}</h3>
            <p className={styles.heroSub}>{hero.sub}</p>
            <div className={styles.heroFoot}>
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => onNavigate(hero.primary.go)}>
                {hero.primary.label}
              </button>
              {hero.secondary && (
                <button className={styles.btn} onClick={() => onNavigate(hero.secondary!.go)}>
                  {hero.secondary.label}
                </button>
              )}
              {hero.kind === 'case' && hero.caseId && (
                <button
                  className={styles.btn}
                  title="Hide this from the hero until tomorrow morning — the case itself is untouched"
                  onClick={() => snoozeHero(hero.caseId!)}
                >
                  Not now
                </button>
              )}
              {hero.kind === 'case' && warmCases.length > 1 && (
                <span className={styles.heroCount}>1 of {warmCases.length}</span>
              )}
            </div>
          </div>

          <div className={styles.supportGrid}>
            {layout.filter((w) => w.visible && SIDE.includes(w.id)).map((w) => cards[w.id]?.())}
          </div>

          {cfg('files')?.visible && (
            <div className={styles.strip} {...dragProps('files')}>
              <div className={styles.k}>Files · created &amp; last opened {editControls('files')} {viewSwitch('files')}</div>
              {fileTiles.length === 0 ? (
                <p className={styles.prose}>Files you open — and files your agents create — appear here.</p>
              ) : cfg('files')?.view === 'list' ? (
                <div className={styles.scroll}>
                  {fileTiles.map((f) => {
                    const Icon = isSheet(f.path) ? Sheet : FileText
                    return (
                      <button key={f.path} className={styles.listRow} title={f.path} onClick={() => onOpenFile(f.path)}>
                        <Icon size={14} className={styles.tileIcon} />
                        <span className={styles.listName}>{docLabel(f.path)}</span>
                        {f.tag === 'new' && <span className={styles.tileTag}>new</span>}
                        <span className={styles.listSub}>{f.path.split('/').slice(-2, -1)[0]}</span>
                      </button>
                    )
                  })}
                </div>
              ) : cfg('files')?.view === 'grid' ? (
                <div className={styles.iconGrid}>
                  {fileTiles.map((f) => {
                    const Icon = isSheet(f.path) ? Sheet : FileText
                    return (
                      <button key={f.path} className={styles.iconTile} title={f.path} onClick={() => onOpenFile(f.path)}>
                        <span className={styles.iconBig}><Icon size={22} /></span>
                        <span className={styles.iconName}>{docLabel(f.path)}</span>
                        {f.tag === 'new' && <span className={styles.tileTag}>new</span>}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className={styles.slider}>
                  {fileTiles.map((f) => {
                    const Icon = isSheet(f.path) ? Sheet : FileText
                    return (
                      <button key={f.path} className={styles.tile} title={f.path} onClick={() => onOpenFile(f.path)}>
                        <Icon size={15} className={styles.tileIcon} />
                        <span className={styles.tileName}>{docLabel(f.path)}</span>
                        {f.tag === 'new' && <span className={styles.tileTag}>new</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {cfg('browser')?.visible && (
            <div className={styles.strip} {...dragProps('browser')}>
              <div className={styles.k}>Pages · open &amp; visited {editControls('browser')} {viewSwitch('browser')}</div>
              {pageTiles.length === 0 ? (
                <p className={styles.prose}>Open tabs and pages you visit appear here.</p>
              ) : cfg('browser')?.view === 'list' ? (
                <div className={styles.scroll}>
                  {pageTiles.map((p) => (
                    <button key={p.url} className={styles.listRow} title={p.url} onClick={() => onNavigate('browser')}>
                      {p.favicon
                        ? <img src={p.favicon} alt="" className={styles.tileFav} />
                        : <Globe size={13} className={styles.tileIcon} />}
                      <span className={styles.listName}>{p.title}</span>
                      {p.tag === 'open' && <span className={styles.tileTag}>open</span>}
                      <span className={styles.listSub}>{(() => { try { return new URL(p.url).hostname } catch { return '' } })()}</span>
                    </button>
                  ))}
                </div>
              ) : cfg('browser')?.view === 'grid' ? (
                <div className={styles.iconGrid}>
                  {pageTiles.map((p) => (
                    <button key={p.url} className={styles.iconTile} title={p.url} onClick={() => onNavigate('browser')}>
                      <span className={styles.iconBig}>
                        {p.favicon ? <img src={p.favicon} alt="" className={styles.iconFav} /> : <Globe size={22} />}
                      </span>
                      <span className={styles.iconName}>{p.title}</span>
                      {p.tag === 'open' && <span className={styles.tileTag}>open</span>}
                    </button>
                  ))}
                </div>
              ) : (
                <div className={styles.slider}>
                  {pageTiles.map((p) => (
                    <button key={p.url} className={styles.tile} title={p.url} onClick={() => onNavigate('browser')}>
                      {p.favicon ? (
                        <img src={p.favicon} alt="" className={styles.tileFav} />
                      ) : (
                        <Globe size={14} className={styles.tileIcon} />
                      )}
                      <span className={styles.tileName}>{p.title}</span>
                      {p.tag === 'open' && <span className={styles.tileTag}>open</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {showAssistant && (
          <aside className={styles.assistant} {...dragProps('assistant')}>
            <div className={styles.k}>
              <Sparkles size={12} className={styles.kIcon} /> Desk assistant {editControls('assistant')}
            </div>
            <div className={styles.chatLog} ref={logRef}>
              {msgs.length === 0 && (
                <p className={styles.prose}>
                  Sees everything on this desk, and can open any case for the full thread.
                  Try “brief me” or “what should I do first?”.
                </p>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={m.role === 'user' ? styles.msgUser : styles.msgAgent}>
                  {m.role === 'user' ? `› ${m.text}` : m.text}
                </div>
              ))}
            </div>
            <RunTrace steps={steps} busy={askBusy} />
            <div className={styles.chatComposer}>
              <PromptBar
                compact
                placeholder="Ask about your workspace — @ mentions a file"
                disabled={askBusy}
                onSubmit={ask}
              />
            </div>
          </aside>
        )}
      </div>

      {editing && hidden.length > 0 && (
        <div className={styles.hiddenRow}>
          <span className={styles.hiddenLabel}>Hidden:</span>
          {hidden.map((w) => (
            <button
              key={w.id}
              className={styles.hiddenChip}
              onClick={() => persist(layout.map((x) => (x.id === w.id ? { ...x, visible: true } : x)))}
            >
              + {w.id}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
