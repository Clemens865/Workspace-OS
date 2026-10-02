import { useState } from 'react'
import type { CalendarEvent } from '../../types/workspace-api'
import { formatDayLabel, formatEventTime, startOfDay, type EventAbility } from './calendarModel'
// Same stylesheet as the other calendar dialogs — one family, one look.
import styles from './ConnectCalendarDialog.module.css'

/**
 * What an event IS, on one card: when, where, in which calendar, who is
 * invited and where their RSVP stands — and what can be done to it. The
 * controls follow the panel's honesty rule: anything not possible says WHY.
 *
 * A recurring event asks the occurrence-or-series question EXPLICITLY on
 * delete: "delete" on a weekly standup is ambiguous, and each answer is
 * irreversible in a different way, so the two are separate buttons with
 * separate consequences written next to them.
 */
export type DeleteScope = 'single' | 'occurrence' | 'series'

interface Props {
  event: CalendarEvent
  /** Display name of the calendar/source the event came from. */
  sourceName: string
  ability: EventAbility
  onClose: () => void
  onEdit: () => void
  /** Resolves when the event is gone; the dialog shows the error otherwise. */
  onDelete: (scope: DeleteScope) => Promise<void>
}

/** RSVP state as a glyph a row can carry without a legend. */
function rsvp(partstat?: string): string {
  switch (partstat) {
    case 'ACCEPTED': return '✓'
    case 'DECLINED': return '✕'
    case 'TENTATIVE': return '~'
    default: return '·' // no answer yet, or the feed did not say
  }
}

export function EventDetailsDialog({ event, sourceName, ability, onClose, onEdit, onDelete }: Props): JSX.Element {
  const [confirming, setConfirming] = useState<DeleteScope | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const days = event.allDay && event.end - event.start > 86_400_000
    ? `${formatDayLabel(event.start)} – ${formatDayLabel(startOfDay(event.end - 1))}`
    : formatDayLabel(startOfDay(event.start))

  const remove = async (scope: DeleteScope): Promise<void> => {
    setBusy(true); setError(null)
    try {
      await onDelete(scope)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
      setConfirming(null)
    }
  }

  const confirmText: Record<DeleteScope, string> = {
    single: event.href ? 'Gone from every device — and anyone invited is told it is cancelled.' : 'This removes the event.',
    occurrence: 'Only this occurrence disappears. The series continues.',
    series: 'The WHOLE series goes, every occurrence — and anyone invited is told it is cancelled.',
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.heading}>{event.summary || '(no title)'}</h2>

        <p className={styles.hint}>
          {days} · {formatEventTime(event)}
        </p>
        <p className={styles.hint}>In: {sourceName}</p>
        {event.location && <p className={styles.hint}>Where: {event.location}</p>}
        {ability.recurring && <p className={styles.hint}>Part of a repeating series.</p>}
        {event.description && <p className={styles.hint}>{event.description}</p>}

        {(event.organizer || (event.attendees?.length ?? 0) > 0) && (
          <div className={styles.found}>
            {event.organizer && (
              <p className={styles.foundHead}>
                Organised by {event.organizer.name ?? event.organizer.email}
              </p>
            )}
            {event.attendees?.map((a) => (
              <p key={a.email} className={styles.foundHead} title={a.partstat ?? 'no answer yet'}>
                {rsvp(a.partstat)} {a.name ? `${a.name} — ` : ''}{a.email}
              </p>
            ))}
          </div>
        )}

        {!ability.write && ability.reason && <p className={styles.hint}>{ability.reason}</p>}
        {ability.write && !ability.editForm && ability.formReason && (
          <p className={styles.hint}>{ability.formReason}</p>
        )}

        {error && <p className={styles.error}>{error}</p>}

        {confirming ? (
          <div className={styles.actions}>
            <span className={styles.hint}>{confirmText[confirming]}</span>
            <button className={styles.secondary} onClick={() => setConfirming(null)} disabled={busy}>Keep it</button>
            <button className={styles.primary} onClick={() => void remove(confirming)} disabled={busy}>
              {busy ? 'Deleting…' : confirming === 'series' ? 'Delete series' : 'Delete'}
            </button>
          </div>
        ) : (
          <div className={styles.actions}>
            <button className={styles.secondary} onClick={onClose}>Close</button>
            {ability.write && ability.recurring ? (
              <>
                <button className={styles.secondary} onClick={() => setConfirming('occurrence')}>Delete this one…</button>
                <button className={styles.secondary} onClick={() => setConfirming('series')}>Delete series…</button>
              </>
            ) : ability.write ? (
              <button className={styles.secondary} onClick={() => setConfirming('single')}>Delete…</button>
            ) : null}
            {ability.write && ability.editForm && (
              <button className={styles.primary} onClick={onEdit}>Edit</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
