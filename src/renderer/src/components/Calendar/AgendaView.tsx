import type { CalendarEvent } from '../../types/workspace-api'
import { formatFullDayLabel, isToday, type AgendaDay } from './calendarModel'
import styles from './CalendarPanel.module.css'

/**
 * Events as a list under day headings — the Agenda view, and the shape search
 * results take. Which events, and how each time reads on its day, is decided in
 * calendarModel; this only lays it out. Rows open details; nothing drags here,
 * because a list has no place to drop onto.
 */
interface Props {
  days: AgendaDay[]
  /** Said instead of an empty list. */
  emptyText: string
  /** Display name of the calendar an event came from. */
  calendarOf: (sourceId: string) => string
  onOpen: (ev: CalendarEvent) => void
}

export function AgendaView({ days, emptyText, calendarOf, onOpen }: Props): JSX.Element {
  return (
    <div className={styles.agenda}>
      {days.length === 0 && <p className={styles.free}>{emptyText}</p>}
      {days.map(({ day, entries }) => (
        <section key={day} className={styles.agendaDay}>
          <h2 className={styles.dayHead}>
            <span className={styles.dayLabel}>{formatFullDayLabel(day)}</span>
            {isToday(day) && <span className={styles.todayDot} aria-label="Today" />}
          </h2>
          <ul className={styles.events}>
            {entries.map(({ event: e, when }) => (
              <li key={`${e.sourceId}-${e.uid}`}>
                <button className={`${styles.event} ${styles.agendaRow}`} onClick={() => onOpen(e)}>
                  <span className={styles.stripe} style={e.color ? { background: e.color } : undefined} />
                  <span className={styles.eventBody}>
                    <span className={styles.eventTime}>{when}</span>
                    <span className={styles.eventTitle}>{e.summary}</span>
                    <span className={styles.eventWhere}>
                      {[e.location, calendarOf(e.sourceId)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
