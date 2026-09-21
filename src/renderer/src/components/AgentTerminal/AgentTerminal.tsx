import { useState, useCallback, useEffect } from 'react'
import { TerminalSession } from './TerminalSession'
import { ShellTerminal } from './ShellTerminal'
import { sessionStore } from './sessionStore'
import type { SessionStatus } from './useAgentSession'
import { loadSettings } from '../../hooks/useSettings'
import { FLEET_LAUNCH_EVENT, type FleetLaunchDetail } from '../Review/useFleetLaunch'
import styles from './AgentTerminal.module.css'

interface AgentTerminalProps {
  focused: boolean
  onBlur: () => void
  activeFile: string | null
  onWorkspaceChanged: () => void
  /** Opens an artifact card's file in the Canvas. */
  onOpenFile: (path: string) => void
}

type TabKind = 'agent' | 'shell'

interface TabModel {
  /** Agent tabs use their persisted sessionId; shell tabs an ephemeral id. */
  id: string
  kind: TabKind
  name: string
}

let shellSeq = 1

/** Agent tabs restore from the persisted session store; shells start fresh. */
function initialTabs(): TabModel[] {
  const persisted = sessionStore.list()
  if (persisted.length > 0) {
    return persisted.map((s) => ({ id: s.sessionId, kind: 'agent' as const, name: s.name }))
  }
  const s = sessionStore.create({ mode: loadSettings().agentMode })
  return [{ id: s.sessionId, kind: 'agent', name: s.name }]
}

export function AgentTerminal({ focused, onBlur, activeFile, onWorkspaceChanged, onOpenFile }: AgentTerminalProps): JSX.Element {
  const [tabs, setTabs] = useState<TabModel[]>(initialTabs)
  const [activeId, setActiveId] = useState<string>(() => sessionStore.getActiveId() ?? '')
  const [statuses, setStatuses] = useState<Record<string, SessionStatus>>({})
  const [renamingId, setRenamingId] = useState<string | null>(null)

  // Fall back to the first tab if no (valid) active session was persisted.
  const effectiveActiveId = tabs.some((t) => t.id === activeId) ? activeId : tabs[0]?.id

  const selectTab = useCallback((tab: TabModel) => {
    setActiveId(tab.id)
    if (tab.kind === 'agent') sessionStore.setActive(tab.id)
  }, [])

  const addTab = useCallback((kind: TabKind) => {
    if (kind === 'agent') {
      const s = sessionStore.create({ mode: loadSettings().agentMode })
      setTabs((prev) => [...prev, { id: s.sessionId, kind, name: s.name }])
      setActiveId(s.sessionId)
      sessionStore.setActive(s.sessionId)
    } else {
      const id = `shell-${Date.now()}-${shellSeq++}`
      setTabs((prev) => [...prev, { id, kind, name: `Shell ${prev.filter((t) => t.kind === 'shell').length + 1}` }])
      setActiveId(id)
    }
  }, [])

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      if (prev.length === 1) return prev
      const tab = prev.find((t) => t.id === id)
      if (tab?.kind === 'agent') {
        // Drop the main-process conversation cache for this tab before removing
        // the session record — otherwise a closed tab's resume-id lingers in the
        // LRU map (and its persisted file) until the 50-entry cap rolls it off.
        const convoId = sessionStore.get(id)?.conversationId
        if (convoId) void window.workspace.agent.forgetConversation(convoId)
        sessionStore.remove(id)
      }
      const next = prev.filter((t) => t.id !== id)
      setActiveId((cur) => (cur === id ? next[next.length - 1].id : cur))
      return next
    })
    setStatuses((prev) => {
      const { [id]: _gone, ...rest } = prev
      return rest
    })
  }, [])

  const renameTab = useCallback((id: string, name: string) => {
    const trimmed = name.trim()
    setRenamingId(null)
    if (!trimmed) return
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, name: trimmed } : t)))
    if (sessionStore.get(id)) sessionStore.update(id, { name: trimmed })
  }, [])

  const onStatusChange = useCallback((id: string, status: SessionStatus) => {
    setStatuses((prev) => (prev[id] === status ? prev : { ...prev, [id]: status }))
  }, [])

  // The native Agent menu's "New Shell" dispatches this.
  useEffect(() => {
    const onNewShell = (): void => addTab('shell')
    window.addEventListener('wos:new-shell', onNewShell)
    return () => window.removeEventListener('wos:new-shell', onNewShell)
  }, [addTab])

  // The fleet cockpit's "Launch agent" creates the session record, then asks us
  // to open + activate its tab (its lane already exists in the review store).
  useEffect(() => {
    const onLaunch = (e: Event): void => {
      const { sessionId, name } = (e as CustomEvent<FleetLaunchDetail>).detail
      if (!sessionId) return
      setTabs((prev) =>
        prev.some((t) => t.id === sessionId) ? prev : [...prev, { id: sessionId, kind: 'agent', name }]
      )
      setActiveId(sessionId)
      sessionStore.setActive(sessionId)
    }
    window.addEventListener(FLEET_LAUNCH_EVENT, onLaunch)
    return () => window.removeEventListener(FLEET_LAUNCH_EVENT, onLaunch)
  }, [])

  return (
    <div className={styles.root} tabIndex={-1} onBlur={onBlur} data-focused={focused}>
      <div className={styles.header}>
        <div className={styles.tabs}>
          {tabs.map((tab) => {
            const status = statuses[tab.id] ?? 'idle'
            return (
              <div
                key={tab.id}
                className={`${styles.tab} ${tab.id === effectiveActiveId ? styles.activeTab : ''}`}
                onClick={() => selectTab(tab)}
                onDoubleClick={() => setRenamingId(tab.id)}
                title="Double-click to rename"
              >
                <span className={styles.tabIcon}>{tab.kind === 'agent' ? '✦' : '›_'}</span>
                {renamingId === tab.id ? (
                  <input
                    className={styles.renameInput}
                    defaultValue={tab.name}
                    autoFocus
                    onFocus={(e) => e.target.select()}
                    onBlur={(e) => renameTab(tab.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') renameTab(tab.id, e.currentTarget.value)
                      else if (e.key === 'Escape') setRenamingId(null)
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  tab.name
                )}
                {tab.kind === 'agent' && status !== 'idle' && (
                  <span className={`${styles.statusDot} ${status === 'running' ? styles.dotRunning : styles.dotError}`} />
                )}
                {tabs.length > 1 && (
                  <button
                    className={styles.tabClose}
                    onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                  >×</button>
                )}
              </div>
            )
          })}
        </div>

        {/* Quick buttons + dropdown live OUTSIDE the scrolling .tabs so the
            menu isn't clipped by its overflow. */}
        <div className={styles.actions}>
          <button className={styles.quickBtn} onClick={() => addTab('shell')} title="New shell">
            <span className={styles.menuIcon}>›_</span> Shell
          </button>
          <button className={styles.quickBtn} onClick={() => addTab('agent')} title="New AI agent">
            <span className={styles.menuIcon}>✦</span> Agent
          </button>
          <span className={styles.hint}>
            {activeFile ? activeFile.split('/').pop() : 'no file'} in context
          </span>
        </div>
      </div>

      <div className={styles.body}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={styles.sessionWrap}
            style={{ display: tab.id === effectiveActiveId ? 'flex' : 'none' }}
          >
            {tab.kind === 'agent' ? (
              <TerminalSession
                sessionId={tab.id}
                activeFile={activeFile}
                onWorkspaceChanged={onWorkspaceChanged}
                onOpenFile={onOpenFile}
                active={tab.id === effectiveActiveId}
                onStatusChange={(s) => onStatusChange(tab.id, s)}
              />
            ) : (
              <ShellTerminal sessionId={tab.id} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
