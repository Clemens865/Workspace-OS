import { useCallback, useEffect, useRef, useState } from 'react'
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
import styles from './LandscapeShell.module.css'

/** How long the landscape takes to step aside or return (matches the CSS). */
const FADE_MS = 450

/**
 * The Screen Landscape shell (docs/landscape/PLAN.md).
 *
 * Two layers. The landscape (overview, menu, later the agent screens) sits on
 * top; underneath, the current shell runs as the flat STAGE with every surface
 * mounted, every shortcut bound and every modal available. Anything that brings
 * a surface forward (Menu, ⌘K, ⌘P, a link, an agent's artifact) reveals the
 * stage; the stage's Landscape button returns. Live surfaces are never put
 * under a transform: the landscape fades over the stage, the stage itself
 * never moves.
 */
export function LandscapeShell(): JSX.Element {
  const settings = useSettings()
  const [view, setView] = useState<LandscapeView>('overview')
  // The stage stays visible until the landscape has fully faded back in.
  const [stageShown, setStageShown] = useState(false)
  const lastLandscape = useRef<Exclude<LandscapeView, 'stage'>>('overview')

  const showStage = useCallback(() => setView('stage'), [])
  const showLandscape = useCallback((v?: Exclude<LandscapeView, 'stage'>) => setView(v ?? lastLandscape.current), [])

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
    const events = ['wos:browser-navigate', 'wos:reveal-path', 'wos:knowledge-backlinks', 'wos:focus-agent', 'wos:launch-agent']
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

  const onDock = (id: DockId): void => {
    const item = DOCK.find((d) => d.id === id)
    if (item?.stage) openSurface(item.stage)
    else showLandscape(id === 'menu' ? 'menu' : 'overview')
  }
  const activeDock: DockId | null = view === 'menu' ? 'menu' : view === 'overview' ? 'overview' : null
  const onStage = view === 'stage'

  return (
    <div className={`wl ${styles.root}`} data-shell="landscape" data-view={view}>
      <WorkspaceShell stage={{ hidden: !stageShown, onLandscape: () => showLandscape(), onSurface: showStage }} />

      <div className={`${styles.landscape} ${onStage ? styles.away : ''}`} aria-hidden={onStage} data-testid="landscape-layer">
        <div className={styles.horizon} aria-hidden />

        <header className={styles.header}>
          <div>
            <div className={styles.eyebrow}>Workspace OS</div>
            <h1 className={styles.heading}>{view === 'menu' ? 'Menu' : 'Your team'}</h1>
            <div className={styles.sub}>
              {view === 'menu' ? 'Every part of the workspace, one click away' : 'Screen Landscape · in progress'}
            </div>
          </div>
          <button className={styles.back} onClick={() => settings.set('landscapeShell', false)} data-testid="landscape-exit">
            Back to the current shell
          </button>
        </header>

        {view === 'menu' ? (
          <LandscapeMenu onOpen={openSurface} />
        ) : (
          <p className={styles.note}>
            Agent screens arrive in the next phase. Until then, the Menu and the dock open every surface on the
            stage, and ⌘K, ⌘P and ⌘J work from here.
          </p>
        )}

        <LandscapeDock active={activeDock} onSelect={onDock} />
      </div>
    </div>
  )
}
