import { useEffect, useRef, useState } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { shellQuote } from './shellQuote'
import { xtermTheme } from './xtermThemes'
import { currentTheme, onThemeChange } from '../../hooks/useTheme'
import styles from './TerminalDock.module.css'

/** Read the dropped workspace path(s) — our own MIME first, then a plain
 * absolute path (so a drag from elsewhere in the app still works). Returns
 * space-joined, shell-quoted tokens ready to type, or null if nothing usable. */
function droppedPaths(dt: DataTransfer): string | null {
  const raw = dt.getData('application/x-wos-path') || dt.getData('text/plain')
  if (!raw) return null
  const paths = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith('/'))
  if (paths.length === 0) return null
  return paths.map(shellQuote).join(' ')
}

interface ShellContext {
  root: string | null
  surface: string | null
  openFile: string | null
  folder: string | null
}

interface Props {
  sessionId: string
  /** Bumped when the dock resizes/opens so the fit re-runs. */
  resizeSignal: number
  /** True when this is the visible shell tab (drives an on-reveal re-fit). */
  active: boolean
  /** Live workspace harness — written as a calm banner once the shell starts. */
  context: ShellContext
}

const baseName = (p: string | null): string | null => (p ? p.split('/').pop() ?? p : null)

/** Two-line DIM banner (grey) telling the user which workspace their shell + claude run in. */
function contextBanner(c: ShellContext): string {
  const parts = [baseName(c.root) ?? 'workspace']
  if (c.surface) parts.push(c.surface)
  if (c.openFile) parts.push(baseName(c.openFile) as string)
  const line = parts.join(' · ')
  return (
    `\x1b[90m${line}\x1b[0m\r\n` +
    `\x1b[90mYour shell + claude run in this workspace.\x1b[0m\r\n\r\n`
  )
}

/**
 * A real PTY-backed shell tab. xterm.js renders; the node-pty process lives in
 * main (terminal/ptyHost.ts) carrying the live harness in its env, and streams
 * over the `window.workspace.terminal` bridge (create → onData → write; onExit).
 */
export function TerminalShellPane({ sessionId, resizeSignal, active, context }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const ctxRef = useRef(context)
  ctxRef.current = context
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      fontFamily: "'SF Mono', 'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
      fontSize: 13,
      lineHeight: 1.35,
      cursorBlink: true,
      // The app's theme, live (see the effect below).
      theme: xtermTheme(currentTheme()),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    fitRef.current = fit
    termRef.current = term

    // Fit once layout has settled (a 0-size container fits to 0 rows/cols and
    // corrupts rendering — so we defer to the next frame and guard on size).
    const sendResize = (): void => {
      if (container.offsetWidth === 0 || container.offsetHeight === 0) return
      fit.fit()
      window.workspace.terminal.resize(sessionId, term.cols, term.rows)
    }
    requestAnimationFrame(sendResize)

    window.workspace.terminal.create(sessionId).catch((err: Error) => {
      term.write(`\r\n\x1b[38;5;209m[terminal] ${err.message}\x1b[0m\r\n`)
    })
    // Calm context banner (only when a workspace is set) so the shell reads as
    // rooted in the workspace, not a bare console.
    if (ctxRef.current.root) term.write(contextBanner(ctxRef.current))
    const offData = window.workspace.terminal.onData((sid, data) => {
      if (sid === sessionId) term.write(data)
    })
    const offExit = window.workspace.terminal.onExit((sid, code) => {
      if (sid === sessionId) term.write(`\r\n\x1b[90m[process exited (${code})]\x1b[0m\r\n`)
    })
    const inputSub = term.onData((data) => window.workspace.terminal.write(sessionId, data))

    const observer = new ResizeObserver(sendResize)
    observer.observe(container)
    term.focus()

    return () => {
      observer.disconnect()
      offData()
      offExit()
      inputSub.dispose()
      window.workspace.terminal.kill(sessionId)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [sessionId])

  // Light or dark, as the app switches.
  useEffect(
    () =>
      onThemeChange((t) => {
        if (termRef.current) termRef.current.options.theme = xtermTheme(t)
      }),
    [],
  )

  // Re-fit when the dock geometry changes (resize / placement flip / reveal).
  useEffect(() => {
    const container = containerRef.current
    const term = termRef.current
    const fit = fitRef.current
    if (!container || !term || !fit) return
    if (container.offsetWidth === 0 || container.offsetHeight === 0) return
    fit.fit()
    window.workspace.terminal.resize(sessionId, term.cols, term.rows)
  }, [resizeSignal, sessionId])

  // When this tab becomes visible again its container is no longer display:none;
  // re-fit on the next frame so an xterm that was hidden (and may have fit to 0)
  // recovers to the correct rows/cols.
  useEffect(() => {
    if (!active) return
    requestAnimationFrame(() => {
      const term = termRef.current
      const fit = fitRef.current
      const container = containerRef.current
      if (!term || !fit || !container) return
      if (container.offsetWidth === 0 || container.offsetHeight === 0) return
      fit.fit()
      window.workspace.terminal.resize(sessionId, term.cols, term.rows)
    })
  }, [active, sessionId])

  // Drop a workspace file → insert its (shell-quoted) path at the cursor, like
  // dragging a file into macOS Terminal. We type it via the PTY write bridge so
  // the shell echoes it exactly as if the user had typed the path.
  const onDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setDragOver(false)
    const tokens = droppedPaths(e.dataTransfer)
    if (!tokens) return
    window.workspace.terminal.write(sessionId, tokens + ' ')
    termRef.current?.focus()
  }

  return (
    <div
      ref={containerRef}
      className={`${styles.termHost}${dragOver ? ` ${styles.dropTarget}` : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!dragOver) setDragOver(true)
      }}
      onDragLeave={(e) => {
        // Ignore leaves into descendants (xterm's own canvas layers).
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setDragOver(false)
      }}
      onDrop={onDrop}
    >
      {dragOver && <div className={styles.dropHint}>Drop to insert path</div>}
    </div>
  )
}
