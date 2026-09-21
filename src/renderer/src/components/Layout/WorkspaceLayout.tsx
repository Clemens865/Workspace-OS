import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { FilePanel } from '../FilePanel/FilePanel'
import { Canvas } from '../Canvas/Canvas'
import { AgentTerminal } from '../AgentTerminal/AgentTerminal'
import { TrashView } from '../Trash/TrashView'
import { SettingsPanel } from '../Settings/SettingsPanel'
import { CommandBar } from '../CommandBar/CommandBar'
import { QuickOpen } from '../QuickOpen/QuickOpen'
import { SearchPanel } from '../SearchPanel/SearchPanel'
import { MemoryPanel } from '../MemoryPanel/MemoryPanel'
import { KnowledgePanel } from '../KnowledgePanel/KnowledgePanel'
import { ReviewRail } from '../Review/ReviewRail'
import { MailPanel } from '../Mail/MailPanel'
import { ReviewFeed } from '../Review/ReviewFeed'
import { CheckpointsView } from '../Checkpoints/CheckpointsView'
import { SaveSnapshotDialog } from '../Snapshots/SaveSnapshotDialog'
import { UpdateBanner } from '../Update/UpdateBanner'
import { TitleBar } from './TitleBar'
import { usePanelSizes } from '../../hooks/usePanelSizes'
import { useTabManager } from '../../hooks/useTabManager'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { useWorkspaceRoot } from '../../hooks/useWorkspaceRoot'
import { scopeKey } from '../../lib/workspaceScope'
import { useWorkspaceLibrary } from '../../hooks/useWorkspaceLibrary'
import { setTheme } from '../../hooks/useTheme'
import { loadTabSession, saveTabSession, pruneMissingTabs } from '../../lib/tabSession'
import styles from './WorkspaceLayout.module.css'

type SidebarView = 'files' | 'search' | 'memory' | 'knowledge' | 'review' | 'mail'

export function WorkspaceLayout(): JSX.Element {
  const { sizes, onFilePanelResize, onTerminalResize, applySizes } = usePanelSizes()
  const tabManager = useTabManager()
  const root = useWorkspaceRoot()
  const library = useWorkspaceLibrary(root)

  // All file-open paths (panel, palettes, search, drag) funnel through here, so
  // recents are recorded centrally regardless of how a file was opened.
  const openFile = useCallback((path: string) => {
    library.recordRecent(path)
    tabManager.openFile(path)
  }, [library, tabManager])
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [quickOpenOpen, setQuickOpenOpen] = useState(false)
  const [agentFocused, setAgentFocused] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [checkpointsOpen, setCheckpointsOpen] = useState(false)
  const [snapshotDialogOpen, setSnapshotDialogOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarView, setSidebarView] = useState<SidebarView>('files')
  const [terminalOpen, setTerminalOpen] = useState(true)
  // Bumped after a trash restore so the file tree re-reads from disk.
  const [refreshSignal, setRefreshSignal] = useState(0)

  const openSearchPanel = useCallback(() => {
    setSidebarOpen(true)
    setSidebarView('search')
  }, [])

  // ── Tab/session restore: reopen yesterday's desk exactly. Runs once, when
  // the root first loads, and only if this launch matches the persisted root
  // (a different folder starts clean). restoreTabs skips recents on purpose —
  // reopening isn't "using".
  const tabsRestoredRef = useRef(false)
  useEffect(() => {
    if (!root || tabsRestoredRef.current) return
    tabsRestoredRef.current = true
    const saved = loadTabSession(root)
    if (saved && saved.files.length > 0 && tabManager.tabs.length === 0) {
      // Reopen only what still EXISTS: a file deleted or moved outside the app
      // would otherwise return as a tab that fails to open, and re-persist
      // itself every launch. Listing failure → restore everything (unchanged
      // behaviour) rather than silently dropping the user's desk.
      void (async () => {
        let live = saved
        try {
          const existing = (await window.workspace.fs.listFiles()) as string[]
          live = pruneMissingTabs(saved, existing)
        } catch {
          /* listing unavailable — restore as saved */
        }
        if (live.files.length > 0) tabManager.restoreTabs(live.files, live.activeFile)
      })()
    }
  }, [root, tabManager])

  // Persist on every tab change — but never before the restore pass has run,
  // so the launch-time empty state can't clobber the saved desk.
  useEffect(() => {
    if (!root || !tabsRestoredRef.current) return
    saveTabSession({
      root,
      files: tabManager.tabs.map((t) => t.filePath),
      activeFile: tabManager.activeFilePath,
    })
  }, [root, tabManager.tabs, tabManager.activeFilePath])

  // ── Workspace snapshots (PRD MVP #10): capture/apply the whole desk.
  const saveSnapshot = useCallback(async (name: string) => {
    await window.workspace.snapshots.save(name, {
      files: tabManager.tabs.map((t) => t.filePath),
      activeFile: tabManager.activeFilePath,
      sidebarView,
      sidebarOpen,
      terminalOpen,
      panel: sizes,
    })
  }, [tabManager, sidebarView, sidebarOpen, terminalOpen, sizes])

  const restoreSnapshot = useCallback(async (id: string) => {
    const snap = (await window.workspace.snapshots.list()).find((s) => s.id === id)
    if (!snap) return
    tabManager.restoreTabs(snap.state.files, snap.state.activeFile)
    setSidebarView(snap.state.sidebarView)
    setSidebarOpen(snap.state.sidebarOpen)
    setTerminalOpen(snap.state.terminalOpen)
    if (snap.state.panel) applySizes(snap.state.panel)
  }, [tabManager, applySizes])

  const shortcutHandlers = useMemo(
    () => ({
      onCommandPalette: () => setCommandPaletteOpen((v) => !v),
      onQuickOpen: () => setQuickOpenOpen((v) => !v),
      onSearchPanel: openSearchPanel,
      onToggleSidebar: () => setSidebarOpen((v) => !v),
      onToggleTerminal: () => setTerminalOpen((v) => !v),
      onAgentFocus: () => setAgentFocused(true),
      onCloseTab: () => {
        if (tabManager.activeId) tabManager.closeTab(tabManager.activeId)
      },
      onNextTab: () => {
        const { tabs, activeId } = tabManager
        const index = tabs.findIndex((t) => t.id === activeId)
        const next = tabs[(index + 1) % tabs.length]
        if (next) tabManager.activateTab(next.id)
      },
      onPrevTab: () => {
        const { tabs, activeId } = tabManager
        const index = tabs.findIndex((t) => t.id === activeId)
        const prev = tabs[(index - 1 + tabs.length) % tabs.length]
        if (prev) tabManager.activateTab(prev.id)
      },
    }),
    [tabManager, openSearchPanel]
  )

  useKeyboardShortcuts(shortcutHandlers)

  // Route the native View/Go menu clicks (menu.ts) to the same handlers the
  // keyboard shortcuts use — one behavior, two entry points.
  useEffect(() => {
    return window.workspace.menu.onRunAction((id) => {
      if (id === 'go.quickopen') setQuickOpenOpen((v) => !v)
      else if (id === 'go.searchpanel') openSearchPanel()
      else if (id === 'go.tab:next') shortcutHandlers.onNextTab()
      else if (id === 'go.tab:prev') shortcutHandlers.onPrevTab()
      else if (id === 'go.tab:back') tabManager.goBack()
      else if (id === 'go.tab:forward') tabManager.goForward()
      else if (id === 'view.toggle:files') setSidebarOpen((v) => !v)
      else if (id === 'view.toggle:terminal') setTerminalOpen((v) => !v)
      else if (id === 'view.appearance:light') setTheme('light')
      else if (id === 'view.appearance:dark') setTheme('dark')
      else if (id === 'agent.checkpoints') setCheckpointsOpen(true)
      else if (id === 'snapshot.save') setSnapshotDialogOpen(true)
      else if (id.startsWith('snapshot.restore:')) void restoreSnapshot(id.slice('snapshot.restore:'.length))
    })
  }, [shortcutHandlers, openSearchPanel, tabManager, restoreSnapshot])

  // When the agent generates an office file, open it in the canvas and refresh
  // the tree so it shows up immediately.
  useEffect(() => {
    return window.workspace.agent.onArtifact((_runId, filePath) => {
      openFile(filePath)
      setRefreshSignal((n) => n + 1)
    })
  }, [openFile])

  const handleAgentBlur = useCallback(() => setAgentFocused(false), [])

  // The native Agent menu's "Focus Agent" dispatches this.
  useEffect(() => {
    const onFocus = (): void => setAgentFocused(true)
    window.addEventListener('wos:focus-agent', onFocus)
    return () => window.removeEventListener('wos:focus-agent', onFocus)
  }, [])

  return (
    <div className={styles.root}>
      <TitleBar
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onOpenCommand={() => setCommandPaletteOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        tabManager={tabManager}
      />
      <div className={styles.body}>
        {sidebarOpen && (
          <div className={styles.filePanel} style={{ width: sizes.filePanel }}>
            <div className={styles.sidebar}>
              <div className={styles.sideTabs}>
                <button
                  className={`${styles.sideTab} ${sidebarView === 'files' ? styles.sideTabActive : ''}`}
                  onClick={() => setSidebarView('files')}
                >
                  Files
                </button>
                <button
                  className={`${styles.sideTab} ${sidebarView === 'search' ? styles.sideTabActive : ''}`}
                  onClick={() => setSidebarView('search')}
                >
                  Search
                </button>
                <button
                  className={`${styles.sideTab} ${sidebarView === 'memory' ? styles.sideTabActive : ''}`}
                  onClick={() => setSidebarView('memory')}
                >
                  Memory
                </button>
                <button
                  className={`${styles.sideTab} ${sidebarView === 'knowledge' ? styles.sideTabActive : ''}`}
                  onClick={() => setSidebarView('knowledge')}
                >
                  Knowledge
                </button>
                <button
                  className={`${styles.sideTab} ${sidebarView === 'review' ? styles.sideTabActive : ''}`}
                  onClick={() => setSidebarView('review')}
                >
                  Review
                </button>
                <button
                  className={`${styles.sideTab} ${sidebarView === 'mail' ? styles.sideTabActive : ''}`}
                  onClick={() => setSidebarView('mail')}
                >
                  Mail
                </button>
              </div>
              {/* All stay mounted — the tree keeps its expansion, search its results. */}
              <div className={styles.sideView} style={{ display: sidebarView === 'files' ? 'flex' : 'none' }}>
                <FilePanel
                  onFileOpen={openFile}
                  onShowTrash={() => setTrashOpen(true)}
                  refreshSignal={refreshSignal}
                  library={library}
                />
              </div>
              <div className={styles.sideView} style={{ display: sidebarView === 'search' ? 'flex' : 'none' }}>
                <SearchPanel onFileOpen={openFile} root={root} active={sidebarView === 'search'} />
              </div>
              <div className={styles.sideView} style={{ display: sidebarView === 'memory' ? 'flex' : 'none' }}>
                <MemoryPanel active={sidebarView === 'memory'} />
              </div>
              <div className={styles.sideView} style={{ display: sidebarView === 'knowledge' ? 'flex' : 'none' }}>
                <KnowledgePanel
                  active={sidebarView === 'knowledge'}
                  activeFile={tabManager.activeFilePath}
                  onFileOpen={openFile}
                />
              </div>
              <div className={styles.sideView} style={{ display: sidebarView === 'review' ? 'flex' : 'none' }}>
                <ReviewRail />
              </div>
              <div className={styles.sideView} style={{ display: sidebarView === 'mail' ? 'flex' : 'none' }}>
                <MailPanel active={sidebarView === 'mail'} />
              </div>
            </div>
            <div className={styles.resizeHandleV} onMouseDown={onFilePanelResize} />
          </div>
        )}

        <div className={styles.main}>
          <div className={styles.canvas}>
            <Canvas
              tabManager={tabManager}
              library={library}
              onRefresh={() => setRefreshSignal((n) => n + 1)}
            />
            {/* The Review feed wants vertical space, so it overlays the canvas
                region (kept mounted underneath so LOK docs stay resident). */}
            {sidebarView === 'review' && (
              <ReviewFeed
                onOpenFile={openFile}
                onWorkspaceChanged={() => setRefreshSignal((n) => n + 1)}
              />
            )}
          </div>

          {/* Hidden (not unmounted) when collapsed — keeps xterm sessions alive. */}
          <div
            className={styles.terminal}
            style={terminalOpen ? { height: sizes.terminal } : { display: 'none' }}
          >
            <div className={styles.resizeHandleH} onMouseDown={onTerminalResize} />
            <AgentTerminal
              key={scopeKey(root)}
              focused={agentFocused}
              onBlur={handleAgentBlur}
              activeFile={tabManager.activeFilePath}
              onWorkspaceChanged={() => setRefreshSignal((n) => n + 1)}
              onOpenFile={openFile}
            />
          </div>
        </div>
      </div>

      {commandPaletteOpen && (
        <CommandBar
          onClose={() => setCommandPaletteOpen(false)}
          onOpenFile={openFile}
        />
      )}

      {quickOpenOpen && (
        <QuickOpen
          onClose={() => setQuickOpenOpen(false)}
          onOpenFile={openFile}
          recent={library.recent}
          root={root}
        />
      )}

      {trashOpen && (
        <TrashView
          onClose={() => setTrashOpen(false)}
          onChange={() => setRefreshSignal((n) => n + 1)}
        />
      )}

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}

      {checkpointsOpen && (
        <CheckpointsView
          onClose={() => setCheckpointsOpen(false)}
          onChange={() => setRefreshSignal((n) => n + 1)}
        />
      )}

      {snapshotDialogOpen && (
        <SaveSnapshotDialog onClose={() => setSnapshotDialogOpen(false)} onSave={saveSnapshot} />
      )}

      <UpdateBanner />
    </div>
  )
}
