import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BackgroundJob, Routine } from '../../types/workspace-api'
import { agoLabel } from '../Shell/home/homeModel'
import styles from './RoutinesTab.module.css'

/**
 * ROUTINES — agents on a clock, under Agents (a routine is an agent with a
 * schedule, not a new place to look). One row each: name, the schedule in
 * words, who runs it, on/off, last and next run, and the last run's state as
 * the feed knows it. Results land in the Feed and Stream like any run.
 */

type ScheduleKind = 'daily' | 'weekdays' | 'weekly' | 'every'
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const DAY_LABEL: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }

interface Draft {
  id?: string
  name: string
  prompt: string
  agentName: string
  kind: ScheduleKind
  time: string
  day: string
  hours: number
  capabilities: string[]
  enabled: boolean
}

function toSchedule(d: Draft): string {
  if (d.kind === 'every') return `every:${d.hours}h`
  if (d.kind === 'weekly') return `weekly@${d.day} ${d.time}`
  return `${d.kind}@${d.time}`
}

function fromRoutine(r?: Routine): Draft {
  const base: Draft = { name: '', prompt: '', agentName: '', kind: 'daily', time: '07:00', day: 'mon', hours: 6, capabilities: [], enabled: false }
  if (!r) return base
  const m = /^(daily|weekdays)@(\d{2}:\d{2})$|^weekly@([a-z]{3}) (\d{2}:\d{2})$|^every:(\d+)h$/.exec(r.schedule)
  const d: Draft = { ...base, id: r.id, name: r.name, prompt: r.prompt, agentName: r.agentName ?? '', capabilities: r.capabilities, enabled: r.enabled }
  if (!m) return d
  if (m[1]) return { ...d, kind: m[1] as ScheduleKind, time: m[2] }
  if (m[3]) return { ...d, kind: 'weekly', day: m[3], time: m[4] }
  return { ...d, kind: 'every', hours: Number(m[5]) }
}

function jobState(job: BackgroundJob | undefined): { text: string; tone: string } {
  if (!job) return { text: 'never ran', tone: styles.quiet }
  switch (job.status) {
    case 'queued':
    case 'running':
      return { text: 'running', tone: styles.live }
    case 'pending':
      return { text: 'needs you', tone: styles.warm }
    case 'error':
    case 'interrupted':
      return { text: job.status, tone: styles.bad }
    default:
      return { text: job.status, tone: styles.quiet }
  }
}

export function RoutinesTab(): JSX.Element {
  const [routines, setRoutines] = useState<Routine[]>([])
  const [jobs, setJobs] = useState<BackgroundJob[]>([])
  const [agents, setAgents] = useState<{ name: string; capabilities?: string[] }[]>([])
  const [caps, setCaps] = useState<{ id: string; label: string }[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [words, setWords] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const [r, j] = await Promise.all([window.workspace.routines.list().catch(() => []), window.workspace.runs.list().catch(() => [])])
    setRoutines(r)
    setJobs(j)
  }, [])

  useEffect(() => {
    void refresh()
    void window.workspace.agents.list().then(setAgents).catch(() => {})
    void window.workspace.agents.capabilities().then((c) => setCaps(c.map((x) => ({ id: x.id, label: x.label })))).catch(() => {})
    const offR = window.workspace.routines.onUpdated((r) => setRoutines(r))
    const offJ = window.workspace.runs.onUpdated(() => void window.workspace.runs.list().then(setJobs).catch(() => {}))
    return () => {
      offR()
      offJ()
    }
  }, [refresh])

  // The schedule in words, from main's own parser — the editor never guesses.
  useEffect(() => {
    if (!draft) return
    let live = true
    void window.workspace.routines
      .describe(toSchedule(draft))
      .then((r) => live && setWords(r.ok ? r.text : r.error))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [draft])

  const lastJob = useMemo(() => new Map(routines.map((r) => [r.id, jobs.find((j) => j.id === r.lastJobId)])), [routines, jobs])

  const save = async (): Promise<void> => {
    if (!draft) return
    setBusy(true)
    setErr('')
    try {
      await window.workspace.routines.save({
        id: draft.id,
        name: draft.name,
        prompt: draft.prompt,
        schedule: toSchedule(draft),
        agentName: draft.agentName || null,
        enabled: draft.enabled,
        capabilities: draft.capabilities,
      })
      setDraft(null)
      await refresh()
    } catch (e) {
      setErr((e as Error).message || 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (r: Routine): Promise<void> => {
    await window.workspace.routines.save({ id: r.id, name: r.name, prompt: r.prompt, schedule: r.schedule, agentName: r.agentName, enabled: !r.enabled, capabilities: r.capabilities }).catch(() => {})
    await refresh()
  }

  const runNow = async (r: Routine): Promise<void> => {
    const res = await window.workspace.routines.runNow(r.id).catch(() => ({ ok: false as const, error: 'Could not start' }))
    if (!res.ok) setErr(res.error)
    await refresh()
  }

  const remove = async (r: Routine): Promise<void> => {
    await window.workspace.routines.delete(r.id).catch(() => {})
    await refresh()
  }

  const pickAgent = (name: string): void => {
    if (!draft) return
    const a = agents.find((x) => x.name === name)
    // An agent brings its capabilities; the person can still trim them.
    setDraft({ ...draft, agentName: name, capabilities: a?.capabilities?.length ? a.capabilities : draft.capabilities })
  }

  return (
    <div className={styles.root} data-testid="routines-tab">
      <ol className={styles.list}>
        {routines.map((r) => {
          const st = jobState(lastJob.get(r.id))
          return (
            <li key={r.id} className={`${styles.row} ${r.enabled ? '' : styles.rowOff}`} data-testid="routine-row" data-enabled={r.enabled}>
              <button
                className={`${styles.toggle} ${r.enabled ? styles.toggleOn : ''}`}
                onClick={() => void toggle(r)}
                aria-pressed={r.enabled}
                title={r.enabled ? 'Turn off' : 'Turn on'}
                data-testid="routine-toggle"
              >
                <span className={styles.knob} />
              </button>
              <div className={styles.main}>
                <div className={styles.name}>{r.name}</div>
                <div className={styles.meta}>
                  <span data-testid="routine-words">{r.schedule}</span>
                  {r.agentName && <span> · {r.agentName}</span>}
                  {r.capabilities.length > 0 && <span> · {r.capabilities.join(', ')}</span>}
                </div>
              </div>
              <div className={styles.when}>
                <span className={st.tone}>{st.text}</span>
                <span className={styles.quiet}>{r.lastRunAt ? `last ${agoLabel(r.lastRunAt)}` : ''}</span>
                <span className={styles.quiet}>{r.enabled && r.nextRunAt ? `next ${new Date(r.nextRunAt).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</span>
              </div>
              <div className={styles.actions}>
                <button className={styles.quietBtn} onClick={() => void runNow(r)} data-testid="routine-run-now">Run now</button>
                <button className={styles.quietBtn} onClick={() => setDraft(fromRoutine(r))}>Edit</button>
                <button className={`${styles.quietBtn} ${styles.danger}`} onClick={() => void remove(r)}>Delete</button>
              </div>
            </li>
          )
        })}
      </ol>

      {!draft && (
        <button className={styles.add} onClick={() => setDraft(fromRoutine())} data-testid="routine-new">
          + New routine
        </button>
      )}
      {err && <p className={styles.error}>{err}</p>}

      {draft && (
        <form
          className={styles.editor}
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
          data-testid="routine-editor"
        >
          <label className={styles.field}>
            <span>Name</span>
            <input className={styles.input} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Morning sift" autoFocus />
          </label>
          <label className={styles.field}>
            <span>What it does</span>
            <textarea className={styles.textarea} rows={5} value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} placeholder="The prompt the agent runs each time." />
          </label>
          <div className={styles.grid}>
            <label className={styles.field}>
              <span>Runs</span>
              <select className={styles.input} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as ScheduleKind })}>
                <option value="daily">every day</option>
                <option value="weekdays">every weekday</option>
                <option value="weekly">every week</option>
                <option value="every">every few hours</option>
              </select>
            </label>
            {draft.kind === 'weekly' && (
              <label className={styles.field}>
                <span>On</span>
                <select className={styles.input} value={draft.day} onChange={(e) => setDraft({ ...draft, day: e.target.value })}>
                  {DAYS.map((d) => (
                    <option key={d} value={d}>{DAY_LABEL[d]}</option>
                  ))}
                </select>
              </label>
            )}
            {draft.kind === 'every' ? (
              <label className={styles.field}>
                <span>Every</span>
                <input className={styles.input} type="number" min={1} max={168} value={draft.hours} onChange={(e) => setDraft({ ...draft, hours: Math.max(1, Math.min(168, Number(e.target.value) || 1)) })} />
              </label>
            ) : (
              <label className={styles.field}>
                <span>At</span>
                <input className={styles.input} type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value || '07:00' })} />
              </label>
            )}
            <label className={styles.field}>
              <span>Agent</span>
              <select className={styles.input} value={draft.agentName} onChange={(e) => pickAgent(e.target.value)}>
                <option value="">The built-in agent</option>
                {agents.map((a) => (
                  <option key={a.name} value={a.name}>{a.name}</option>
                ))}
              </select>
            </label>
          </div>
          <p className={styles.words} data-testid="routine-schedule-words">{words}</p>
          <div className={styles.field}>
            <span>May reach</span>
            <div className={styles.chips}>
              {caps.map((c) => {
                const on = draft.capabilities.includes(c.id)
                return (
                  <button
                    type="button"
                    key={c.id}
                    className={`${styles.chip} ${on ? styles.chipOn : ''}`}
                    aria-pressed={on}
                    onClick={() => setDraft({ ...draft, capabilities: on ? draft.capabilities.filter((x) => x !== c.id) : [...draft.capabilities, c.id] })}
                  >
                    {c.label}
                  </button>
                )
              })}
            </div>
            <p className={styles.hint}>A routine runs unattended, in safe mode, and can only reach what is ticked here. Nothing it does is sent; results wait for you in the Feed.</p>
          </div>
          <label className={styles.check}>
            <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> On
          </label>
          <div className={styles.editorActions}>
            <button type="submit" className={styles.primary} disabled={busy}>{draft.id ? 'Save' : 'Create'}</button>
            <button type="button" className={styles.quietBtn} onClick={() => { setDraft(null); setErr('') }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}
