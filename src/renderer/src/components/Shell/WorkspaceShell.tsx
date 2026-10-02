import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Search, ArrowUpRight, ArrowLeft, SquareTerminal, Maximize2, Minimize2, ChevronUp, ChevronDown, X, Mountain } from 'lucide-react'
import { Rail } from './Rail'
import { Home } from './Home'
import type { RailId, StageTab } from './shellModel'
import { HOME_TAB, openDocTab, closeDocTab, isDocTab, isPlaceholder, RAIL_ITEMS, docLabel, resolveOpenPath } from './shellModel'
import styles from './WorkspaceShell.module.css'

import { FilePanel } from '../FilePanel/FilePanel'
import { FileBrowser } from '../FilePanel/FileBrowser'
import { Canvas } from '../Canvas/Canvas'
import { MailPanel } from '../Mail/MailPanel'
import { KnowledgePanel } from '../KnowledgePanel/KnowledgePanel'
import { BrowserSurface } from '../Browser/BrowserSurface'
import { ReviewFeed } from '../Review/ReviewFeed'
import { CalmCockpit } from '../CalmCockpit/CalmCockpit'
import { CalendarPanel } from '../Calendar/CalendarPanel'
import { SettingsPanel } from '../Settings/SettingsPanel'
import { ConnectorsView } from '../Connectors/ConnectorsView'
import { CommandBar } from '../CommandBar/CommandBar'
import { QuickOpen } from '../QuickOpen/QuickOpen'
import { TerminalDock } from '../Terminal/TerminalDock'
import { SearchPanel } from '../SearchPanel/SearchPanel'
import { MemoryPanel } from '../MemoryPanel/MemoryPanel'
import { TrashView } from '../Trash/TrashView'
import { CheckpointsView } from '../Checkpoints/CheckpointsView'
import { SaveSnapshotDialog } from '../Snapshots/SaveSnapshotDialog'
import { UpdateBanner } from '../Update/UpdateBanner'

import { usePanelSizes } from '../../hooks/usePanelSizes'
import { useTabManager } from '../../hooks/useTabManager'
import { useWorkspaceRoot } from '../../hooks/useWorkspaceRoot'
import { scopeKey } from '../../lib/workspaceScope'
import { useWorkspaceLibrary } from '../../hooks/useWorkspaceLibrary'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { useSettings } from '../../hooks/useSettings'
import { useAgentActions } from '../../hooks/useAgentActions'
import { setTheme } from '../../hooks/useTheme'
import { actionManifest, ALL_ACTIONS, type SurfaceActionContext } from '../Terminal/surfaceActions'

/**
 * The redesigned shell (feat/shell-redesign) — a left rail, a Stage with tabs,
 * and a Home two-pane surface. It COMPOSES the existing components verbatim:
 *   Files → FilePanel      Mail → MailPanel      Knowledge → KnowledgePanel
 *   Agents → ReviewFeed    Settings → SettingsPanel
 *   opened document → Canvas (the real office/pdf/monaco/… editor)
 *   ⌘K → CommandBar        ⌘P → QuickOpen
 *
 * Since phase 7 of docs/landscape/PLAN.md this is no longer a shell of its own:
 * the Screen Landscape shell hosts it as its flat stage
 * (docs/landscape/PLAN.md §3): every surface, shortcut and modal stays exactly
 * as here, the rail starts hidden (⌘B shows it), a Landscape button leads back,
 * and every surface change is reported so the landscape can step aside.
 */
export interface StageHost {
  /** The landscape is showing: hide the rail and surfaces, keep modals usable. */
  hidden: boolean
  /** The user asked to go back to the landscape. */
  onLandscape: () => void
  /** A surface or document was brought forward (by the user, an event or an agent). */
  onSurface: (rail: RailId) => void
  /**
   * The app was opened straight on the stage ("Open on: Stage"): show the
   * rail, as the familiar workspace. Reached from the landscape, the rail stays
   * tucked away (the landscape's dock is the navigation); ⌘B toggles it.
   */
  railOpen?: boolean
}

export function WorkspaceShell({ stage }: { stage?: StageHost } = {}): JSX.Element {
  const root = useWorkspaceRoot()
  const library = useWorkspaceLibrary(root)

  // The Stage's own tab manager (full-tab documents) is independent from the
  // Home in-pane ("peek") tab manager, so opening in Home never disturbs the
  // Stage tabs and vice-versa. Both are the real useTabManager / Canvas.
  const stageTabs = useTabManager()
  const peekTabs = useTabManager()
  const filesTabs = useTabManager() // the Files surface's in-place preview (tree stays left)
  usePanelSizes() // reserved for a later increment; keeps the hook warm

  const [rail, setRail] = useState<RailId>('home')

  /**
   * WOS-011 — give one surface the whole window.
   *
   * `expanded` hides the rail, the tab strip and the terminal dock at once, for
   * when the user wants to work inside a single application. `railHidden` is the
   * lighter version behind ⌘B: reclaim the 76px rail but keep the tabs.
   *
   * Neither is persisted. A user who quits while expanded and reopens to a
   * window with no rail and no tabs has no way to know what happened; the two
   * ways back (Esc, and the button that stays visible) only help if you know
   * you are in it.
   */
  const [expanded, setExpanded] = useState(false)
  const [railHidden, setRailHidden] = useState(!!stage && !stage.railOpen)
  const railOpen = !!stage?.railOpen
  useEffect(() => {
    if (railOpen) setRailHidden(false)
  }, [railOpen])

  /**
   * WOS-013: the folder the Files browser is showing. Set when the tree reveals
   * a folder, so the two panes stay pointed at the same place; otherwise the
   * browser keeps its own navigation and back/forward history.
   */
  const [browseFolder, setBrowseFolder] = useState<string | undefined>(undefined)
  const [tabs, setTabs] = useState<StageTab[]>([HOME_TAB])
  const [activeTab, setActiveTab] = useState<string>(HOME_TAB.key)
  const [commandOpen, setCommandOpen] = useState(false)
  const [quickOpenOpen, setQuickOpenOpen] = useState(false)
  const [refreshSignal, setRefreshSignal] = useState(0)

  // Parity surfaces/dialogs the legacy WorkspaceLayout has — all additive, each
  // reusing the SAME component the legacy uses, behind local open-state. Search
  // and Memory are content panels with no rail slot, so they overlay the Stage.
  const [searchOpen, setSearchOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [checkpointsOpen, setCheckpointsOpen] = useState(false)
  const [snapshotDialogOpen, setSnapshotDialogOpen] = useState(false)

  // Integrated Terminal Dock — open state (⌘J) + placement live in Settings; the
  // dock is a resizable bottom strip / right column. dockSize is CSS px.
  const settings = useSettings()
  const [dockSize, setDockSize] = useState(320)
  const [dockResizeSignal, setDockResizeSignal] = useState(0)

  const refresh = useCallback(() => setRefreshSignal((n) => n + 1), [])

  // Open a document into the Stage as its own full tab (real editor).
  // Paths arrive absolute from the file surfaces but possibly workspace-
  // relative from case attachments — resolveOpenPath makes them one thing.
  const openInStage = useCallback(
    (rawPath: string) => {
      const path = resolveOpenPath(rawPath, root)
      library.recordRecent(path)
      stageTabs.openFile(path)
      setTabs((cur) => {
        const next = openDocTab(cur, path)
        setActiveTab(next.active)
        return next.tabs
      })
      setRail('files')
    },
    [library, stageTabs, root],
  )

  // Open a document INTO Home's right pane, keeping the triage feed on the left.
  const openInHome = useCallback(
    (path: string) => {
      library.recordRecent(path)
      peekTabs.openFile(path)
      setRail('home')
      setActiveTab(HOME_TAB.key)
    },
    [library, peekTabs],
  )

  // Open a document INTO the Files surface's right pane, keeping the tree on the left.
  const openInFiles = useCallback(
    (path: string) => {
      library.recordRecent(path)
      filesTabs.openFile(path)
      setRail('files')
      setActiveTab('files')
      // WOS-013: remember which folder this file came from, so closing the
      // preview returns to where it was rather than back to the workspace root.
      const parent = path.slice(0, path.lastIndexOf('/'))
      if (parent) setBrowseFolder(parent)
    },
    [library, filesTabs],
  )

  const closeStageTab = useCallback(
    (key: string) => {
      const tab = stageTabs.tabs.find((t) => t.filePath === key)
      if (tab) stageTabs.closeTab(tab.id)
      setTabs((cur) => {
        const next = closeDocTab(cur, key)
        setActiveTab(next.active)
        return next.tabs
      })
    },
    [stageTabs],
  )

  const selectTab = useCallback((key: string) => {
    setActiveTab(key)
    if (key !== HOME_TAB.key) setRail('files')
    else setRail('home')
  }, [])

  const selectRail = useCallback((id: RailId) => {
    setRail(id)
    setActiveTab(id === 'home' ? HOME_TAB.key : id)
  }, [])

  const openSearchPanel = useCallback(() => setSearchOpen(true), [])

  // ── Workspace snapshots (PRD MVP #10) — reuse the SAME window.workspace.snapshots
  // module the legacy WorkspaceLayout uses. Save captures the Stage desk; restore
  // reopens each file as a Stage tab. Sidebar/terminal geometry isn't part of the
  // new shell's model, so we restore what maps (files + active file) cleanly.
  const saveSnapshot = useCallback(
    async (name: string) => {
      await window.workspace.snapshots.save(name, {
        files: stageTabs.tabs.map((t) => t.filePath),
        activeFile: stageTabs.activeFilePath,
        // Fixed values for fields the new shell doesn't surface — keeps the
        // persisted shape valid for both layouts.
        sidebarView: 'files',
        sidebarOpen: true,
        terminalOpen: settings.terminalOpen,
        panel: null,
      })
    },
    [stageTabs, settings.terminalOpen],
  )

  const restoreSnapshot = useCallback(
    async (id: string) => {
      const snap = (await window.workspace.snapshots.list()).find((s) => s.id === id)
      if (!snap) return
      // Reopen each file as a Stage tab via the real openInStage path.
      for (const f of snap.state.files) openInStage(f)
      if (snap.state.activeFile) openInStage(snap.state.activeFile)
    },
    [openInStage],
  )

  // When the agent generates an office file, open it in a Stage tab + refresh.
  useEffect(() => {
    return window.workspace.agent.onArtifact((_runId, filePath) => {
      openInStage(filePath)
      refresh()
    })
  }, [openInStage, refresh])

  // Clicking a breadcrumb folder reveals it — switch to the Files surface so the
  // (now-expanding) tree is visible. FilePanel does the actual reveal.
  useEffect(() => {
    const handler = (): void => {
      setRail('files')
      setActiveTab('files')
    }
    window.addEventListener('wos:reveal-path', handler)
    return () => window.removeEventListener('wos:reveal-path', handler)
  }, [])

  // Agent browser-drive: `browser.navigate` fires this before loading a URL so
  // the Browser rail is showing (the user WATCHES the agent) and the sandboxed
  // <webview> guest exists for main to drive. Same renderer-event pattern as
  // reveal-path — no IPC.
  useEffect(() => {
    const handler = (): void => setRail('browser')
    window.addEventListener('wos:browser-navigate', handler)
    return () => window.removeEventListener('wos:browser-navigate', handler)
  }, [])

  /**
   * A link opened from anywhere (a mail, an agent, a document) shows the
   * Browser.
   *
   * BrowserSurface is kept mounted, so it receives the same event and opens the
   * tab regardless of which rail is showing. Without this switch the tab opens
   * CORRECTLY and invisibly — the user is still looking at their mail and
   * concludes the link is broken, which is the exact bug this fixes.
   */
  useEffect(() => {
    return window.workspace.browserTabs.onOpenTab(() => setRail('browser'))
  }, [])

  // Anything can open a document on the Stage by path (the landscape's agent
  // screens use it for a run's outputs).
  useEffect(() => {
    const onOpen = (e: Event): void => {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path
      if (path) openInStage(path)
    }
    window.addEventListener('wos:open-file', onOpen)
    return () => window.removeEventListener('wos:open-file', onOpen)
  }, [openInStage])

  // The dock's "Search workspace" quick-action opens the QuickOpen palette.
  useEffect(() => {
    const open = (): void => setQuickOpenOpen(true)
    window.addEventListener('wos:quick-open', open)
    return () => window.removeEventListener('wos:quick-open', open)
  }, [])

  // The Team roster's "Run" opens the Terminal Dock AND a fresh agent tab bound
  // to that specialist's persona. We stash the name; the dock (which may be
  // mounting for the first time here) picks it up and opens the agent tab.
  const [pendingAgent, setPendingAgent] = useState<string | null>(null)
  useEffect(() => {
    const onLaunch = (e: Event): void => {
      const name = (e as CustomEvent<{ name?: string }>).detail?.name
      settings.set('terminalOpen', true)
      if (name) setPendingAgent(name)
    }
    window.addEventListener('wos:launch-agent', onLaunch)
    return () => window.removeEventListener('wos:launch-agent', onLaunch)
  }, [settings])

  // The document dock's "Show backlinks" action switches to the Knowledge rail;
  // the panel loads backlinks for the (already open) active file on becoming
  // visible. Same renderer-event pattern as reveal-path — no IPC.
  useEffect(() => {
    const handler = (): void => {
      setRail('knowledge')
      setActiveTab('knowledge')
    }
    window.addEventListener('wos:knowledge-backlinks', handler)
    return () => window.removeEventListener('wos:knowledge-backlinks', handler)
  }, [])

  // Cycle the Stage tab strip (next/prev) — wraps around the open document tabs.
  const cycleTab = useCallback(
    (dir: 1 | -1) => {
      setTabs((cur) => {
        if (cur.length <= 1) return cur
        const idx = cur.findIndex((t) => t.key === activeTab)
        const nextIdx = (idx + dir + cur.length) % cur.length
        const next = cur[nextIdx]
        if (next) selectTab(next.key)
        return cur
      })
    },
    [activeTab, selectTab],
  )

  const shortcutHandlers = useMemo(
    () => ({
      onCommandPalette: () => setCommandOpen((v) => !v),
      onQuickOpen: () => setQuickOpenOpen((v) => !v),
      onSearchPanel: () => setQuickOpenOpen((v) => !v),
      // WOS-011: this was a no-op, so ⌘B could not even reclaim the 76px rail.
      onToggleSidebar: () => setRailHidden((v) => !v),
      onToggleExpand: () => setExpanded((v) => !v),
      onToggleTerminal: () => {
        // From minimised, ⌘J RESTORES rather than hides: a user looking at a
        // collapsed strip and pressing "show terminal" means show it.
        if (settings.terminalOpen && settings.terminalMinimized) settings.set('terminalMinimized', false)
        else settings.set('terminalOpen', !settings.terminalOpen)
      },
      onToggleMinimizeTerminal: () => {
        if (!settings.terminalOpen) {
          // Minimising something that is not there should open it minimised,
          // not do nothing — otherwise the shortcut is silently dead.
          settings.set('terminalOpen', true)
          settings.set('terminalMinimized', true)
        } else settings.set('terminalMinimized', !settings.terminalMinimized)
      },
      onAgentFocus: () => selectRail('agents'),
      onCloseTab: () => {
        if (activeTab !== HOME_TAB.key) closeStageTab(activeTab)
      },
      onNextTab: () => cycleTab(1),
      onPrevTab: () => cycleTab(-1),
      // Bound only while expanded, so Esc keeps its ordinary meaning elsewhere.
      onEscape: expanded ? () => setExpanded(false) : undefined,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTab, closeStageTab, selectRail, settings, expanded],
  )
  useKeyboardShortcuts(shortcutHandlers)

  // Route the native View/Go/Agent/Snapshot menu clicks (menu.ts) to the new
  // shell's state — one behavior, two entry points (mirrors WorkspaceLayout).
  useEffect(() => {
    return window.workspace.menu.onRunAction((id) => {
      if (id === 'go.quickopen') setQuickOpenOpen((v) => !v)
      else if (id === 'go.searchpanel') openSearchPanel()
      else if (id === 'go.tab:next') cycleTab(1)
      else if (id === 'go.tab:prev') cycleTab(-1)
      else if (id === 'go.tab:back') stageTabs.goBack()
      else if (id === 'go.tab:forward') stageTabs.goForward()
      else if (id === 'view.toggle:files') selectRail('files')
      else if (id === 'view.toggle:terminal') settings.set('terminalOpen', !settings.terminalOpen)
      else if (id === 'view.appearance:light') setTheme('light')
      else if (id === 'view.appearance:dark') setTheme('dark')
      else if (id === 'agent.checkpoints') setCheckpointsOpen(true)
      else if (id === 'snapshot.save') setSnapshotDialogOpen(true)
      else if (id.startsWith('snapshot.restore:'))
        void restoreSnapshot(id.slice('snapshot.restore:'.length))
    })
  }, [openSearchPanel, cycleTab, stageTabs, selectRail, settings, restoreSnapshot])

  // The native Agent menu's "Focus Agent" dispatches this → show the Agents rail.
  useEffect(() => {
    const onFocus = (): void => selectRail('agents')
    window.addEventListener('wos:focus-agent', onFocus)
    return () => window.removeEventListener('wos:focus-agent', onFocus)
  }, [selectRail])

  // Anywhere in the app can ask for a rail by name (Settings → "Open Connectors").
  useEffect(() => {
    const onOpen = (e: Event): void => {
      const id = (e as CustomEvent<{ rail?: RailId }>).detail?.rail
      if (id && RAIL_ITEMS.some((r) => r.id === id)) selectRail(id)
    }
    window.addEventListener('wos:open-rail', onOpen)
    return () => window.removeEventListener('wos:open-rail', onOpen)
  }, [selectRail])

  // The file the user is currently looking at across the surfaces (Stage tab,
  // Home peek, or Files preview) — feeds the live terminal harness.
  const activeFilePath =
    (rail === 'files' && activeTab === HOME_TAB.key
      ? filesTabs.activeFilePath
      : rail === 'home'
        ? peekTabs.activeFilePath
        : stageTabs.activeFilePath) ?? null
  const folderOf = (p: string | null): string | null =>
    p ? p.slice(0, p.lastIndexOf('/')) || root : root

  // The live harness ctx the surfaceActions registry runs against — the SAME
  // shape a dock chip uses. Kept in a ref-like getter so the agent executor runs
  // each invocation against the CURRENT surface/open file, not a stale snapshot.
  const surfaceCtx = useMemo<SurfaceActionContext>(
    () => ({ root, surface: rail, openFile: activeFilePath, folder: folderOf(activeFilePath) }),
    // folderOf is derived from root; deps below cover every input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [root, rail, activeFilePath],
  )
  const getSurfaceCtx = useCallback(() => surfaceCtx, [surfaceCtx])

  // AGENT→ACTION bridge: run agent-invoked actions against the live harness.
  useAgentActions(getSurfaceCtx)

  // Push the live harness to main whenever the user navigates (surface / open
  // file / root) — INCLUDING the per-surface action manifest {id, agentHint}
  // (drives the agent preamble) + every registered id (the socket allow-set).
  // Future shell spawns + agent tabs inherit this context.
  useEffect(() => {
    window.workspace.context.set({
      root: surfaceCtx.root,
      surface: surfaceCtx.surface,
      openFile: surfaceCtx.openFile,
      folder: surfaceCtx.folder,
      actions: actionManifest(surfaceCtx),
      allActionIds: ALL_ACTIONS.map((a) => a.id),
    })
  }, [surfaceCtx])

  // Landscape host: any change of surface or tab means "show the stage". The
  // first run is the initial mount, which must not pull the stage forward.
  const mounted = useRef(false)
  const onSurface = stage?.onSurface
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    onSurface?.(rail)
  }, [rail, activeTab, onSurface])

  const peekFilePath = peekTabs.activeFilePath
  const onHome = rail === 'home' && activeTab === HOME_TAB.key
  const railLabel = (id: RailId): string => RAIL_ITEMS.find((r) => r.id === id)?.label ?? id

  // Drag-resize the dock (col-resize for right, row-resize for bottom). Bumping
  // dockResizeSignal on each move makes the embedded xterm re-fit live.
  const startDockDrag = useCallback(
    (axis: 'x' | 'y') => (e: React.MouseEvent) => {
      e.preventDefault()
      const start = axis === 'x' ? e.clientX : e.clientY
      const startSize = dockSize
      const onMove = (ev: MouseEvent): void => {
        const delta = axis === 'x' ? start - ev.clientX : start - ev.clientY
        setDockSize(Math.max(140, Math.min(900, startSize + delta)))
        setDockResizeSignal((n) => n + 1)
      }
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        setDockResizeSignal((n) => n + 1)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [dockSize],
  )

  // WOS-011: expanding suppresses the dock WITHOUT touching the setting, so
  // collapsing brings back exactly the terminal the user had open. Writing
  // `terminalOpen` here would silently rewrite a preference as a side effect of
  // a layout gesture.
  const dockOpen = settings.terminalOpen && !expanded
  // Minimised keeps the dock MOUNTED — that is the difference from hiding. The
  // shell session and its scrollback survive, so restoring puts the user back
  // in the same terminal rather than a fresh one. Only the height collapses.
  const dockMin = dockOpen && settings.terminalMinimized
  const dockRight = settings.terminalPlacement === 'right'
  const dockCtx = { root, surface: rail, openFile: activeFilePath, folder: folderOf(activeFilePath) }
  const dock = (
    // Keyed by workspace: the dock's agent tabs belong to the open root.
    <TerminalDock
      key={scopeKey(root)}
      context={dockCtx}
      resizeSignal={dockResizeSignal}
      launchAgent={pendingAgent}
      onAgentLaunched={() => setPendingAgent(null)}
      onOpenFile={openInStage}
    />
  )

  /**
   * The minimised dock: a title bar and nothing else. It is the whole
   * affordance — a terminal that vanished with no trace is indistinguishable
   * from one that was closed, and the user would open a new session rather
   * than find the one still running.
   */
  const dockBar = (
    // A right-placed dock minimises to a narrow VERTICAL stub on the same edge
    // it lives on, rather than jumping to the bottom of the window — the stub
    // should be where you last saw the thing it stands for.
    <div className={`${styles.dockBar} ${dockRight ? styles.dockBarV : ''}`}>
      <button
        type="button"
        className={styles.dockBarMain}
        onClick={() => settings.set('terminalMinimized', false)}
        title="Restore the terminal (⌥⌘J)"
      >
        <SquareTerminal size={13} strokeWidth={1.9} />
        <span>Terminal</span>
        <span className={styles.dockBarHint}>still running — click to restore</span>
      </button>
      <button
        type="button"
        className={styles.dockBarBtn}
        onClick={() => settings.set('terminalMinimized', false)}
        title="Restore (⌥⌘J)"
        aria-label="Restore the terminal"
      >
        <ChevronUp size={13} strokeWidth={2} />
      </button>
      <button
        type="button"
        className={styles.dockBarBtn}
        onClick={() => {
          settings.set('terminalOpen', false)
          settings.set('terminalMinimized', false)
        }}
        title="Hide (⌘J)"
        aria-label="Hide the terminal"
      >
        <X size={13} strokeWidth={2} />
      </button>
    </div>
  )

  // WOS-011: expanding hides the rail as well, so the two states collapse into
  // one question for the layout — is the rail on screen at all.
  const railOut = expanded || railHidden

  return (
    <div
      className={`wos ${styles.root} ${railOut ? styles.railOut : ''} ${expanded ? styles.expanded : ''} ${stage?.hidden ? styles.stageHidden : ''}`}
      data-expanded={expanded ? 'true' : 'false'}
    >
      <Rail active={rail} onSelect={selectRail} />

      {/* The way back. Always rendered while expanded — a surface with no rail,
          no tabs and no visible exit is a trap, and a control that only appears
          on hover cannot be found by someone who does not know it is there. */}
      {expanded && (
        <button
          type="button"
          className={styles.expandExit}
          onClick={() => setExpanded(false)}
          title="Exit full window (Esc)"
          aria-label="Exit full window"
        >
          <Minimize2 size={14} strokeWidth={2} />
          <span>Exit full window</span>
          <kbd>esc</kbd>
        </button>
      )}

      <div className={styles.stage}>
        <div className={styles.topbar}>
          {stage && (
            <button
              type="button"
              className={styles.landscapeBtn}
              onClick={stage.onLandscape}
              title="Back to the landscape"
              data-testid="stage-landscape"
            >
              <Mountain size={14} strokeWidth={1.9} />
              <span>Landscape</span>
            </button>
          )}
          <div className={styles.tabs}>
            {tabs.map((t) => (
              <div
                key={t.key}
                className={`${styles.tab} ${activeTab === t.key ? styles.tabOn : ''}`}
                onClick={() => selectTab(t.key)}
              >
                {t.label}
                {t.closable && (
                  <span
                    className={styles.tabClose}
                    onClick={(e) => {
                      e.stopPropagation()
                      closeStageTab(t.key)
                    }}
                  >
                    ×
                  </span>
                )}
              </div>
            ))}
          </div>
          <button className={styles.cmdk} onClick={() => setCommandOpen(true)}>
            <Search size={13} /> Search or run…
            <span className={styles.cmdkKey}>⌘K</span>
          </button>
          <button
            className={`${styles.termToggle} ${dockOpen ? styles.termToggleOn : ''}`}
            onClick={() => settings.set('terminalOpen', !settings.terminalOpen)}
            title="Terminal — shell + agent (⌘J)"
            aria-label="Toggle terminal"
            aria-pressed={dockOpen}
          >
            <SquareTerminal size={15} strokeWidth={1.9} />
            <span className={styles.termToggleLabel}>Terminal</span>
          </button>

          {/* Minimise is offered only while the dock is showing — a minimise
              button next to a hidden terminal describes nothing. */}
          {dockOpen && !settings.terminalMinimized && (
            <button
              type="button"
              className={styles.termToggle}
              onClick={() => settings.set('terminalMinimized', true)}
              title="Minimise the terminal (⌥⌘J)"
              aria-label="Minimise the terminal"
            >
              <ChevronDown size={15} strokeWidth={1.9} />
            </button>
          )}

          {/* WOS-011: the discoverable way in. The shortcut is shown rather
              than required — nobody finds ⌃⌘F by guessing. */}
          <button
            type="button"
            className={styles.termToggle}
            onClick={() => setExpanded(true)}
            title="Fill the window (⌃⌘F)"
            aria-label="Fill the window"
          >
            <Maximize2 size={15} strokeWidth={1.9} />
          </button>
        </div>

        <div className={styles.stageMain}>
        <div className={styles.body}>
          {/* Home — the two-pane triage surface. Kept mounted so ReviewFeed
              subscriptions and the peeked editor stay alive. */}
          <div className={`${styles.surface} ${onHome ? '' : styles.hidden}`}>
            <Home
              library={library}
              peekTabManager={peekTabs}
              peekFilePath={peekFilePath}
              onOpenInPane={openInHome}
              onPopOut={openInStage}
              onNavigate={selectRail}
              onRefresh={refresh}
            />
          </div>

          {/* Stage document tabs → the real Canvas editor. */}
          <div
            className={`${styles.surface} ${rail === 'files' && isDocTab(tabs, activeTab) ? '' : styles.hidden}`}
          >
            <Canvas tabManager={stageTabs} library={library} onRefresh={refresh} />
          </div>

          {/* Files → the tree (LEFT) + the selected file opened in-place (RIGHT),
              so the folder tree stays visible while you read/edit — matching the
              prototype. "Open full" promotes it to a full Stage tab. */}
          <div
            className={`${styles.surface} ${rail === 'files' && activeTab === 'files' ? '' : styles.hidden}`}
          >
            <div className={styles.filesSplit}>
              <div className={styles.filesTree}>
                <FilePanel
                  onFileOpen={openInFiles}
                  onFileCreate={openInStage}
                  onShowTrash={() => setTrashOpen(true)}
                  refreshSignal={refreshSignal}
                  library={library}
                />
              </div>
              <div className={styles.peek}>
                {filesTabs.activeFilePath ? (
                  <>
                    <div className={styles.peekHead}>
                      <div>
                        <div className={styles.peekTitle}>{docLabel(filesTabs.activeFilePath)}</div>
                        <div className={styles.peekSub}>the file tree stays on the left</div>
                      </div>
                      {/* WOS-013: the way back to browsing. Selecting a file used
                          to be a one-way trip — the pane became an editor with no
                          route back to the folder it came from. */}
                      <button
                        className={styles.peekAct}
                        onClick={() => filesTabs.closeTab(filesTabs.tabs.find((t) => t.filePath === filesTabs.activeFilePath)!.id)}
                        title="Back to the folder"
                      >
                        <ArrowLeft size={14} /> Folder
                      </button>
                      <button
                        className={styles.peekAct}
                        onClick={() => openInStage(filesTabs.activeFilePath!)}
                      >
                        <ArrowUpRight size={14} /> Open full
                      </button>
                    </div>
                    <div className={styles.peekHost}>
                      <Canvas tabManager={filesTabs} library={library} onRefresh={refresh} />
                    </div>
                  </>
                ) : (
                  /* WOS-013: was "Select a file to open it here." — a dead end.
                     Now the folder itself, browsable: sortable columns, filters
                     by name/kind/age, breadcrumb and back/forward. Clicking a
                     file loads it into this same pane, which is the preview. */
                  <FileBrowser
                    root={root}
                    startPath={browseFolder}
                    onOpenFile={openInFiles}
                    refreshSignal={refreshSignal}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Mail → MailPanel. */}
          <div className={`${styles.surface} ${rail === 'mail' ? '' : styles.hidden}`}>
            <MailPanel active={rail === 'mail'} />
          </div>

          {/* Knowledge → KnowledgePanel. */}
          <div className={`${styles.surface} ${rail === 'knowledge' ? '' : styles.hidden}`}>
            <KnowledgePanel
              active={rail === 'knowledge'}
              activeFile={stageTabs.activeFilePath}
              onFileOpen={openInStage}
            />
          </div>

          {/* Memory → the real MemoryPanel (reused verbatim). Given a home as a
              rail surface — the legacy exposes it as a sidebar view. */}
          <div className={`${styles.surface} ${rail === 'memory' ? '' : styles.hidden}`}>
            <MemoryPanel active={rail === 'memory'} />
          </div>

          {/* Browser → the in-app BrowserSurface (sandboxed webview). Kept
              mounted so the guest page's session/history survives rail switches. */}
          <div className={`${styles.surface} ${rail === 'browser' ? '' : styles.hidden}`}>
            <BrowserSurface />
          </div>

          {/* Agents → the real ReviewFeed / fleet. */}
          <div className={`${styles.surface} ${rail === 'agents' ? '' : styles.hidden}`}>
            <div className={styles.feedHost}>
              <ReviewFeed onOpenFile={openInStage} onWorkspaceChanged={refresh} />
            </div>
          </div>

          {/* Cockpit → the LIVE Calm Cockpit (Team-lead altitude wired to real
              agent runs). CEO/Head-of/Agent altitudes remain the mock vision.
              Kept mounted so its store subscriptions stay warm. */}
          <div className={`${styles.surface} ${rail === 'cockpit' ? '' : styles.hidden}`}>
            <CalmCockpit live onOpenFile={openInStage} onWorkspaceChanged={refresh} />
          </div>

          {/* Calendar → the real CalDAV/ICS surface. Kept mounted like the other
              rail surfaces so switching back doesn't re-sync from scratch. */}
          <div className={`${styles.surface} ${rail === 'calendar' ? '' : styles.hidden}`}>
            <CalendarPanel />
          </div>

          {/* Connectors → everything the workspace is signed into, one roster. */}
          <div className={`${styles.surface} ${rail === 'connectors' ? '' : styles.hidden}`}>
            <ConnectorsView active={rail === 'connectors'} onNavigate={selectRail} />
          </div>

          {/* Settings → SettingsPanel (renders its own modal backdrop). */}
          {rail === 'settings' && <SettingsPanel onClose={() => selectRail('home')} />}

          {/* Placeholders for surfaces whose real components aren't wired yet. */}
          {isPlaceholder(rail) && (
            <div className={`${styles.surface}`}>
              <div className={styles.placeholder}>
                <div>
                  <h1>{railLabel(rail)}</h1>
                  <p>Coming soon in a later increment.</p>
                </div>
              </div>
            </div>
          )}
        </div>

          {/* Terminal Dock — RIGHT column (resizable). Additive: only mounts
              when open + placement=right, so the layout is unchanged otherwise.

              While MINIMISED the dock stays mounted at zero size — unmounting it
              would kill the shell session, which is the one thing minimising is
              supposed to preserve. */}
          {dockOpen && dockRight && (
            <>
              {!dockMin && <div className={styles.dockHandleV} onMouseDown={startDockDrag('x')} />}
              {dockMin && dockBar}
              <div
                className={`${styles.dockRight} ${dockMin ? styles.dockCollapsed : ''}`}
                style={{ width: dockMin ? 0 : dockSize }}
                aria-hidden={dockMin}
              >
                {dock}
              </div>
            </>
          )}
        </div>

        {/* Terminal Dock — BOTTOM strip (resizable). Minimised = the title bar
            only, with the dock itself collapsed but still mounted. */}
        {dockOpen && !dockRight && (
          <>
            {!dockMin && <div className={styles.dockHandleH} onMouseDown={startDockDrag('y')} />}
            {dockMin && dockBar}
            <div
              className={`${styles.dockBottom} ${dockMin ? styles.dockCollapsed : ''}`}
              style={{ height: dockMin ? 0 : dockSize }}
              aria-hidden={dockMin}
            >
              {dock}
            </div>
          </>
        )}
      </div>

      {commandOpen && (
        <CommandBar onClose={() => setCommandOpen(false)} onOpenFile={openInStage} />
      )}
      {quickOpenOpen && (
        <QuickOpen
          onClose={() => setQuickOpenOpen(false)}
          onOpenFile={openInStage}
          recent={library.recent}
          root={root}
        />
      )}

      {/* Content search — the legacy shows SearchPanel as a sidebar view; the
          new shell surfaces it as an overlay opened by the Go ▸ Search menu
          (go.searchpanel). Reuses the SAME SearchPanel component verbatim. */}
      {searchOpen && (
        <div className={styles.searchOverlay} role="dialog" aria-label="Search">
          <div className={styles.searchOverlayHead}>
            <span>Search workspace</span>
            <button
              className={styles.searchOverlayClose}
              onClick={() => setSearchOpen(false)}
              aria-label="Close search"
            >
              ×
            </button>
          </div>
          <div className={styles.searchOverlayBody}>
            <SearchPanel
              onFileOpen={(p) => {
                setSearchOpen(false)
                openInStage(p)
              }}
              root={root}
              active={searchOpen}
            />
          </div>
        </div>
      )}

      {/* Trash / Checkpoints / SaveSnapshot each render their OWN modal backdrop —
          reused verbatim from the legacy, gated on local open-state. */}
      {trashOpen && (
        <TrashView onClose={() => setTrashOpen(false)} onChange={refresh} />
      )}
      {checkpointsOpen && (
        <CheckpointsView onClose={() => setCheckpointsOpen(false)} onChange={refresh} />
      )}
      {snapshotDialogOpen && (
        <SaveSnapshotDialog onClose={() => setSnapshotDialogOpen(false)} onSave={saveSnapshot} />
      )}

      {/* Self-hides when there's no update — same as the legacy layout. */}
      <UpdateBanner />
    </div>
  )
}
