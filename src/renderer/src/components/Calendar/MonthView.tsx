import type { CalendarEvent } from '../../types/workspace-api'
import { groupByDay, isToday, monthGrid, type EventAbility } from './calendarModel'
import styles from './CalendarPanel.module.css'

/**
 * The month at a glance: whole weeks, a few chips per day, "+N more" honesty
 * when a day holds more than fits. Clicking a day dives into its Day view;
 * chips open details; a writable chip drags to another day exactly like the
 * week view — same drop semantics, bigger map.
 */
interface Props {
  anchor: number
  events: CalendarEvent[]
  abilityOf: (ev: CalendarEvent) => EventAbility
  onOpen: (ev: CalendarEvent) => void
  onOpenDay: (day: number) => void
  onDropOnDay: (ev: CalendarEvent, day: number) => void
  draggedRef: React.MutableRefObject<CalendarEvent | null>
  dropDay: number | null
  setDropDay: (d: number | null) => void
}

const MAX_CHIPS = 3

export function MonthView({ anchor, events, abilityOf, onOpen, onOpenDay, onDropOnDay, draggedRef, dropDay, setDropDay }: Props): JSX.Element {
  const grid = monthGrid(anchor)
  const days = grid.weeks.flat()
  const grouped = new Map(groupByDay(events, days).map((g) => [g.day, g.events]))

  return (
    <div className={styles.monthRoot}>
      {grid.weeks.map((week) => (
        <div key={week[0]} className={styles.monthWeek}>
          {week.map((day) => {
            const dayEvents = grouped.get(day) ?? []
            const inMonth = new Date(day).getMonth() === grid.month
            return (
              <div
                key={day}
                className={[
                  styles.monthCell,
                  inMonth ? '' : styles.monthCellOut,
                  isToday(day) ? styles.dayToday : '',
                  dropDay === day ? styles.dayDrop : '',
                ].join(' ')}
                onDragOver={(e) => {
                  if (!draggedRef.current) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDropDay(day)
                }}
                onDragLeave={() => { if (dropDay === day) setDropDay(null) }}
                onDrop={(e) => {
                  e.preventDefault()
                  const ev = draggedRef.current
                  draggedRef.current = null
                  setDropDay(null)
                  if (ev) onDropOnDay(ev, day)
                }}
              >
                <button className={styles.monthDayNum} onClick={() => onOpenDay(day)}>
                  {new Date(day).getDate()}
                </button>
                {dayEvents.slice(0, MAX_CHIPS).map((e) => {
                  const ability = abilityOf(e)
                  return (
                    <button
                      key={`${e.uid}-${day}`}
                      className={`${styles.monthChip} ${ability.write ? styles.eventWritable : ''}`}
                      title={e.summary}
                      onClick={() => onOpen(e)}
                      draggable={ability.write}
                      onDragStart={(ev) => { draggedRef.current = e; ev.dataTransfer.effectAllowed = 'move' }}
                      onDragEnd={() => { draggedRef.current = null; setDropDay(null) }}
                    >
                      <span className={styles.stripe} style={e.color ? { background: e.color } : undefined} />
                      <span className={styles.monthChipText}>{e.summary}</span>
                    </button>
                  )
                })}
                {dayEvents.length > MAX_CHIPS && (
                  <button className={styles.monthMore} onClick={() => onOpenDay(day)}>
                    +{dayEvents.length - MAX_CHIPS} more
                  </button>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
