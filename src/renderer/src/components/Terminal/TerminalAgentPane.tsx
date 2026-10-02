import { useState, useRef, useEffect, useCallback } from 'react'
import { agentActionsHint } from './surfaceActions'
import { RunTrace } from '../AgentTerminal/RunTrace'
import { PromptBar } from '../PromptBar/PromptBar'
import { sessionStore } from '../../lib/sessions/sessionStore'
import { useSessions } from '../Landscape/session/SessionPane'
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

/** The dock tab's session id in the shared store (short enough for a conversation key). */
export const dockSessionId = (tabId: string): string => `dock${tabId.replace(/[^a-z0-9]/gi, '').slice(-30)}`

/**
 * An agent tab in the terminal: a session like any other (lib/sessions), so
 * what is started here also stands on the landscape as work, can be kept as a
 * case and continued from its card. Injects the live harness so the agent
 * knows where the person is.
 */
export function TerminalAgentPane({ sessionId, context, agentName, onOpenFile }: Props): JSX.Element {
  const id = dockSessionId(sessionId)
  useSessions()
  useEffect(() => {
    if (!sessionStore.get(id)) sessionStore.create({ id, agentName: agentName ?? null })
  }, [id, agentName])
  const s = sessionStore.get(id)
  const live = sessionStore.live(id)
  const busy = live.running
  const messages: Msg[] = (s?.messages ?? []).map((m) => ({ role: m.role, text: m.text }))
  const files = (s?.files ?? []).slice(-6).map((p) => ({ name: p.split('/').pop() ?? p, path: p }))
  // Discovered skills — the slash menu's commands.
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([])
  useEffect(() => {
    window.workspace.skills.list().then(setSkills).catch(() => {})
  }, [])
  const logRef = useRef<HTMLDivElement>(null)
  const ctxRef = useRef(context)
  ctxRef.current = context

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages.length, messages[messages.length - 1]?.text.length])

  const submit = useCallback(
    (raw: string, mentions: string[]) => {
      let prompt = raw.trim()
      if ((!prompt && mentions.length === 0) || busy) return
      // A leading /skill becomes the skill invocation — the same contract the
      // console session uses, now discoverable from the slash menu.
      const slash = /^\/(\S+)\s*([\s\S]*)$/.exec(prompt)
      if (slash && skills.some((k) => k.name === slash[1])) {
        prompt = `Use the "${slash[1]}" skill.${slash[2] ? ' ' + slash[2] : ''}`
      }
      if (!sessionStore.get(id)) sessionStore.create({ id, agentName: agentName ?? null })
      const c = ctxRef.current
      void sessionStore.send(id, prompt, mentions, { preamble: contextPreamble(c), openFile: c.openFile ?? null })
    },
    [busy, skills, id, agentName],
  )

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
      <RunTrace steps={live.steps} busy={busy} files={files} onOpenFile={onOpenFile} />
      <div className={styles.composer}>
        <PromptBar
          placeholder="Ask the agent — @ file, / skill…"
          disabled={busy}
          commands={skills.map((k) => ({ name: k.name, hint: k.description }))}
          onSubmit={submit}
        />
      </div>
    </div>
  )
}
