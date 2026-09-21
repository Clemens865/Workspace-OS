import { useState, useRef, useEffect, useCallback } from 'react'
import { useSettings } from '../../hooks/useSettings'
import { agentActionsHint } from './surfaceActions'
import { reviewStore } from '../Review/reviewStore'
import { activityStore } from '../Review/activityStore'
import { RunTrace } from '../AgentTerminal/RunTrace'
import { appendStep, type TraceStep } from '../AgentTerminal/runTraceModel'
import { PromptBar } from '../PromptBar/PromptBar'
import styles from './TerminalDock.module.css'

interface HarnessContext {
  root: string | null
  surface: string | null
  openFile: string | null
  folder: string | null
}

interface Props {
  sessionId: string
  context: HarnessContext
  /** The persona this tab runs as (passed into agent.run's agentName slot). */
  agentName?: string
  /** Opens a run deliverable in the editor (a trace file chip was clicked). */
  onOpenFile?: (path: string) => void
}

type Msg = { role: 'user' | 'agent' | 'system'; text: string }

const newRunId = (): string => `dockrun-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

/** Build the short harness preamble so the agent knows where the user is. */
function contextPreamble(c: HarnessContext): string {
  const lines = ['[Workspace-OS context]']
  if (c.root) lines.push(`root: ${c.root}`)
  if (c.surface) lines.push(`surface: ${c.surface}`)
  if (c.folder && c.folder !== c.root) lines.push(`folder: ${c.folder}`)
  if (c.openFile) lines.push(`open file: ${c.openFile}`)
  // Enumerate the per-surface capabilities so the agent knows what it can do
  // where the user is (it acts via its existing Bash/file tools for now).
  const hint = agentActionsHint(c)
  if (hint) lines.push(hint)
  return lines.join('\n')
}

/**
 * A minimal agent chat tab. It reuses the EXISTING agent backend
 * (window.workspace.agent.run + onOutput/onDone) — one prompt → streamed
 * response — and injects the live harness so the agent knows the user's
 * location. Streaming chunks append to the last agent message.
 */
export function TerminalAgentPane({ sessionId, context, agentName, onOpenFile }: Props): JSX.Element {
  const settings = useSettings()
  const [messages, setMessages] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)
  // The run trace: every tool call as a merged icon+label+chip row.
  const [steps, setSteps] = useState<TraceStep[]>([])
  // The run's deliverables, as clickable chips under the trace.
  const [files, setFiles] = useState<{ name: string; path: string }[]>([])
  // Discovered skills — the slash menu's commands.
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([])
  useEffect(() => {
    window.workspace.skills.list().then(setSkills).catch(() => {})
  }, [])
  const runRef = useRef<string | null>(null)
  const convoRef = useRef<string>(`dock-convo-${sessionId}`)
  const logRef = useRef<HTMLDivElement>(null)
  const ctxRef = useRef(context)
  ctxRef.current = context

  const append = useCallback((role: Msg['role'], text: string) => {
    setMessages((prev) => {
      // Coalesce streamed agent chunks into the trailing agent bubble.
      if (role === 'agent' && prev.length && prev[prev.length - 1].role === 'agent') {
        const next = prev.slice()
        next[next.length - 1] = { role, text: next[next.length - 1].text + text }
        return next
      }
      return [...prev, { role, text }]
    })
  }, [])

  useEffect(() => {
    const offOutput = window.workspace.agent.onOutput((runId, chunk) => {
      if (runId === runRef.current) append('agent', chunk)
    })
    const offActivity = window.workspace.agent.onActivity((runId, act) => {
      if (runId !== runRef.current) return
      // Feed the shared cockpit/Review live-activity store (the "deep-reading
      // notion.so" line + trail) so this run shows up in the live Cockpit.
      activityStore.record(runId, act)
      setSteps((prev) => appendStep(prev, { kind: act.kind ?? 'run', label: act.label, chip: act.chip }, Date.now()))
    })
    // Cost/turns + result files onto the run's Review/Cockpit card.
    const offMeta = window.workspace.agent.onRunMeta((runId, meta) => {
      if (runId !== runRef.current) return
      reviewStore.patchRun(runId, { costUsd: meta.costUsd, turns: meta.turns })
    })
    const offArtifacts = window.workspace.agent.onArtifacts((runId, items) => {
      if (runId !== runRef.current || items.length === 0) return
      // The deliverable chips under the trace — what this run leaves behind.
      setFiles(items.map((a) => ({ name: a.name, path: a.path })))
      reviewStore.patchRun(runId, {
        artifacts: items.map((a) => ({ path: a.path, name: a.name, type: a.type })),
      })
    })
    const offDone = window.workspace.agent.onDone((runId, code, checkpointId) => {
      if (runId !== runRef.current) return
      if (code !== 0) append('system', `[agent exited with code ${code}]`)
      // Retire the live line and move the run to a reviewable state so the
      // Cockpit surfaces it (running → NEEDS YOU, or → LANDED once kept).
      activityStore.clear(runId)
      reviewStore.patchRun(runId, {
        status: code === 0 ? 'pending' : 'error',
        code,
        checkpointId: checkpointId ?? null,
      })
      runRef.current = null
      setBusy(false)
    })
    return () => {
      offOutput()
      offActivity()
      offMeta()
      offArtifacts()
      offDone()
    }
  }, [append])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages])

  const submit = useCallback((raw: string, mentions: string[]) => {
    let prompt = raw.trim()
    if ((!prompt && mentions.length === 0) || busy) return
    // A leading /skill becomes the skill invocation — the same contract the
    // console session uses, now discoverable from the slash menu.
    const slash = /^\/(\S+)\s*([\s\S]*)$/.exec(prompt)
    if (slash && skills.some((s) => s.name === slash[1])) {
      prompt = `Use the "${slash[1]}" skill.${slash[2] ? ' ' + slash[2] : ''}`
    }
    const shown = raw.trim() || mentions.map((m) => m.split('/').pop()).join(', ')
    append('user', shown)
    const runId = newRunId()
    runRef.current = runId
    setBusy(true)
    // Fresh run → fresh trace.
    setSteps([])
    setFiles([])
    // Open the run in the shared Review/Cockpit store as 'running' so it appears
    // live in the Cockpit (WORKING band) — the new-shell dock used to bypass this.
    reviewStore.openRun({
      runId,
      sessionId,
      sessionName: agentName ?? 'Agent',
      prompt: shown,
      mode: settings.agentMode,
      agentName: agentName ?? null,
      agentId: sessionId, // one lane per agent tab (session)
    })
    // Blank agent bubble to stream into.
    setMessages((prev) => [...prev, { role: 'agent', text: '' }])
    const c = ctxRef.current
    const grounded = `${contextPreamble(c)}\n\n${prompt || 'Look at the attached files.'}`
    window.workspace.agent
      // @-mentions ride the REAL context-files slot, not pasted-in prose.
      .run(runId, grounded, mentions, c.openFile ?? null, settings.agentMode, agentName ?? null, convoRef.current)
      .catch((err: Error) => {
        append('system', `[error] ${err.message}`)
        activityStore.clear(runId)
        reviewStore.patchRun(runId, { status: 'error', code: null })
        runRef.current = null
        setBusy(false)
      })
  }, [busy, append, settings.agentMode, agentName, sessionId, skills])

  return (
    <div className={styles.agent}>
      <div className={styles.log} ref={logRef}>
        {messages.length === 0 && (
          <div className={styles.msgSystem}>
            Agent ready — it knows where you are in the workspace. Ask anything.
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === 'user' ? styles.msgUser : m.role === 'agent' ? styles.msgAgent : styles.msgSystem
            }
          >
            {m.role === 'user' ? `› ${m.text}` : m.text}
          </div>
        ))}
      </div>
      <RunTrace steps={steps} busy={busy} files={files} onOpenFile={onOpenFile} />
      <div className={styles.composer}>
        <PromptBar
          placeholder="Ask the agent — @ file, / skill…"
          disabled={busy}
          commands={skills.map((s) => ({ name: s.name, hint: s.description }))}
          onSubmit={submit}
        />
      </div>
    </div>
  )
}
