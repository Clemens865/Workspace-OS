import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import 'xterm/css/xterm.css'
import {
  detectPermissionPrompt,
  decisionToKeys,
  describePrompt,
  type PermissionPrompt,
  type HitlDecision,
} from './hitlGate'
import { emptyLedger, recordRun, formatLedger, type SessionLedger } from './budgetLedger'
import { sessionStore } from './sessionStore'
import { reviewStore } from '../Review/reviewStore'
import styles from './AgentPtySession.module.css'

interface AgentPtySessionProps {
  /** Persisted session id — also the PTY key in the main process. */
  sessionId: string
  model?: string
  agentName?: string | null
  mode?: 'safe' | 'full'
  activeFile?: string | null
  /** Switch this session back to the shipped `-p`/stream-json console. */
  onSwitchToPrompt: () => void
}

/** Recent-output window (chars) scanned for the permission prompt. Large enough
 *  to hold the whole menu, small enough that it clears once claude redraws. */
const DETECT_WINDOW = 4000

/**
 * Broker v2 — the INTERACTIVE `claude` session. A real PTY (main:
 * handlers/agent-pty.ts) hosts the full claude TUI; xterm renders it and routes
 * keystrokes back, exactly like the integrated shell. The difference is the HITL
 * layer: every PTY chunk is scanned for claude's native permission prompt, and
 * when one is awaiting a decision we surface styled Allow / Allow-for-session /
 * Deny buttons that write the matching keystrokes to the PTY (the pure gate lives
 * in hitlGate.ts). A budget ledger counts approvals in the header.
 */
export function AgentPtySession({ sessionId, model, agentName, mode, activeFile, onSwitchToPrompt }: AgentPtySessionProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const providerRef = useRef<'claude' | 'codex'>('claude')
  const bufferRef = useRef('')
  const [prompt, setPrompt] = useState<PermissionPrompt | null>(null)
  const [ledger, setLedger] = useState<SessionLedger>(emptyLedger)
  const [exited, setExited] = useState<number | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 10_000,
      theme: {
        background: '#1a1a1f',
        foreground: '#e8e8f0',
        cursor: '#6b7ff0',
        selectionBackground: '#33334080',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(container)
    fit.fit()
    termRef.current = term

    window.workspace.agentPty.spawn(sessionId, { model, agentName, mode, activeFile }).then((result) => { providerRef.current = result.provider ?? 'claude' }).catch((err: Error) => {
      term.write(`\r\n\x1b[38;5;209m[could not start agent: ${err.message}]\x1b[0m\r\n`)
      setExited(-1)
    })

    const offOutput = window.workspace.agentPty.onOutput((sid, data) => {
      if (sid !== sessionId) return
      term.write(data)
      // Slide the detection window and re-evaluate the pending prompt. Because
      // the window is bounded, an answered menu clears itself as claude redraws.
      bufferRef.current = (bufferRef.current + data).slice(-DETECT_WINDOW)
      if (providerRef.current === 'claude') setPrompt(detectPermissionPrompt(bufferRef.current))
    })
    const offExit = window.workspace.agentPty.onExit((sid, code) => {
      if (sid !== sessionId) return
      setExited(code)
      setPrompt(null)
      term.write(`\r\n\x1b[2m[agent session exited (code ${code})]\x1b[0m\r\n`)
    })

    // Real TUI: keystrokes go straight to the PTY. Typing also dismisses any
    // stale gate (the user answered the menu by hand).
    const inputSub = term.onData((data) => {
      window.workspace.agentPty.input(sessionId, data)
      bufferRef.current = ''
      setPrompt(null)
    })

    const sendResize = (): void => {
      fit.fit()
      window.workspace.agentPty.resize(sessionId, term.cols, term.rows)
    }
    sendResize()
    const observer = new ResizeObserver(sendResize)
    observer.observe(container)
    term.focus()

    return () => {
      observer.disconnect()
      offOutput()
      offExit()
      inputSub.dispose()
      window.workspace.agentPty.kill(sessionId)
      term.dispose()
      termRef.current = null
    }
  }, [sessionId])

  const decide = useCallback((decision: HitlDecision) => {
    window.workspace.agentPty.input(sessionId, decisionToKeys(decision))
    // Approvals are the only cost signal a PTY session exposes — count them.
    if (decision !== 'deny') setLedger((l) => recordRun(l, { turns: 1 }))
    bufferRef.current = ''
    setPrompt(null)
    termRef.current?.focus()
  }, [sessionId])

  // Mirror the live permission request into the Agent Review feed as an Action
  // card, so a pending outbound decision can be handled from either surface.
  useEffect(() => {
    if (prompt && exited === null) {
      const sessionName = sessionStore.get(sessionId)?.name ?? 'Interactive agent'
      reviewStore.setHitl(
        {
          sessionId,
          sessionName,
          agentId: sessionId,
          kind: prompt.kind,
          question: prompt.question,
          createdAt: Date.now(),
        },
        decide
      )
      // The person may not be looking: a waiting approval is the one thing
      // worth a knock on the door. Main throttles and honours the setting.
      void window.workspace.notify
        ?.request({ source: 'approvals', key: sessionId, title: `${sessionName} is asking`, body: prompt.question, rail: 'agents' })
        .catch(() => {})
    } else {
      reviewStore.clearHitl(sessionId)
    }
  }, [prompt, exited, sessionId, decide])

  // Clear the feed's live card if this session unmounts mid-prompt.
  useEffect(() => () => reviewStore.clearHitl(sessionId), [sessionId])

  const budget = formatLedger(ledger, { turnsLabel: 'approval' })

  return (
    <div className={styles.root} data-testid="agent-pty">
      <div className={styles.header}>
        <button
          className={styles.modeBtn}
          onClick={onSwitchToPrompt}
          title="Switch this session back to the standard (non-interactive) agent console"
        >
          ⌨ Interactive
        </button>
        <span className={styles.modeHint}>native permission prompts</span>
        <span className={styles.spacer} />
        {budget && <span className={styles.budget} title="Approvals granted this session">{budget}</span>}
        {exited !== null && <span className={styles.exited}>exited {exited}</span>}
      </div>

      <div ref={containerRef} className={styles.term} />

      {prompt && exited === null && (
        <div className={styles.gate} role="alertdialog" aria-label="Claude permission request">
          <span className={styles.gateIcon}>🔐</span>
          <span className={styles.gateText}>{describePrompt(prompt)}</span>
          <span className={styles.spacer} />
          <button className={`${styles.gateBtn} ${styles.allow}`} onClick={() => decide('allow-once')}>
            Allow once
          </button>
          <button className={`${styles.gateBtn} ${styles.allowSession}`} onClick={() => decide('allow-session')}>
            Allow for session
          </button>
          <button className={`${styles.gateBtn} ${styles.deny}`} onClick={() => decide('deny')}>
            Deny
          </button>
        </div>
      )}
    </div>
  )
}
