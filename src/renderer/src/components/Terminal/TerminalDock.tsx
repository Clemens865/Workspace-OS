import { useState, useCallback, useRef, useEffect } from 'react'
import { Plus, TerminalSquare, Sparkles } from 'lucide-react'
import { useSettings } from '../../hooks/useSettings'
import { NewAgentForm } from '../AgentTerminal/NewAgentForm'
import { TerminalShellPane } from './TerminalShellPane'
import { TerminalAgentPane } from './TerminalAgentPane'
import { actionsForSurface } from './surfaceActions'
import styles from './TerminalDock.module.css'

export interface DockContext {
  root: string | null
  surface: string | null
  openFile: string | null
  folder: string | null
}

interface TerminalDockProps {
  /** Live workspace harness — shown in the context chip + passed to agent tabs. */
  context: DockContext
  /** Bumped by the shell when the dock's size changes so xterm re-fits. */
  resizeSignal: number
  /** A specialist name to open as a fresh agent tab (from a roster "Run"). */
  launchAgent?: string | null
  /** Called once the launchAgent tab has been opened, so the shell can clear it. */
  onAgentLaunched?: () => void
  /** Opens a run deliverable in the editor (trace file chips). */
  onOpenFile?: (path: string) => void
}

/** One entry the agent list surfaces (name + one-line description). */
interface AgentSummary {
  name: string
  description: string
  scope: 'global' | 'project'
  mode?: 'full' | 'safe'
}

type TabKind = 'shell' | 'agent'
interface DockTab {
  id: string
  kind: TabKind
  /** For agent tabs: the persona this tab runs as (undefined = default assistant). */
  agentName?: string
}

let seq = 0
const nextId = (kind: TabKind): string => `${kind}-${Date.now()}-${seq++}`

const baseName = (p: string | null): string | null => (p ? p.split('/').pop() ?? p : null)

/**
 * The Integrated Terminal Dock — tabs of two kinds (real SHELL + AGENT), a
 * `+` menu, per-tab close, a bottom|right placement control bound to Settings,
 * and an always-visible context chip showing the live harness. Lives only in
 * the new WorkspaceShell; additive and flag-gated.
 */
export function TerminalDock({ context, resizeSignal, launchAgent, onAgentLaunched, onOpenFile }: TerminalDockProps): JSX.Element {
  const settings = useSettings()
  const [tabs, setTabs] = useState<DockTab[]>(() => [{ id: nextId('shell'), kind: 'shell' }])
  const [active, setActive] = useState<string>(() => tabs[0]?.id ?? '')
  const [menuOpen, setMenuOpen] = useState(false)
  // Expands the "New agent" branch of the + menu into the persona picker.
  const [agentPickerOpen, setAgentPickerOpen] = useState(false)
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [showNewAgent, setShowNewAgent] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Ensure there's always an active tab.
  useEffect(() => {
    if (tabs.length && !tabs.some((t) => t.id === active)) setActive(tabs[tabs.length - 1].id)
  }, [tabs, active])

  const loadAgents = useCallback(() => {
    window.workspace.agents
      .list()
      .then(setAgents)
      .catch(() => {
        /* best-effort — an empty list still offers Default + Create */
      })
  }, [])
  useEffect(() => loadAgents(), [loadAgents])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setAgentPickerOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const closeMenu = useCallback(() => {
    setMenuOpen(false)
    setAgentPickerOpen(false)
  }, [])

  const addShell = useCallback(() => {
    const tab: DockTab = { id: nextId('shell'), kind: 'shell' }
    setTabs((prev) => [...prev, tab])
    setActive(tab.id)
    closeMenu()
  }, [closeMenu])

  const addAgent = useCallback(
    (agentName?: string) => {
      const tab: DockTab = { id: nextId('agent'), kind: 'agent', agentName }
      setTabs((prev) => [...prev, tab])
      setActive(tab.id)
      closeMenu()
    },
    [closeMenu],
  )

  // A roster "Run" asks the dock to open a fresh agent tab bound to that
  // specialist. Handled here (not the picker) so it works even on first mount.
  useEffect(() => {
    if (!launchAgent) return
    addAgent(launchAgent)
    onAgentLaunched?.()
  }, [launchAgent, addAgent, onAgentLaunched])

  // Freshen the persona list whenever the picker opens (so newly created ones show).
  const openAgentPicker = useCallback(() => {
    loadAgents()
    setAgentPickerOpen(true)
  }, [loadAgents])

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const setPlacement = (p: 'bottom' | 'right'): void => settings.set('terminalPlacement', p)

  // The current surface's quick actions (data-driven, office-only gated).
  const actions = actionsForSurface(context)
  const [runningId, setRunningId] = useState<string | null>(null)
  const runAction = useCallback(
    async (id: string): Promise<void> => {
      const action = actions.find((a) => a.id === id)
      if (!action) return
      setRunningId(id)
      try {
        const result = await action.run(context)
        /**
         * An action may hand back a line for the terminal.
         *
         * Typed, NEVER submitted: a button that presses Enter in someone's
         * shell is putting words in their session, and they may want to edit
         * the line first. Only shell tabs — an agent pane is not a pty.
         */
        const insert = (result as { insert?: unknown } | undefined)?.insert
        if (typeof insert === 'string' && insert) {
          const target = tabs.find((t) => t.id === active && t.kind === 'shell')
          if (target) await window.workspace.terminal.write(target.id, insert)
        }
      } catch {
        /* best-effort — an action failing must not wedge the dock */
      } finally {
        setRunningId(null)
      }
    },
    [actions, context, tabs, active],
  )

  const chip = (
    <div className={styles.chip} data-testid="terminal-context-chip">
      <span className={styles.chipDot} />
      <span className={styles.chipItem}>{baseName(context.root) ?? 'no workspace'}</span>
      {context.surface && (
        <>
          <span className={styles.chipSep}>·</span>
          <span className={styles.chipItem}>{context.surface}</span>
        </>
      )}
      {context.openFile && (
        <>
          <span className={styles.chipSep}>·</span>
          <span className={styles.chipItem}>{baseName(context.openFile)}</span>
        </>
      )}
    </div>
  )

  return (
    <div
      className={`${styles.root} ${settings.terminalPlacement === 'right' ? styles.right : styles.bottom}`}
      data-testid="terminal-dock"
    >
      <div className={styles.strip}>
        {/* Tabs scroll horizontally in their OWN container so the strip itself
            doesn't establish a clipping context that would cut off the + menu. */}
        <div className={styles.tabScroll}>
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`${styles.tab} ${active === t.id ? styles.tabOn : ''}`}
            onClick={() => setActive(t.id)}
            title={t.kind === 'agent' ? `Agent: ${t.agentName ?? 'assistant'}` : 'Shell tab'}
          >
            <span className={styles.tabLabel}>
              {t.kind === 'agent' ? (
                <>
                  {t.agentName ?? 'assistant'} <span className={styles.agentMark}>✦</span>
                </>
              ) : (
                'zsh'
              )}
            </span>
            <span
              className={styles.tabClose}
              onClick={(e) => {
                e.stopPropagation()
                closeTab(t.id)
              }}
              title="Close tab"
            >
              ×
            </span>
          </button>
        ))}
        </div>

        <div className={styles.plusWrap} ref={menuRef}>
          <button
            className={styles.iconBtn}
            onClick={() => {
              setMenuOpen((v) => !v)
              setAgentPickerOpen(false)
            }}
            title="New tab"
            data-testid="terminal-new"
          >
            <Plus size={15} />
          </button>
          {menuOpen && !agentPickerOpen && (
            <div className={styles.menu}>
              <button className={styles.menuItem} onClick={addShell}>
                <TerminalSquare size={14} /> New terminal
              </button>
              <button className={styles.menuItem} onClick={openAgentPicker} data-testid="terminal-new-agent">
                <Sparkles size={14} /> New agent
              </button>
            </div>
          )}
          {menuOpen && agentPickerOpen && (
            <div className={`${styles.menu} ${styles.agentMenu}`} data-testid="agent-picker">
              <button
                className={styles.menuItem}
                onClick={() => addAgent(undefined)}
                data-testid="agent-item-default"
              >
                <Sparkles size={14} /> Default assistant
              </button>
              {agents.map((a) => (
                <button
                  key={`${a.scope}:${a.name}`}
                  className={styles.menuItem}
                  onClick={() => addAgent(a.name)}
                  title={a.description || a.name}
                  data-testid={`agent-item-${a.name}`}
                >
                  <span className={styles.agentMark}>✦</span> {a.name}
                </button>
              ))}
              <div className={styles.menuSep} />
              <button
                className={styles.menuItem}
                onClick={() => {
                  closeMenu()
                  setShowNewAgent(true)
                }}
                data-testid="agent-item-create"
              >
                <Plus size={14} /> Create agent…
              </button>
            </div>
          )}
        </div>

        <span className={styles.spacer} />

        <div className={styles.seg} title="Dock placement">
          <button
            className={`${styles.segBtn} ${settings.terminalPlacement === 'bottom' ? styles.segOn : ''}`}
            onClick={() => setPlacement('bottom')}
          >
            Bottom
          </button>
          <button
            className={`${styles.segBtn} ${settings.terminalPlacement === 'right' ? styles.segOn : ''}`}
            onClick={() => setPlacement('right')}
          >
            Right
          </button>
        </div>
      </div>

      {chip}

      {actions.length > 0 && (
        <div className={styles.actions} data-testid="terminal-quick-actions">
          {actions.map((a) => {
            const Icon = a.icon
            return (
              <button
                key={a.id}
                className={`${styles.actionBtn} ${a.primary ? styles.actionPrimary : ''}`}
                onClick={() => runAction(a.id)}
                disabled={runningId === a.id}
                title={a.label}
                data-testid={`quick-action-${a.id}`}
              >
                <Icon size={13} strokeWidth={1.75} />
                {a.label}
              </button>
            )
          })}
        </div>
      )}

      <div className={styles.body}>
        {tabs.length === 0 ? (
          <div className={styles.empty}>Use the + to open a shell or an agent.</div>
        ) : (
          tabs.map((t) => (
            <div key={t.id} className={`${styles.pane} ${active === t.id ? '' : styles.hidden}`}>
              {t.kind === 'shell' ? (
                <TerminalShellPane
                  sessionId={t.id}
                  resizeSignal={resizeSignal}
                  active={active === t.id}
                  context={context}
                />
              ) : (
                <TerminalAgentPane sessionId={t.id} context={context} agentName={t.agentName} onOpenFile={onOpenFile} />
              )}
            </div>
          ))
        )}
      </div>

      {showNewAgent && (
        <NewAgentForm
          onClose={() => setShowNewAgent(false)}
          onSaved={(name) => {
            loadAgents()
            addAgent(name)
          }}
        />
      )}
    </div>
  )
}
