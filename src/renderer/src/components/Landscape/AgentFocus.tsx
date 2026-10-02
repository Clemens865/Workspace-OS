import { useState, useSyncExternalStore } from 'react'
import { ArrowUpRight, FileText, Play, Pause, Square, Check, X, RotateCcw, Plus, Trash2 } from 'lucide-react'
import { AgentAvatar } from '../Agents/AgentAvatar'
import { activityStore } from '../Review/activityStore'
import { reviewStore } from '../Review/reviewStore'
import { costLabel } from '../CalmCockpit/streamModel'
import { PROVIDER_LABEL, STATUS_LABEL, type AgentPresence } from './presenceTypes'
import { ago } from './agentPresence'
import * as act from './agentActions'
import { pauseRun, resumeRun } from './pauseResume'
import { toast } from './toastStore'
import { SessionPane, useSessions } from './session/SessionPane'
import { sessionStore } from '../../lib/sessions/sessionStore'
import { useAgentScope } from './useAgentScope'

/** Which session each agent's card shows, for this app run. */
const chosen = new Map<string, string>()
import styles from './AgentFocus.module.css'

/**
 * The focused screen: what one agent is doing, in full, and what you can do
 * about it. Decisions (approve, keep, revert, stop) happen right here through
 * the existing stores; real work (the run's terminal, a document) opens on the
 * flat stage.
 */
export function AgentFocus({ a }: { a: AgentPresence }): JSX.Element {
  const acts = useSyncExternalStore(activityStore.subscribe, activityStore.getSnapshot, activityStore.getSnapshot)
  const trail = a.runId ? (acts.trails.get(a.runId) ?? []).slice(-6).reverse() : []
  // What the run has cost so far, as the Cockpit's live zoom showed it (ADOPTION.md B3).
  const review = useSyncExternalStore(reviewStore.subscribe, reviewStore.getSnapshot, reviewStore.getSnapshot)
  const runInfo = a.runId ? review.runs.find((r) => r.runId === a.runId) : undefined
  const stakes = runInfo ? runStakes(runInfo) : null
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const run = async (fn: () => unknown, done?: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      if (done) toast(done)
    } catch (e) {
      setNote((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // The agent's sessions, newest first; the one shown is remembered per agent.
  useSessions()
  const mine = sessionStore
    .list()
    .filter((x) => x.agentName === a.id && x.turns > 0)
    .sort((x, y) => y.lastAt - x.lastAt)
  const [picked, setPicked] = useState<string | null>(() => chosen.get(a.id) ?? mine[0]?.id ?? null)
  const current = picked && sessionStore.get(picked) ? picked : null
  const choose = (id: string | null): void => {
    if (id) chosen.set(a.id, id)
    else chosen.delete(a.id)
    setPicked(id)
  }
  const [confirmDelete, setConfirmDelete] = useState(false)
  const scope = useAgentScope(a.id)

  return (
    <div className={styles.focus} data-testid="agent-focus" data-status={a.status}>
      <header className={styles.head}>
        <AgentAvatar seed={a.name} size={52} />
        <div className={styles.who}>
          <div className={styles.name}>{a.name}</div>
          <div className={styles.meta}>
            {PROVIDER_LABEL[a.provider]}
            {a.role ? ` · ${a.role}` : ''}
          </div>
        </div>
        <span className={styles.chip} data-status={a.status}>
          <span className={styles.chipDot} />
          {STATUS_LABEL[a.status]}
          {a.since ? ` · ${ago(a.since)}` : ''}
        </span>
      </header>

      <div className={styles.columns}>
        <div className={styles.work}>
          <SessionPane
            key={current ?? `new-${a.id}`}
            sessionId={current}
            agentName={a.id}
            onCreated={choose}
            onOpenCase={act.openCase}
            placeholder={`What should ${a.name} do? Ask in your own words; @ adds a file.`}
          />
        </div>

        <aside className={styles.side}>
          {a.status !== 'idle' && (a.task || a.status === 'question' || a.status === 'review' || a.status === 'working' || a.status === 'paused') && (
            <section>
              <h3 className={styles.label}>Now</h3>
              {a.task && <p className={styles.task}>{a.task}</p>}
              {stakes && (
                <p className={styles.stakes} data-testid="agent-stakes">
                  {stakes}
                </p>
              )}
              {a.status === 'question' && (
                <div className={styles.ask}>
                  <p className={styles.question}>{a.question}</p>
                  {act.sessionOf(a.runId) ? (
                    <div className={styles.row}>
                      <button className={styles.primary} disabled={busy} onClick={() => run(() => act.approve(a.runId, 'once'), 'Approved once.')}>
                        <Check size={14} /> Allow once
                      </button>
                      <button className={styles.btn} disabled={busy} onClick={() => run(() => act.approve(a.runId, 'session'), 'Allowed for this session.')}>
                        For this session
                      </button>
                      <button className={styles.btn} disabled={busy} onClick={() => run(() => act.deny(a.runId), 'Denied.')}>
                        <X size={14} /> Deny
                      </button>
                    </div>
                  ) : (
                    <p className={styles.hint}>Answer in the Codex request at the bottom right of the window.</p>
                  )}
                </div>
              )}
              <div className={styles.row}>
                {a.status === 'review' && (
                  <>
                    <button className={styles.primary} disabled={busy} onClick={() => run(() => act.keep(a.runId), 'Kept.')}>
                      <Check size={14} /> Keep
                    </button>
                    {act.canRevert(a.runId) && (
                      <button className={styles.btn} disabled={busy} onClick={() => run(() => act.revert(a.runId), 'Reverted to before the run.')}>
                        <RotateCcw size={14} /> Revert
                      </button>
                    )}
                  </>
                )}
                {a.status === 'working' && (
                  <>
                    <button className={styles.btn} disabled={busy} onClick={() => run(() => pauseRun(a.runId), 'Paused. Resume continues the same conversation.')} data-testid="agent-pause">
                      <Pause size={13} /> Pause
                    </button>
                    <button className={styles.btn} disabled={busy} onClick={() => run(() => act.stop(a.runId), 'Stopping…')}>
                      <Square size={13} /> Stop
                    </button>
                  </>
                )}
                {a.status === 'paused' && (
                  <>
                    <button className={styles.primary} disabled={busy} onClick={() => run(() => resumeRun(a.runId), 'Resumed.')} data-testid="agent-resume">
                      <Play size={14} /> Resume
                    </button>
                    <button className={styles.btn} disabled={busy} onClick={() => run(() => act.stopPaused(a.runId), 'Stopped.')}>
                      <Square size={13} /> Stop
                    </button>
                  </>
                )}
              </div>
              {trail.length > 0 && (
                <ol className={styles.steps}>
                  {trail.slice(0, 4).map((st, i) => (
                    <li key={`${st.at}-${i}`} className={i === 0 && a.status === 'working' ? styles.stepLive : undefined}>
                      <span>{st.label}</span>
                      <span className={styles.when}>{ago(st.at)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          <section>
            <div className={styles.labelRow}>
              <h3 className={styles.label}>Sessions</h3>
              <button className={styles.linkBtn} onClick={() => choose(null)} data-testid="agent-start">
                <Plus size={13} /> New
              </button>
            </div>
            {mine.length ? (
              <ul className={styles.sessions} data-testid="agent-sessions">
                {mine.slice(0, 8).map((x) => (
                  <li key={x.id}>
                    <button className={`${styles.sessionRow} ${x.id === current ? styles.sessionOn : ''}`} onClick={() => choose(x.id)} data-session-row={x.id}>
                      <span className={styles.sessionTitle}>{x.title}</span>
                      <span className={styles.when}>
                        {x.caseId ? 'case · ' : ''}
                        {ago(x.lastAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.hint}>No sessions yet. Ask on the left to start one.</p>
            )}
          </section>

          {a.outputs.length > 0 && (
            <section>
              <h3 className={styles.label}>Latest results</h3>
              <ul className={styles.files}>
                {a.outputs.slice(0, 4).map((p) => (
                  <li key={p}>
                    <button className={styles.file} onClick={() => act.openFile(p)}>
                      <FileText size={14} /> {p.split('/').pop()}
                      <ArrowUpRight size={13} className={styles.fileGo} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h3 className={styles.label}>About</h3>
            <p className={styles.idle}>{a.about || a.role || 'Ready when you are.'}</p>
          </section>

          {note && (
            <p className={styles.note} role="status">
              {note}
            </p>
          )}

          <div className={styles.danger}>
            {confirmDelete ? (
              <>
                <span>Delete {a.name}? Its sessions and cases stay.</span>
                <button className={styles.dangerBtn} disabled={busy} onClick={() => run(() => act.deleteAgent(a.id, scope), `${a.name} was deleted.`)} data-testid="agent-delete-confirm">
                  Delete
                </button>
                <button className={styles.btn} onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button className={styles.linkBtn} onClick={() => setConfirmDelete(true)} data-testid="agent-delete">
                <Trash2 size={13} /> Delete agent
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

/** "4 turns · $0.12 · 18k tokens": the run's size, quietly. Empty parts are left out. */
export function runStakes(r: { turns: number; costUsd: number; costKnown?: boolean; inputTokens?: number; outputTokens?: number }): string | null {
  const parts: string[] = []
  if (r.turns > 0) parts.push(`${r.turns} turn${r.turns === 1 ? '' : 's'}`)
  const cost = costLabel(r.costUsd)
  if (cost) parts.push(cost)
  else if (r.costKnown === false && r.turns > 0) parts.push('cost not reported')
  const tokens = (r.inputTokens ?? 0) + (r.outputTokens ?? 0)
  if (tokens > 0) parts.push(tokens >= 1000 ? `${Math.round(tokens / 1000)}k tokens` : `${tokens} tokens`)
  return parts.length ? parts.join(' · ') : null
}
