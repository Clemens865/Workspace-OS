import { useEffect, useState } from 'react'
import { ChevronDown, FileText, Globe, LayoutGrid, PenLine, Search, Sparkles, SquareTerminal } from 'lucide-react'
import { traceHeader, type TraceStep } from './runTraceModel'
import styles from './RunTrace.module.css'

/**
 * The run trace — an agent run as calm, legible rows instead of scrolling CLI
 * text: icon + what it did + a mono chip of the object it did it to, under a
 * collapsible header that counts the work. Open while the run is live, a
 * one-line summary once it settles.
 *
 * Adapted from Beautiful UI's Thinking/Tool-Chips grammar (beautifului.dev,
 * MIT) — logic and layout re-implemented on the wos token system; reference
 * source in docs/design/reference/beautifului/.
 */

const ICON: Record<string, typeof FileText> = {
  think: Sparkles,
  read: FileText,
  write: PenLine,
  run: SquareTerminal,
  web: Globe,
  search: Search,
  app: LayoutGrid,
}

interface Props {
  steps: TraceStep[]
  /** The run is still streaming — the last row carries the live dots. */
  busy: boolean
  /** Post-run deliverable chips; clicking opens the file in the editor. */
  files?: { name: string; path: string }[]
  onOpenFile?: (path: string) => void
}

export function RunTrace({ steps, busy, files = [], onOpenFile }: Props): JSX.Element | null {
  const [open, setOpen] = useState(true)
  // A fresh run re-opens the trace: steps reset to [] when a run starts.
  useEffect(() => {
    if (busy && steps.length === 0) setOpen(true)
  }, [busy, steps.length])

  if (steps.length === 0 && !busy) return null

  return (
    <div className={styles.root} data-testid="agent-activity">
      <button
        type="button"
        className={styles.header}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid="agent-steps-toggle"
      >
        <ChevronDown size={12} className={`${styles.chevron} ${open ? '' : styles.chevronClosed}`} />
        <span className={styles.headerText} data-testid="agent-activity-label">
          {traceHeader(steps)}
        </span>
        {busy && (
          <span className={styles.dots} aria-label="running">
            <i /><i /><i />
          </span>
        )}
        {!busy && <span className={styles.done} data-testid="agent-activity-done">Done</span>}
      </button>

      <div className={styles.reveal} style={{ gridTemplateRows: open ? '1fr' : '0fr', opacity: open ? 1 : 0 }}>
        <div className={styles.revealInner}>
          <div className={styles.rows} data-testid="agent-steps-list">
            {steps.map((s, i) => {
              const Icon = ICON[s.kind] ?? SquareTerminal
              const live = busy && i === steps.length - 1
              return (
                <div key={`${s.at}-${i}`} className={styles.row}>
                  <Icon size={13} className={`${styles.icon} ${live ? styles.iconLive : ''}`} />
                  <span className={styles.label}>{s.label}</span>
                  {s.chip && <span className={styles.chip}>{s.chip}</span>}
                  {s.count > 1 && <span className={styles.count}>×{s.count}</span>}
                </div>
              )
            })}
          </div>

          {files.length > 0 && (
            <div className={styles.files}>
              {files.map((f, i) => (
                <button
                  key={f.path}
                  type="button"
                  className={styles.fileChip}
                  style={{ animationDelay: `${i * 60}ms` }}
                  onClick={() => onOpenFile?.(f.path)}
                  title={f.path}
                >
                  {f.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
