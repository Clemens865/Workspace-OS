import { useState, useEffect, useCallback } from 'react'
import { useAgentSession, type SessionStatus } from './useAgentSession'
import { useAgentMenu } from '../../hooks/useAgentMenu'
import { TerminalInput } from './TerminalInput'
import { NewAgentForm } from './NewAgentForm'
import { AgentXterm } from './AgentXterm'
import { AgentPtySession } from './AgentPtySession'
import { ArtifactCards } from './ArtifactCards'
import { sessionStore } from './sessionStore'
import { formatLedger } from './budgetLedger'
import { DiffSheet } from '../Checkpoints/DiffSheet'
import styles from './TerminalSession.module.css'
import { useAgentModels } from '../../lib/agentModels'

interface AgentOption { name: string; mode?: 'full' | 'safe'; model?: string }

interface TerminalSessionProps {
  /** Persisted session this tab renders (see sessionStore). */
  sessionId: string
  activeFile: string | null
  onWorkspaceChanged: () => void
  /** Opens an artifact card's file in the Canvas (the existing tab-open path). */
  onOpenFile: (path: string) => void
  /** True when this is the visible agent tab — it then drives the Agent menu. */
  active?: boolean
  /** Reports running/idle/error so the tab strip can show a status dot. */
  onStatusChange?: (status: SessionStatus) => void
}

function basename(p: string): string {
  return p.split('/').pop() ?? p
}

/**
 * One agent session: an xterm viewport (ANSI, scrollback, ⌘F search, links)
 * with the smart input bar and run affordances (stop / rerun / revert) docked
 * beneath it — terminal-exact behavior in a nicer skin.
 */
export function TerminalSession({
  sessionId,
  activeFile,
  onWorkspaceChanged,
  onOpenFile,
  active = true,
  onStatusChange,
}: TerminalSessionProps): JSX.Element {
  const agentModels = useAgentModels()
  const [contextFiles, setContextFiles] = useState<string[]>([])
  // Which broker drives this session. Default 'prompt' keeps the shipped -p
  // console; switching to 'pty' mounts the interactive claude session instead.
  const [runMode, setRunMode] = useState<'prompt' | 'pty'>(
    () => sessionStore.get(sessionId)?.runMode ?? 'prompt'
  )
  const switchRunMode = useCallback((next: 'prompt' | 'pty') => {
    setRunMode(next)
    sessionStore.update(sessionId, { runMode: next })
  }, [sessionId])

  const session = useAgentSession(sessionId, activeFile, contextFiles, onWorkspaceChanged, onStatusChange)
  const {
    attachTerminal, history, status, runningCount, lastExitCode, lastPrompt,
    canRevert, lastCheckpointId, reverted, mode, setMode, agentName, setAgentName,
    ledger, artifacts, submit, cancelAll, rerun, revertLast,
  } = session
  const budget = formatLedger(ledger)
  const [isDragOver, setIsDragOver] = useState(false)
  // Revert is never blind: the button opens a DiffSheet preview; the actual
  // rollback happens from its confirm action.
  const [revertPreviewOpen, setRevertPreviewOpen] = useState(false)
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [showNewAgent, setShowNewAgent] = useState(false)

  const loadAgents = useCallback(() => {
    window.workspace.agents.list().then((a) => setAgents(a.map((x) => ({ name: x.name, mode: x.mode, model: x.model })))).catch(() => {})
  }, [])
  useEffect(() => loadAgents(), [loadAgents])

  // Selecting an agent also adopts its default mode.
  const selectAgent = useCallback((name: string | null) => {
    setAgentName(name)
    if (name) {
      const a = agents.find((x) => x.name === name)
      if (a?.mode) setMode(a.mode)
    }
  }, [agents, setAgentName, setMode])

  const onPickAgent = useCallback((value: string) => {
    if (value === '__new__') { setShowNewAgent(true); return }
    selectAgent(value === '' ? null : value)
  }, [selectAgent])

  // The active agent tab drives the native Agent menu.
  useAgentMenu({
    active,
    mode,
    setMode,
    agentName,
    selectAgent,
    agents,
    model: session.model || agents.find((a) => a.name === agentName)?.model,
    onRunSkill: (name) => submit(`Use the "${name}" skill.`),
    onNewAgent: () => setShowNewAgent(true),
  })

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const dropped = e.dataTransfer.getData('text/plain')
    if (dropped) {
      setContextFiles((prev) => (prev.includes(dropped) ? prev : [...prev, dropped]))
    }
  }, [])

  const removeContext = useCallback((path: string) => {
    setContextFiles((prev) => prev.filter((p) => p !== path))
  }, [])

  // Broker v2: the interactive PTY claude session is a self-contained view (its
  // own xterm + HITL gate). All hooks above still run so hook order is stable;
  // the -p listeners simply stay idle while this mode is active.
  if (runMode === 'pty') {
    return <AgentPtySession sessionId={sessionId} model={session.model || agents.find((a) => a.name === agentName)?.model} agentName={agentName} mode={mode} activeFile={activeFile} onSwitchToPrompt={() => switchRunMode('prompt')} />
  }

  return (
    <div
      className={`${styles.root} ${isDragOver ? styles.dragOver : ''}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      <AgentXterm onReady={attachTerminal} />

      <ArtifactCards groups={artifacts} onOpen={onOpenFile} />

      <div className={styles.contextBar}>
        <select
          className={styles.agentSelect}
          value={agentName ?? ''}
          onChange={(e) => onPickAgent(e.target.value)}
          title="Active agent persona"
        >
          <option value="">Default agent</option>
          {agents.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
          <option value="__new__">＋ New agent…</option>
        </select>
        <button
          className={styles.modeToggle}
          onClick={() => setMode(mode === 'full' ? 'safe' : 'full')}
          title={
            mode === 'full'
              ? 'Full mode: file edits + shell commands (skills work); destructive commands are blocked. Click for Safe mode.'
              : 'Safe mode: read + generate documents only, no arbitrary commands. Click for Full mode.'
          }
        >
          {mode === 'full' ? '⚡ Full' : '🛡 Safe'}
        </button>

        <select
          className={styles.agentSelect}
          value={session.model}
          onChange={(e) => session.setModel(e.target.value)}
          title="Model for this session's runs (aliases follow the latest generation); Default = Settings → Agent model"
          data-testid="model-pick"
        >
          {agentModels.map((m) => <option key={m.id} value={m.id}>{m.id ? m.label : 'Model: default'}</option>)}
        </select>

        <button
          className={styles.modeToggle}
          onClick={() => switchRunMode('pty')}
          title="Switch to an interactive claude session with native permission prompts (broker v2)"
        >
          ⌨ Interactive
        </button>

        <span className={styles.statusArea} data-status={status}>
          {status === 'running' && <span className={styles.statusRunning}>● running{runningCount > 1 ? ` ×${runningCount}` : ''}</span>}
          {status === 'error' && <span className={styles.statusError}>exit {lastExitCode}</span>}
          {budget && <span className={styles.budget} title="Cost and turns this session">{budget}</span>}
        </span>

        {status === 'running' && (
          <button className={styles.cancel} onClick={cancelAll}>
            ■ Stop{runningCount > 1 ? ` (${runningCount})` : ''}
          </button>
        )}
        {status !== 'running' && lastPrompt && (
          <button className={styles.actionBtn} onClick={rerun} title={`Re-run: ${lastPrompt}`}>
            ↻ Rerun
          </button>
        )}
        {canRevert && (
          <button
            className={styles.actionBtn}
            onClick={() => setRevertPreviewOpen(true)}
            title="Preview what the last agent run changed, then undo it"
          >
            ↩ Revert last run
          </button>
        )}
        {reverted && <span className={styles.revertedTag}>✓ reverted</span>}

        {contextFiles.map((path) => (
          <span key={path} className={styles.chip} title={path}>
            {basename(path)}
            <button className={styles.chipRemove} onClick={() => removeContext(path)}>×</button>
          </span>
        ))}
      </div>

      <TerminalInput history={history} onSubmit={submit} />

      {showNewAgent && (
        <NewAgentForm
          onClose={() => setShowNewAgent(false)}
          onSaved={(name) => { loadAgents(); setAgentName(name) }}
        />
      )}

      {revertPreviewOpen && lastCheckpointId && (
        <DiffSheet
          checkpointId={lastCheckpointId}
          title="the last agent run"
          onClose={() => setRevertPreviewOpen(false)}
          onRevert={revertLast}
        />
      )}
    </div>
  )
}
