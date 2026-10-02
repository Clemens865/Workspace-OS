import { useCallback, useEffect, useState } from 'react'
import type { CalendarEvent, CalendarTargetChoice } from '../../types/workspace-api'
import { buildEventInput, defaultDraft, draftFromEvent, occurrenceOf, type EventDraft } from './calendarModel'
// Deliberately the SAME stylesheet as ConnectCalendarDialog: the two dialogs
// should read as one family, and its classes (modal/field/input/actions) are
// generic. If their looks ever need to diverge, split the module then.
import styles from './ConnectCalendarDialog.module.css'

/**
 * Create an event from the Calendar surface.
 *
 * Which calendar it goes to is asked HERE, while the person is still filling
 * the form — being told afterwards that a meeting landed somewhere unexpected
 * is not a correction anybody can make quickly. One writable calendar means
 * no question; several mean a visible select, remembered once used.
 *
 * Attendees are invited by the SERVER, so the field only accepts input when
 * the chosen calendar can invite — a local .ics can hold a meeting but cannot
 * tell anyone about it, and a greyed-out field with the reason beats a
 * successful save that silently invited nobody.
 */
interface Props {
  /** The viewed week — the form's default date comes from it. */
  weekStart: number
  /** Present → the dialog EDITS this event instead of creating one. */
  editing?: CalendarEvent | null
  /** The edited event is a slice of a series → offer occurrence-or-series. */
  recurring?: boolean
  /** Overrides the empty form's defaults — e.g. the time slot the person clicked. */
  initialDraft?: Partial<EventDraft>
  onClose: () => void
  /** Called after a successful write, with what the calendar reported. */
  onCreated: (result: { calendar: string; invited: string[] }) => void
  /** Called after a successful edit. */
  onUpdated?: () => void
}

export function NewEventDialog({ weekStart, editing, recurring, initialDraft, onClose, onCreated, onUpdated }: Props): JSX.Element {
  const [draft, setDraft] = useState<EventDraft>(() =>
    editing ? draftFromEvent(editing) : { ...defaultDraft(weekStart), ...initialDraft })
  const [choice, setChoice] = useState<CalendarTargetChoice | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Occurrence by default: "edit the standup" almost always means this one.
  const [scope, setScope] = useState<'occurrence' | 'series'>('occurrence')
  const editingSeries = Boolean(editing && recurring && scope === 'series')
  /** Only a server event can carry invitations. */
  const serverEvent = Boolean(editing?.href)

  useEffect(() => {
    // An edit goes where the event already lives — there is no calendar to pick.
    if (editing) return
    let cancelled = false
    void window.workspace.calendar.writeTargets().then((c) => {
      if (cancelled) return
      setChoice(c)
      setTargetId(c.target?.id ?? c.options[0]?.id ?? null)
    }).catch((e: Error) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [editing])

  const target = choice?.options.find((o) => o.id === targetId) ?? null
  const set = <K extends keyof EventDraft>(k: K, v: EventDraft[K]): void =>
    setDraft((d) => ({ ...d, [k]: v }))

  const create = useCallback(async () => {
    const built = buildEventInput(draft)
    if (!built.ok) { setError(built.error); return }
    setBusy(true); setError(null)
    try {
      if (editing) {
        await window.workspace.calendar.updateEvent(
          {
            uid: editing.recurringUid ?? editing.uid,
            sourceId: editing.sourceId,
            ...(editing.href ? { href: editing.href } : {}),
            ...(recurring ? { scope, occurrence: occurrenceOf(editing) } : {}),
          },
          { summary: built.input.summary, start: built.input.start, end: built.input.end, allDay: built.input.allDay,
            ...(built.input.location ? { location: built.input.location } : {}),
            ...(built.input.description ? { description: built.input.description } : {}),
            // Replace WHO is invited only where invitations exist and the form
            // showed the field — never on a series edit or a local event.
            ...(serverEvent && !editingSeries ? { attendees: built.input.attendees } : {}) },
        )
        onUpdated?.()
      } else {
        const ev = await window.workspace.calendar.createEvent({
          ...built.input,
          ...(targetId ? { target: targetId } : {}),
        })
        onCreated({ calendar: ev.calendar, invited: ev.invited })
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [draft, targetId, editing, onCreated, onUpdated])

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.heading}>{editing ? 'Edit event' : 'New event'}</h2>

        {editing && recurring && (
          <div className={styles.kinds}>
            <button className={scope === 'occurrence' ? styles.kindOn : styles.kindOff} onClick={() => setScope('occurrence')}>
              Just this occurrence
            </button>
            <button className={scope === 'series' ? styles.kindOn : styles.kindOff} onClick={() => setScope('series')}>
              The whole series
            </button>
          </div>
        )}

        <label className={styles.field}>
          <span>Title</span>
          <input className={styles.input} value={draft.title} onChange={(e) => set('title', e.target.value)} autoFocus />
        </label>

        <label className={styles.field}>
          <span>Date</span>
          <input
            className={styles.input}
            type="date"
            value={draft.date}
            onChange={(e) => set('date', e.target.value)}
            disabled={editingSeries}
          />
          {editingSeries && (
            <small className={styles.hint}>The series keeps its own days — the time below applies to all of them.</small>
          )}
        </label>

        <label className={styles.check}>
          <input type="checkbox" checked={draft.allDay} onChange={(e) => set('allDay', e.target.checked)} />
          <span>All day</span>
        </label>

        {!draft.allDay && (
          <>
            <label className={styles.field}>
              <span>Starts</span>
              <input className={styles.input} type="time" value={draft.startTime} onChange={(e) => set('startTime', e.target.value)} />
            </label>
            <label className={styles.field}>
              <span>Ends</span>
              <input className={styles.input} type="time" value={draft.endTime} onChange={(e) => set('endTime', e.target.value)} />
            </label>
          </>
        )}

        <label className={styles.field}>
          <span>Location</span>
          <input className={styles.input} value={draft.location} onChange={(e) => set('location', e.target.value)} />
        </label>

        <label className={styles.field}>
          <span>Notes</span>
          <input className={styles.input} value={draft.description} onChange={(e) => set('description', e.target.value)} />
        </label>

        {editing ? (
          editingSeries ? (
            <p className={styles.hint}>
              Whoever is invited stays invited — the server tells them the series changed.
            </p>
          ) : serverEvent ? (
            <label className={styles.field}>
              <span>Invited (email addresses)</span>
              <input
                className={styles.input}
                value={draft.attendees}
                onChange={(e) => set('attendees', e.target.value)}
                placeholder="nobody yet — add addresses to invite"
                spellCheck={false}
              />
              <small className={styles.hint}>
                Removing an address uninvites that person; new ones are invited by the server.
                An answer somebody already gave is kept.
              </small>
            </label>
          ) : null
        ) : (
          <label className={styles.field}>
            <span>Invite (email addresses)</span>
            <input
              className={styles.input}
              value={draft.attendees}
              onChange={(e) => set('attendees', e.target.value)}
              placeholder="anna@example.com, ben@example.com"
              spellCheck={false}
              disabled={target != null && !target.canInvite}
            />
            {target != null && !target.canInvite && (
              <small className={styles.hint}>
                Invitations need a connected calendar account — this one is a local file, which can
                hold the meeting but cannot tell anyone about it.
              </small>
            )}
            {target?.canInvite && (
              <small className={styles.hint}>The server sends the invitations, collects replies, and handles reschedules.</small>
            )}
          </label>
        )}

        {!editing && choice != null && choice.options.length > 1 && (
          <label className={styles.field}>
            <span>Calendar</span>
            <select className={styles.input} value={targetId ?? ''} onChange={(e) => setTargetId(e.target.value)}>
              {choice.options.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
        )}
        {!editing && choice != null && choice.options.length === 1 && choice.options[0] && (
          <p className={styles.hint}>Goes in: {choice.options[0].label}</p>
        )}

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <button className={styles.secondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={styles.primary} onClick={() => void create()} disabled={busy || (!editing && choice == null)}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create event'}
          </button>
        </div>
      </div>
    </div>
  )
}
