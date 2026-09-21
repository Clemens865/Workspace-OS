import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, CircleAlert, LoaderCircle, MessageCircle } from 'lucide-react'
import { caseAgentBusy, caseAgentCanContinue, type CaseAgentRun } from './caseAgentRuns'
import { stripAnsi } from '../AgentTerminal/hitlGate'
import styles from './CaseAgentActivity.module.css'

export function CaseAgentActivity({ run, onOpenFile, onContinue }: {
  run: CaseAgentRun | null
  onOpenFile?: (path: string) => void
  onContinue?: () => void
}): JSX.Element | null {
  const [now, setNow] = useState(Date.now)
  const outputRef = useRef<HTMLDivElement>(null)
  const followOutput = useRef(true)
  const busy = caseAgentBusy(run)
  useEffect(() => {
    const el = outputRef.current
    if (el && followOutput.current) el.scrollTop = el.scrollHeight
  }, [run?.output])
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [busy])
  if (!run) return null
  const waiting = run.requests.length > 0
  const limited = run.status === 'error' && run.failure?.kind === 'output-limit'
  const provider = run.provider === 'codex' ? 'Codex' : run.provider === 'claude' ? 'Claude' : 'Agent'
  const status = limited ? 'Response limit reached' : waiting ? 'Waiting for you' : {
    preparing: 'Preparing case', starting: 'Starting', running: 'Running', completed: 'Completed', error: 'Failed',
  }[run.status]
  const Icon = waiting ? MessageCircle : busy ? LoaderCircle : run.status === 'error' ? CircleAlert : CheckCircle2
  const seconds = Math.max(0, Math.floor(((run.finishedAt ?? now) - run.startedAt) / 1000))
  const duration = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const latest = run.steps.at(-1)
  return (
    <section className={styles.panel} aria-label="Case agent activity" data-testid="case-agent-activity" data-status={run.status}>
      <div className={styles.heading} role="status" aria-live="polite" aria-atomic="true">
        <Icon size={14} aria-hidden className={busy && !waiting ? styles.spin : ''} />
        <strong>{provider} · {status}</strong>
        <span className={styles.time} aria-hidden>{duration}</span>
      </div>
      <p className={styles.task}>{run.label}</p>
      {waiting ? <p className={styles.live}>Answer the Codex request to continue.</p>
        : busy && <p className={styles.live} aria-live="polite">{latest?.label ?? (run.status === 'preparing' ? 'Loading the case and its references…' : run.output ? 'Responding…' : 'Waiting for the agent’s first update…')}</p>}
      {run.error && <p className={styles.error} role="alert">{run.error}</p>}
      {limited && (caseAgentCanContinue(run) && onContinue
        ? <button className={styles.continue} onClick={onContinue}>Continue unfinished work</button>
        : <p className={styles.live}>{run.launchPending ? 'Checking conversation availability…' : 'The original conversation cannot be resumed. Send a new request asking the agent to inspect the case files and finish what remains.'}</p>)}
      {run.steps.length > 0 && (
        <details className={styles.details}>
          <summary>Recent activity · {run.steps.length} step{run.steps.length === 1 ? '' : 's'}</summary>
          <ol className={styles.steps}>{run.steps.slice(-12).map((step, i) => (
            <li key={`${step.at}-${i}`}>{step.label}{step.chip && <span className={styles.detail}>{step.chip}</span>}{step.count > 1 && <span> ×{step.count}</span>}</li>
          ))}</ol>
        </details>
      )}
      {run.output && <details className={styles.details} open>
        <summary>Agent response</summary>
        {run.outputTruncated && <p className={styles.task}>Earlier response text is omitted from this preview. Saved files are unaffected.</p>}
        <div className={styles.output} ref={outputRef} tabIndex={0} aria-label="Agent response" onScroll={(e) => {
          const el = e.currentTarget
          followOutput.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}>{stripAnsi(run.output)}</div>
      </details>}
      {run.artifacts.length > 0 && <div className={styles.files}>{run.artifacts.map((file) => (
        <button key={file.path} onClick={() => onOpenFile?.(file.path)} title={file.path}>{file.name}</button>
      ))}</div>}
    </section>
  )
}
