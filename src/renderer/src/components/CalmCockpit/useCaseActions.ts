import { useState, useEffect, useCallback } from 'react'
import type { WorkCase, NoteSignal, CalendarWriteTarget } from '../../types/workspace-api'
import { buildCaseTask, buildAskTask } from './caseActions'
import { caseAgentRuns, useCaseAgentRun } from './useCaseAgentRun'

/**
 * Everything a case can DO, in one place.
 *
 * Extracted from the cockpit's CaseRow so the fullscreen case view drives the
 * exact same behaviour — notes, status, scope, the note-implied offers (research
 * / prepare / schedule), the deterministic calendar write, and the free agent
 * hand-off — through one implementation rather than two that drift apart.
 *
 * `expanded` gates the status-vocabulary fetch: the row only needs it once open;
 * the fullscreen view passes `true`.
 */
/**
 * Every case run gets the case's own folder (Work/<id>/{sources,drafts,outputs})
 * and is told to write into it, so what an agent makes for a case lands with
 * the case instead of scattering over the workspace (docs/landscape/PLAN.md §5a).
 */
async function withWorkFolder(caseId: string, prompt: string): Promise<string> {
  const work = await window.workspace.cases.workFolder?.(caseId).catch(() => null)
  return work ? `${prompt}\n\n${work.guidance}` : prompt
}

export function useCaseActions(c: WorkCase, onChanged: () => void, expanded: boolean) {
  const [note, setNote] = useState('')
  const [pickCalendar, setPickCalendar] = useState<{ signal: NoteSignal; options: CalendarWriteTarget[] } | null>(null)
  const [statuses, setStatuses] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { run, key, agentBusy } = useCaseAgentRun(c, onChanged)

  // The offers are a property of the case (read from its notes), not of the
  // session that typed one — true for an agent's note, true after a restart.
  const signals = c.signals ?? []

  useEffect(() => {
    if (!expanded) return
    void window.workspace.cases.statuses(c.type).then((s) => setStatuses(s ?? [])).catch(() => setStatuses([]))
  }, [expanded, c.type])

  const addNote = useCallback(async () => {
    const text = note.trim()
    if (!text) return
    setBusy(true)
    try {
      await window.workspace.cases.addNote(c.id, text)
      setNote('')
      onChanged() // offers the note implies come back with the case — never auto-run
    } finally {
      setBusy(false)
    }
  }, [c.id, note, onChanged])

  const setStatus = useCallback(async (s: string) => {
    setBusy(true)
    try {
      await window.workspace.cases.setStatus(c.id, s)
      onChanged()
    } finally {
      setBusy(false)
    }
  }, [c.id, onChanged])

  const setScope = useCallback(async (scope: 'workspace' | 'global') => {
    setBusy(true)
    setError(null)
    try {
      await window.workspace.cases.setScope(c.id, scope)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [c.id, onChanged])

  // The date is already resolved and the calendar takes a direct call — handing
  // it to a model would add latency, cost, and a chance of the wrong day.
  const schedule = useCallback(async (signal: NoteSignal, target: string | null) => {
    try {
      const at = Number(signal.value)
      const ev = await window.workspace.calendar.createEvent({
        summary: c.title,
        start: at,
        end: at + 3600_000,
        description: `From the case: ${c.title}${c.subject ? `\n${c.subject}` : ''}`,
        ...(target ? { target } : {}),
      })
      await window.workspace.cases.markActed(c.id, signal)
      await window.workspace.cases.addNote(c.id, `Put in the calendar (${ev.calendar}): ${new Date(ev.start).toLocaleString()}`, 'you')
      setPickCalendar(null)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [c.id, c.title, c.subject, onChanged])

  const runOffer = useCallback(async (signal: NoteSignal) => {
    setBusy(true)
    setError(null)
    try {
      if (signal.kind === 'schedule') {
        const choice = await window.workspace.calendar.writeTargets()
        if (!choice.target) { setPickCalendar({ signal, options: choice.options }); return }
        await schedule(signal, null)
        return
      }
      const task = buildCaseTask(signal, c.id, '')
      const started = await caseAgentRuns.start(c, key, task.label, async () => ({
        prompt: await withWorkFolder(c.id, buildCaseTask(signal, c.id, await window.workspace.cases.asContext(c.id)).prompt),
        mentions: [],
      }))
      if (!started) return
      await window.workspace.cases.markActed(c.id, signal) // taken — don't offer twice
      await window.workspace.cases.addNote(c.id, `Asked an agent: ${task.label.toLowerCase()}`, 'agent')
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [c, key, onChanged, schedule])

  /**
   * Hand the case to an agent with a free instruction. `@`-files ride as context
   * files; `#`-tagged OTHER cases ride as their markdown, so "prep using #other"
   * pulls a second case's whole thread into the ask.
   */
  const runAsk = useCallback(async (raw: string, mentions: string[], caseIds?: string[]) => {
    const instruction = raw.trim() || 'Look at the attached files in the context of this case.'
    setBusy(true)
    setError(null)
    try {
      const refs = (caseIds ?? []).filter((id) => id !== c.id)
      const started = await caseAgentRuns.start(c, key, instruction, async () => {
        const markdown = await window.workspace.cases.asContext(c.id)
        const ctx = await Promise.all(refs.map((id) => window.workspace.cases.asContext(id)))
        const extra = ctx.filter(Boolean).map((m) => `\n\n--- Referenced case ---\n${m}`).join('')
        return { prompt: await withWorkFolder(c.id, buildAskTask(instruction + extra, c.id, markdown).prompt), mentions }
      })
      if (!started) return
      const tag = refs.length ? ` (with ${refs.length} referenced case${refs.length > 1 ? 's' : ''})` : ''
      await window.workspace.cases.addNote(c.id, `Asked an agent: ${instruction}${tag}`, 'you')
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [c, key, onChanged])

  return {
    note, setNote, statuses, busy, error, signals, run, agentBusy,
    pickCalendar, setPickCalendar,
    addNote, setStatus, setScope, schedule, runOffer, runAsk,
    continueRun: () => { void caseAgentRuns.continue(key) },
  }
}
