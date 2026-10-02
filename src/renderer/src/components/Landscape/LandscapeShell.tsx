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
import styles from './LandscapeShell.module.css'

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
  const [view, setView] = useState<LandscapeView>('overview')
  const [agentId, setAgentId] = useState<string | null>(null)
  // The stage stays visible until the landscape has fully faded back in.
  const [stageShown, setStageShown] = useState(false)
  const lastLandscape = useRef<LandscapeOnly>('overview')
  const reduced = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, [])

  const { agents } = useAgentPresence()
  const rows = useMemo(() => {
    const r = arrangeRows(agents)
    // The "Add agent" ghost closes the last row.
    return r.back.length ? { front: r.front, back: [...r.back, ADD_ID] } : { front: [...r.front, ADD_ID], back: [] }
  }, [agents])

  const showStage = useCallback(() => setView('stage'), [])
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
    const events = ['wos:browser-navigate', 'wos:reveal-path', 'wos:knowledge-backlinks', 'wos:focus-agent', 'wos:launch-agent', 'wos:open-file']
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

  const openAgent = useCallback((id: string) => {
    setAgentId(id)
    setView('agent')
  }, [])

  // Esc steps back out: agent → overview, menu → overview.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return
      if (view === 'agent' || view === 'menu') setView('overview')
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
    else showLandscape(id === 'menu' ? 'menu' : 'overview')
  }
  const activeDock: DockId | null = view === 'menu' ? 'menu' : view === 'overview' || view === 'agent' ? 'overview' : null
  const onStage = view === 'stage'
  const worldMode: WorldMode = view === 'agent' ? 'focus' : view === 'overview' ? 'overview' : 'away'

  return (
    <div className={`wl ${styles.root}`} data-shell="landscape" data-view={view}>
      <WorkspaceShell stage={{ hidden: !stageShown, onLandscape: () => showLandscape(), onSurface: showStage }} />

      <div className={`${styles.landscape} ${onStage ? styles.away : ''}`} aria-hidden={onStage} data-testid="landscape-layer">
        <div className={styles.horizon} aria-hidden />

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
              <button className={styles.backLink} onClick={() => setView('overview')} data-testid="agent-back">
                <ArrowLeft size={16} /> Team overview
              </button>
            ) : (
              <>
                <h1 className={styles.heading}>{view === 'menu' ? 'Menu' : 'Your team'}</h1>
                <div className={styles.sub} data-testid="team-summary">
                  {view === 'menu' ? 'Every part of the workspace, one click away' : agents.length ? teamSummary(agents) : 'No agents yet'}
                </div>
              </>
            )}
          </div>
          <button className={styles.back} onClick={() => settings.set('landscapeShell', false)} data-testid="landscape-exit">
            Back to the current shell
          </button>
        </header>

        {view === 'menu' && <LandscapeMenu onOpen={openSurface} />}

        {(view === 'overview' || view === 'agent') && (
          <div className={styles.hint} aria-hidden>
            {view === 'agent'
              ? '← → or swipe sideways to switch agents · Esc to return'
              : agents.length
                ? 'Scroll to explore · choose a screen to step closer'
                : 'Add an agent to see it here'}
          </div>
        )}

        <LandscapeDock active={activeDock} onSelect={onDock} />
      </div>
    </div>
  )
}
