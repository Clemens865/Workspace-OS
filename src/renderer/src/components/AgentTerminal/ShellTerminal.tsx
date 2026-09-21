import { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import 'xterm/css/xterm.css'
import styles from './ShellTerminal.module.css'

interface ShellTerminalProps {
  sessionId: string
}

/**
 * A real PTY-backed shell terminal — the IDE "integrated terminal" experience.
 * xterm.js renders; the node-pty process lives in main (handlers/shell.ts) and
 * streams over IPC. Run anything here, including `claude`.
 */
export function ShellTerminal({ sessionId }: ShellTerminalProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 13,
      cursorBlink: true,
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

    // Spawn the PTY and wire I/O both directions.
    window.workspace.shell.spawn(sessionId)
    const offOutput = window.workspace.shell.onOutput((sid, data) => {
      if (sid === sessionId) term.write(data)
    })
    const inputSub = term.onData((data) => window.workspace.shell.input(sessionId, data))

    const sendResize = () => {
      fit.fit()
      window.workspace.shell.resize(sessionId, term.cols, term.rows)
    }
    sendResize()

    const observer = new ResizeObserver(sendResize)
    observer.observe(container)

    term.focus()

    return () => {
      observer.disconnect()
      offOutput()
      inputSub.dispose()
      window.workspace.shell.kill(sessionId)
      term.dispose()
    }
  }, [sessionId])

  return <div ref={containerRef} className={styles.root} />
}
