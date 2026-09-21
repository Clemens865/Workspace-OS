import { useSettings } from '../../hooks/useSettings'
import { useState, useCallback, useRef, useEffect } from 'react'
import { findCommand, COMMANDS } from './slashCommands'
import { sessionStore, newConversationId } from './sessionStore'
import { reviewStore } from '../Review/reviewStore'
import { activityStore } from '../Review/activityStore'
import { emptyLedger, recordRun, type SessionLedger } from './budgetLedger'
import { claimRun, settleRun, steerTarget } from './codexSteer'
import type { AgentTermHandle } from './AgentXterm'
import type { RunArtifact } from '../../types/workspace-api'

/** A run's classified output files, kept together so cards group by run. */
export interface RunArtifactGroup {
  runId: string
  items: RunArtifact[]
}

const MAX_ARTIFACT_GROUPS = 8

const newRunId = (): string => `run-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

const HISTORY_KEY = 'workspace-os:terminal-history'
const HISTORY_MAX = 200

function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

/** Full = edits + shell allowed, destructive commands denied (skills work). Safe = read + generate only. */
export type AgentMode = 'full' | 'safe'

export type SessionStatus = 'idle' | 'running' | 'error'

// ANSI dressings for the xterm viewport (convertEol handles \n → \r\n).
const fmtInput = (t: string): string => `\r\n\x1b[38;5;75m›\x1b[0m \x1b[1m${t}\x1b[0m\r\n`
const fmtSystem = (t: string): string => `\x1b[90m${t}\x1b[0m\r\n`
const fmtError = (t: string): string => `\x1b[38;5;209m${t}\x1b[0m\r\n`

const WELCOME =
  'Agent ready — this is an AI console, not a shell.\n' +
  "Just type your request (e.g. \"summarize the open file\"); you don't need to type `claude`.\n" +
  'Type /help for commands.'

export interface AgentSession {
  /** AgentXterm calls this once with its write handle. */
  attachTerminal: (h: AgentTermHandle) => void
  history: string[]
  status: SessionStatus
  runningCount: number
  lastExitCode: number | null
  lastPrompt: string | null
  canRevert: boolean
  /** Pre-run checkpoint of the last run — the DiffSheet's revert preview target. */
  lastCheckpointId: string | null
  reverted: boolean
  mode: AgentMode
  setMode: (m: AgentMode) => void
  /** Per-session model alias ('' = inherit Settings → Agent model). */
  model: string
  setModel: (m: string) => void
  agentName: string | null
  setAgentName: (n: string | null) => void
  /** Running per-session cost/turn totals parsed from stream-json result events. */
  ledger: SessionLedger
  /** Classified output files from recent runs (newest run first) → artifact cards. */
  artifacts: RunArtifactGroup[]
  submit: (raw: string) => void
  cancelAll: () => void
  rerun: () => void
  revertLast: () => Promise<void>
}

/**
 * One agent conversation bound to one xterm viewport. Output chunks stream
 * straight into xterm (constant-time appends, ring-buffered scrollback) and
 * into the persisted transcript, replacing the old grow-forever React line
 * array. The conversation id is stable and persisted so the main process can
 * `--resume` the claude session across app restarts.
 */
export function useAgentSession(
  sessionId: string,
  activeFile: string | null,
  contextFiles: string[],
  onWorkspaceChanged: () => void,
  onStatusChange?: (status: SessionStatus) => void
): AgentSession {
  const settings = useSettings()
  const record = sessionStore.get(sessionId)
  const [history, setHistory] = useState<string[]>(loadHistory)
  const [runningRunIds, setRunningRunIds] = useState<string[]>([])
  const [mode, setModeState] = useState<AgentMode>(record?.mode ?? 'full')
  const [agentName, setAgentNameState] = useState<string | null>(record?.agentName ?? null)
  const [model, setModelState] = useState<string>(record?.model ?? '')
  const [lastPrompt, setLastPrompt] = useState<string | null>(record?.lastPrompt ?? null)
  const [lastRun, setLastRun] = useState<{
    checkpointId: string | null
    code: number | null
    reverted: boolean
  } | null>(null)
  const [ledger, setLedger] = useState<SessionLedger>(emptyLedger)
  const [artifacts, setArtifacts] = useState<RunArtifactGroup[]>([])

  // Keep latest context in refs so the IPC listeners (set up once) read fresh values.
  const ctxRef = useRef({ activeFile, contextFiles, mode, agentName, model })
  ctxRef.current = { activeFile, contextFiles, mode, agentName, model }

  // Stable per-session conversation; /clear starts a fresh one (persisted).
  const convoRef = useRef(record?.conversationId ?? newConversationId())
  // Runs started by THIS session — the IPC events are broadcast to every tab.
  const ownedRuns = useRef(new Set<string>())
  const ownedCodexRuns = useRef(new Set<string>())

  const termRef = useRef<AgentTermHandle | null>(null)
  const pendingRef = useRef('')
  // Snapshot at mount: replayed into xterm once it attaches.
  const initialTranscriptRef = useRef(record?.transcript ?? '')

  /** Writes to the viewport (buffering until it mounts) and the transcript. */
  const write = useCallback(
    (text: string, persist = true): void => {
      if (!text) return
      if (persist) sessionStore.appendTranscript(sessionId, text)
      if (termRef.current) termRef.current.write(text)
      else pendingRef.current += text
    },
    [sessionId]
  )

  const attachTerminal = useCallback((h: AgentTermHandle): void => {
    termRef.current = h
    const initial = initialTranscriptRef.current
    initialTranscriptRef.current = ''
    if (initial) {
      h.write(initial)
      h.write(fmtSystem('── session restored — the conversation resumes where it left off ──'))
    }
    if (pendingRef.current) {
      h.write(pendingRef.current)
      pendingRef.current = ''
    }
  }, [])

  // Fresh sessions get the welcome banner (restored ones already carry theirs).
  const welcomedRef = useRef(false)
  useEffect(() => {
    if (welcomedRef.current) return
    welcomedRef.current = true
    if (!initialTranscriptRef.current && !sessionStore.get(sessionId)?.transcript) {
      write(fmtSystem(WELCOME))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finishRun = useCallback((runId: string, code: number | null, checkpointId: string | null) => {
    ownedCodexRuns.current.delete(runId)
    setRunningRunIds((prev) => prev.filter((r) => r !== runId))
    setLastRun({ checkpointId, code, reverted: false })
  }, [])

  useEffect(() => {
    const offOutput = window.workspace.agent.onOutput((runId, chunk) => {
      if (ownedRuns.current.has(runId)) write(chunk)
    })
    const offDone = window.workspace.agent.onDone((runId, code, checkpointId) => {
      if (!ownedRuns.current.has(runId)) return
      if (code !== 0) write(fmtError(`[agent exited with code ${code}]`))
      finishRun(runId, code, checkpointId)
      // The run is no longer live — drop its "what it's doing now" line.
      activityStore.clear(runId)
      // Move the run from 'running' to a reviewable state in the Review feed.
      reviewStore.patchRun(runId, { status: code === 0 ? 'pending' : 'error', code, checkpointId })
    })
    // Capture the LATEST live activity per run (the cockpit's "deep-reading
    // notion.so" line). Free: rides the same stream, no extra tokens.
    const offActivity = window.workspace.agent.onActivity((runId, activity) => {
      if (!ownedRuns.current.has(runId)) return
      activityStore.record(runId, activity)
    })
    const offArtifact = window.workspace.agent.onArtifact((runId, filePath) => {
      if (!ownedRuns.current.has(runId)) return
      const name = filePath.split('/').pop() ?? filePath
      write(fmtSystem(`Created and opened ${name}`))
    })
    // The classified full set for this run → artifact cards (newest run first).
    const offArtifacts = window.workspace.agent.onArtifacts((runId, items) => {
      if (!ownedRuns.current.has(runId) || items.length === 0) return
      setArtifacts((prev) =>
        [{ runId, items }, ...prev.filter((g) => g.runId !== runId)].slice(0, MAX_ARTIFACT_GROUPS)
      )
      reviewStore.patchRun(runId, {
        artifacts: items.map((a) => ({ path: a.path, name: a.name, type: a.type })),
      })
    })
    // Fold each run's cost/turns into the session ledger (the dim trailer still
    // prints; this is the header total) and onto the run's Review card.
    const offMeta = window.workspace.agent.onRunMeta((runId, meta) => {
      if (!ownedRuns.current.has(runId)) return
      setLedger((l) => recordRun(l, meta))
      reviewStore.patchRun(runId, meta)
    })
    return () => {
      offOutput()
      offDone()
      offArtifact()
      offArtifacts()
      offMeta()
      offActivity()
    }
  }, [write, finishRun])

  const [personaModel, setPersonaModel] = useState<string>('')
  useEffect(() => {
    let current = true
    setPersonaModel('')
    if (agentName) void window.workspace.agents.read(agentName).then((a) => { if (current) setPersonaModel(a?.model ?? '') }).catch(() => {})
    return () => { current = false }
  }, [agentName])
  // Discover available provider skills so they can be invoked as /commands.
  const skillsRef = useRef<{ name: string; description: string }[]>([])
  useEffect(() => {
    window.workspace.skills.list(model || personaModel || settings.agentModel).then((s) => { skillsRef.current = s }).catch(() => { skillsRef.current = [] })
  }, [model, personaModel, settings.agentModel])

  const recordHistory = useCallback((cmd: string) => {
    setHistory((prev) => {
      const next = [...prev.filter((c) => c !== cmd), cmd].slice(-HISTORY_MAX)
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const startAgentRun = useCallback(
    (prompt: string, rawInput: string) => {
      // Steering is handled only by a live Codex run. Claude retains its existing
      // ability to launch concurrent prompt runs.
      const existing = steerTarget(ownedCodexRuns.current, runningRunIds)
      if (existing) {
        void window.workspace.codex.steer(existing, prompt).then((ok) => {
          if (!ok) write(fmtError('Codex is still starting. Try again once its turn begins.'))
        }).catch((e) => write(fmtError(e.message)))
        return
      }
      const runId = newRunId()
      ownedRuns.current.add(runId)
      claimRun(ownedCodexRuns.current, runId, ctxRef.current.model || personaModel || settings.agentModel)
      setRunningRunIds((prev) => [...prev, runId])
      setLastPrompt(rawInput)
      sessionStore.update(sessionId, { lastPrompt: rawInput })
      const { activeFile: file, contextFiles: ctxFiles, mode: m, agentName: an, model: mdl } = ctxRef.current
      // Open the run in the Review feed as 'running'; it becomes reviewable on done.
      reviewStore.openRun({
        runId,
        sessionId,
        sessionName: sessionStore.get(sessionId)?.name ?? 'Agent',
        prompt: rawInput,
        mode: m,
        agentName: an,
        // Lane key: one lane per agent session (parent_tool_use_id isn't
        // surfaced to the renderer, so the session id is the honest key).
        agentId: sessionId,
      })
      // The open file is sent separately (it grounds the system prompt); dropped
      // files remain plain context.
      window.workspace.agent
        .run(runId, prompt, ctxFiles, file, m, an, convoRef.current, mdl || null)
        .then((result) => settleRun(ownedCodexRuns.current, runId, result.provider))
        .catch((err: Error) => {
          ownedCodexRuns.current.delete(runId)
          write(fmtError(`[error] ${err.message}`))
          finishRun(runId, null, null)
        })
    },
    [sessionId, write, finishRun, runningRunIds, personaModel, settings.agentModel]
  )

  const submit = useCallback(
    (raw: string) => {
      const input = raw.trim()
      if (!input) return
      recordHistory(input)
      write(fmtInput(input))

      if (input.startsWith('/')) {
        const [name, ...rest] = input.slice(1).split(' ')
        const args = rest.join(' ')

        // `/skills` lists discovered Claude skills.
        if (name === 'skills') {
          const list = skillsRef.current
          write(
            fmtSystem(
              list.length
                ? 'Available skills (invoke with /<name>):\n' +
                    list.map((s) => `  /${s.name} — ${s.description || ''}`).join('\n')
                : 'No skills found.'
            )
          )
          return
        }

        const command = findCommand(name)

        // A discovered skill invoked directly as /<skill-name>.
        if (!command && skillsRef.current.some((s) => s.name === name)) {
          startAgentRun(`Use the "${name}" skill.${args ? ' ' + args : ''}`, input)
          return
        }

        if (!command) {
          write(fmtError(`Unknown command: /${name}. Type /help or /skills.`))
          return
        }
        if (command.runLocal) {
          const result = command.runLocal(args, ctxRef.current)
          if (result.kind === 'clear') {
            termRef.current?.clear()
            convoRef.current = newConversationId() // /clear starts a fresh conversation
            sessionStore.update(sessionId, { transcript: '', conversationId: convoRef.current })
          } else if (result.kind === 'status') {
            write(
              fmtSystem(
                runningRunIds.length
                  ? `${runningRunIds.length} agent(s) running.`
                  : 'No agents running.'
              )
            )
          } else {
            write(fmtSystem(result.text))
          }
          return
        }
        if (command.buildPrompt) {
          startAgentRun(command.buildPrompt(args, ctxRef.current), input)
        }
        return
      }

      // Bare text → ask the agent directly.
      startAgentRun(input, input)
    },
    [recordHistory, write, startAgentRun, runningRunIds.length, sessionId]
  )

  const cancelAll = useCallback(() => {
    for (const runId of runningRunIds) {
      window.workspace.agent.cancel(runId)
    }
    if (runningRunIds.length) write(fmtSystem('[stopped]'))
    setRunningRunIds([])
  }, [runningRunIds, write])

  const rerun = useCallback(() => {
    if (lastPrompt) submit(lastPrompt)
  }, [lastPrompt, submit])

  const revertLast = useCallback(async () => {
    if (!lastRun?.checkpointId || lastRun.reverted) return
    await window.workspace.checkpoint.rollback(lastRun.checkpointId)
    setLastRun((prev) => (prev ? { ...prev, reverted: true } : prev))
    write(fmtSystem('Reverted to the state before the last agent run.'))
    onWorkspaceChanged()
  }, [lastRun, write, onWorkspaceChanged])

  const setModel = useCallback(
    (m: string) => {
      setModelState(m)
      sessionStore.update(sessionId, { model: m })
    },
    [sessionId]
  )
  const setMode = useCallback(
    (m: AgentMode) => {
      setModeState(m)
      sessionStore.update(sessionId, { mode: m })
    },
    [sessionId]
  )

  const setAgentName = useCallback(
    (n: string | null) => {
      setAgentNameState(n)
      sessionStore.update(sessionId, { agentName: n })
    },
    [sessionId]
  )

  const status: SessionStatus =
    runningRunIds.length > 0
      ? 'running'
      : lastRun && lastRun.code !== null && lastRun.code !== 0
        ? 'error'
        : 'idle'

  const onStatusChangeRef = useRef(onStatusChange)
  onStatusChangeRef.current = onStatusChange
  useEffect(() => {
    onStatusChangeRef.current?.(status)
  }, [status])

  return {
    attachTerminal,
    history,
    status,
    runningCount: runningRunIds.length,
    lastExitCode: lastRun?.code ?? null,
    lastPrompt,
    canRevert: Boolean(lastRun?.checkpointId && !lastRun.reverted && status !== 'running'),
    lastCheckpointId: lastRun?.checkpointId ?? null,
    reverted: lastRun?.reverted ?? false,
    mode,
    setMode,
    model,
    setModel,
    agentName,
    setAgentName,
    ledger,
    artifacts,
    submit,
    cancelAll,
    rerun,
    revertLast,
  }
}

export { COMMANDS }
