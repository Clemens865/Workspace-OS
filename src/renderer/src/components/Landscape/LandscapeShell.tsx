import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import '@fontsource/newsreader/400.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '../../styles/landscape-tokens.css'
import { WorkspaceShell } from '../Shell/WorkspaceShell'
import type { RailId } from '../Shell/shellModel'
import { useSettings } from '../../hooks/useSettings'
import { DOCK, type DockId, type LandscapeView } from './landscapeModel'
import { LandscapeDock } from './LandscapeDock'
import { LandscapeMenu } from './LandscapeMenu'
import { LandscapeWorld, ADD_ID, type WorldMode } from './LandscapeWorld'
import { AgentFocus } from './AgentFocus'
import { useAgentPresence } from './useAgentPresence'
import { arrangeRows, teamSummary } from './agentPresence'
import { createAgent } from './agentActions'
import { InboxView } from './InboxView'
import { CasesView } from './CasesView'
import { ProjectSwitcher } from './ProjectSwitcher'
import { deriveInbox } from './inboxModel'
import { PreviewLive } from './usePreview'
import { BackdropContext, useBackdrop } from './backdrop/useBackdrop'
import styles from './LandscapeShell.module.css'

const DISMISSED_KEY = 'workspace-os:landscape-dismissed'

/** How long the landscape takes to step aside or return (matches the CSS). */
const FADE_MS = 450

type LandscapeOnly = Exclude<LandscapeView, 'stage'>

/**
 * The Screen Landscape shell (docs/landscape/PLAN.md).
 *
 * Two layers. The landscape (the team's screens, an agent in focus, the menu)
 * sits on top; underneath, the current shell runs as the flat STAGE with every
 * surface mounted, every shortcut bound and every modal available. Anything
 * that brings a surface forward (Menu, ⌘K, ⌘P, a link, an agent's artifact)
 * reveals the stage; the stage's Landscape button returns. Live surfaces are
 * never put under a transform: the landscape fades over the stage, the stage
 * itself never moves.
 */
export function LandscapeShell(): JSX.Element {
  const settings = useSettings()
  // Where the app opens: the person's setting, or the stage when a test asks (WOS_START_ON).
  const [view, setView] = useState<LandscapeView>(() => (settings.startOn === 'stage' ? 'stage' : 'overview'))
  const [openedOnStage, setOpenedOnStage] = useState(() => settings.startOn === 'stage')
  useEffect(() => {
    void window.workspace?.startOn?.().then((v) => {
      if (v !== 'stage') return
      setView('stage')
      setOpenedOnStage(true)
    })
  }, [])
  const [agentId, setAgentId] = useState<string | null>(null)
  // The stage stays visible until the landscape has fully faded back in.
  const [stageShown, setStageShown] = useState(false)
  const lastLandscape = useRef<LandscapeOnly>('overview')
  const reduced = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, [])

  const { agents, runs, hitl, jobs, codex } = useAgentPresence()
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const dismiss = useCallback((key: string) => {
    setDismissed((old) => {
      const next = new Set(old).add(key)
      try {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next].slice(-200)))
      } catch {
        /* best effort */
      }
      return next
    })
  }, [])
  const inbox = useMemo(() => deriveInbox({ runs, hitl, jobs, codex, dismissed }), [runs, hitl, jobs, codex, dismissed])
  const rows = useMemo(() => {
    const r = arrangeRows(agents)
    // The "Add agent" ghost closes the last row.
    return r.back.length ? { front: r.front, back: [...r.back, ADD_ID] } : { front: [...r.front, ADD_ID], back: [] }
  }, [agents])

  // The WebGL backdrop runs only while the landscape is on screen (PLAN.md §3a).
  const canvas = useRef<HTMLCanvasElement>(null)
  const { backdrop, quality } = useBackdrop(canvas, {
    setting: settings.landscapeQuality ?? 'auto',
    visible: !(view === 'stage' && stageShown),
    reduced,
  })
  const backBtn = useRef<HTMLButtonElement>(null)
  // The header's back button is a small glass pill (the shell renders the
  // backdrop's provider, so it attaches them directly).
  useEffect(() => {
    const els = [backBtn.current].filter((e): e is HTMLButtonElement => !!e)
    if (!backdrop) return
    els.forEach((el) => backdrop.addGlass(el, { radius: 21, bezel: 12, thickness: 24, frost: 0.16 }))
    return () => els.forEach((el) => backdrop.removeGlass(el))
  }, [backdrop, view])

  const showStage = useCallback(() => setView('stage'), [])
  // The stage switches itself to Browser when an agent navigates; that switch
  // must not pull the stage over the landscape.
  const agentBrowsing = useRef(0)
  useEffect(() => {
    const quiet = (): void => {
      agentBrowsing.current = performance.now() + 1500
    }
    window.addEventListener('wos:browser-navigate', quiet)
    return () => window.removeEventListener('wos:browser-navigate', quiet)
  }, [])
  const onStageSurface = useCallback(
    (rail: RailId) => {
      if (rail === 'browser' && performance.now() < agentBrowsing.current) return
      showStage()
    },
    [showStage],
  )
  const showLandscape = useCallback((v?: LandscapeOnly) => setView(v ?? lastLandscape.current), [])

  useEffect(() => {
    if (view !== 'stage') lastLandscape.current = view
    if (view === 'stage') {
      setStageShown(true)
      return
    }
    const t = window.setTimeout(() => setStageShown(false), FADE_MS)
    return () => window.clearTimeout(t)
  }, [view])

  /** Open a stage surface by name: the shell's own rail switch, then reveal it. */
  const openSurface = useCallback(
    (rail: RailId) => {
      window.dispatchEvent(new CustomEvent('wos:open-rail', { detail: { rail } }))
      showStage()
    },
    [showStage],
  )

  // Things that bring a surface forward without changing the stage's rail (it
  // may already be on that rail) must still reveal the stage.
  useEffect(() => {
    // Not 'wos:browser-navigate': that is an AGENT driving the browser. In the
    // landscape you watch it on the agent's screen; the stage stays put.
    const events = ['wos:reveal-path', 'wos:knowledge-backlinks', 'wos:focus-agent', 'wos:launch-agent', 'wos:open-file']
    events.forEach((e) => window.addEventListener(e, showStage))
    const offTab = window.workspace?.browserTabs?.onOpenTab?.(showStage)
    const offArtifact = window.workspace?.agent?.onArtifact?.(showStage)
    return () => {
      events.forEach((e) => window.removeEventListener(e, showStage))
      offTab?.()
      offArtifact?.()
    }
  }, [showStage])

  // ⌘J opens the terminal dock, which lives on the stage.
  const termWasOpen = useRef(settings.terminalOpen)
  useEffect(() => {
    if (settings.terminalOpen && !termWasOpen.current) showStage()
    termWasOpen.current = settings.terminalOpen
  }, [settings.terminalOpen, showStage])

  const openAgent = useCallback(
    (id: string) => {
      // A ripple spreads on the lake from under the chosen screen.
      const face = document.querySelector<HTMLElement>(`[data-agent="${CSS.escape(id)}"] [data-testid="agent-face"]`)
      if (face && backdrop) {
        const r = face.getBoundingClientRect()
        backdrop.ripple(r.left + r.width / 2, Math.max(r.bottom, window.innerHeight * 0.52))
      }
      setAgentId(id)
      setView('agent')
    },
    [backdrop],
  )

  // The mist recedes for a focused agent and takes its provider's tint; it breathes on every view change.
  const focusedAgent = view === 'agent' ? agents.find((a) => a.id === agentId) : undefined
  const tintHex = focusedAgent ? (focusedAgent.provider === 'codex' ? '#2D9D8F' : '#D97757') : null
  const lastView = useRef(view)
  useEffect(() => {
    if (!backdrop) return
    backdrop.setFocus(view === 'agent' ? 1 : view === 'overview' ? 0 : 0.7)
    backdrop.setLight(view === 'agent' ? 0.5 : 0.56)
    backdrop.setTint(tintHex)
    if (lastView.current !== view) backdrop.breathe()
    lastView.current = view
  }, [backdrop, view, tintHex])

  // Esc steps back out: agent → overview, menu → overview.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return
      if (view === 'agent' || view === 'menu' || view === 'inbox' || view === 'cases') setView('overview')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view])

  // The focused agent left the roster (deleted, workspace switched): step back.
  useEffect(() => {
    if (view === 'agent' && agentId && !agents.some((a) => a.id === agentId)) setView('overview')
  }, [view, agentId, agents])

  const onDock = (id: DockId): void => {
    const item = DOCK.find((d) => d.id === id)
    if (item?.stage) openSurface(item.stage)
    else showLandscape(id === 'menu' ? 'menu' : id === 'inbox' ? 'inbox' : id === 'cases' ? 'cases' : 'overview')
  }
  const activeDock: DockId | null =
    view === 'menu' ? 'menu' : view === 'inbox' ? 'inbox' : view === 'cases' ? 'cases' : view === 'overview' || view === 'agent' ? 'overview' : null
  const onStage = view === 'stage'
  const worldMode: WorldMode = view === 'agent' ? 'focus' : view === 'overview' ? 'overview' : 'away'

  return (
    <div className={`wl ${styles.root}`} data-shell="landscape" data-view={view}>
      <WorkspaceShell stage={{ hidden: !stageShown, onLandscape: () => showLandscape(), onSurface: onStageSurface, railOpen: openedOnStage }} />

      <div className={`${styles.landscape} ${onStage ? styles.away : ''} ${backdrop ? styles.glassOn : ''}`} aria-hidden={onStage} data-testid="landscape-layer" data-quality={quality}>
        <div className={styles.horizon} aria-hidden />
        <canvas ref={canvas} className={`${styles.canvas} ${backdrop ? styles.canvasOn : ''}`} aria-hidden data-testid="landscape-canvas" />
        <BackdropContext.Provider value={backdrop}>
        <PreviewLive.Provider value={!onStage}>

        <LandscapeWorld
          agents={agents}
          front={rows.front}
          back={rows.back}
          mode={worldMode}
          focusId={view === 'agent' ? agentId : null}
          onOpen={openAgent}
          onStep={openAgent}
          renderFocus={(a) => <AgentFocus a={a} />}
          onAdd={createAgent}
          reduced={reduced}
        />

        <header className={styles.header}>
          <div>
            <div className={styles.eyebrow}>Workspace OS</div>
            {view === 'agent' ? (
              <button ref={backBtn} className={styles.backLink} onClick={() => setView('overview')} data-testid="agent-back">
                <ArrowLeft size={16} /> Team overview
              </button>
            ) : (
              <>
                <h1 className={styles.heading}>
                  {view === 'menu' ? 'Menu' : view === 'inbox' ? `Inbox${inbox.length ? ` · ${inbox.length} waiting` : ''}` : view === 'cases' ? 'Your cases' : 'Your team'}
                </h1>
                <div className={styles.sub} data-testid="team-summary">
                  {view === 'menu'
                    ? 'Every part of the workspace, one click away'
                    : view === 'inbox'
                      ? 'Questions, results to review, and anything that went wrong'
                      : view === 'cases'
                        ? 'Each thread of work with its documents, notes and status'
                      : agents.length
                        ? teamSummary(agents)
                        : 'No agents yet'}
                </div>
              </>
            )}
          </div>
          <div className={styles.headerRight}>
            <ProjectSwitcher />
          </div>
        </header>

        {view === 'menu' && <LandscapeMenu onOpen={openSurface} />}
        {view === 'inbox' && <InboxView items={inbox} onDismiss={dismiss} />}
        {view === 'cases' && <CasesView />}

        {(view === 'overview' || view === 'agent') && (
          <div className={styles.hint} aria-hidden>
            {view === 'agent'
              ? '← → or swipe sideways to switch agents · Esc to return'
              : agents.length
                ? 'Scroll to explore · choose a screen to step closer'
                : 'Add an agent to see it here'}
          </div>
        )}

        <LandscapeDock active={activeDock} onSelect={onDock} waiting={inbox.length} />
        </PreviewLive.Provider>
        </BackdropContext.Provider>
      </div>
    </div>
  )
}
