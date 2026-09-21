import { useEffect, useRef } from 'react'
import type { CalendarEvent } from '../../types/workspace-api'
import {
  formatEventTime, layoutDayEvents, minutesIntoDay, timeAtOffset, isToday,
  type EventAbility,
} from './calendarModel'
import styles from './CalendarPanel.module.css'

/** Pixel height of one hour in the grid. */
export const HOUR_PX = 48

/**
 * One day as an hour grid — the view where TIME is the axis, so a drag lands
 * on a time rather than just a day. Timed events are absolutely positioned by
 * their minutes into the day (overlaps split into columns); all-day events sit
 * in a strip above the grid, where "when" is the whole day and a y-position
 * would be a lie.
 */
interface Props {
  day: number
  /** Events overlapping this day (the panel already filtered them). */
  events: CalendarEvent[]
  abilityOf: (ev: CalendarEvent) => EventAbility
  onOpen: (ev: CalendarEvent) => void
  /** A writable event dropped at a grid time (already snapped). */
  onDropAt: (ev: CalendarEvent, startMs: number) => void
  /** Double-click on an empty slot — create an event starting there. */
  onCreateAt: (startMs: number) => void
  /** The panel-owned drag state, shared with the other views. */
  draggedRef: React.MutableRefObject<CalendarEvent | null>
}

export function DayView({ day, events, abilityOf, onOpen, onDropAt, onCreateAt, draggedRef }: Props): JSX.Element {
  const gridRef = useRef<HTMLDivElement>(null)

  // Open on working hours, not midnight — 08:00 at the top on first render.
  useEffect(() => {
    gridRef.current?.parentElement?.scrollTo({ top: 8 * HOUR_PX })
  }, [day])

  const allDay = events.filter((e) => e.allDay)
  const placements = layoutDayEvents(events)

  /** Clamped minutes into THIS day, for events that spill over its edges. */
  const minutesIn = (ms: number): number => Math.max(0, Math.min(1440, (ms - day) / 60_000))

  const timeFromPointer = (e: React.MouseEvent | React.DragEvent): number => {
    const rect = gridRef.current!.getBoundingClientRect()
    return timeAtOffset(day, e.clientY - rect.top, HOUR_PX, 15)
  }

  return (
    <div className={styles.dayViewRoot}>
      {allDay.length > 0 && (
        <div className={styles.allDayStrip}>
          {allDay.map((e) => (
            <button key={e.uid} className={styles.allDayChip} onClick={() => onOpen(e)}>
              <span className={styles.stripe} style={e.color ? { background: e.color } : undefined} />
              {e.summary}
            </button>
          ))}
        </div>
      )}
      <div className={styles.dayScroll}>
        <div
          ref={gridRef}
          className={styles.dayGrid}
          style={{ height: 24 * HOUR_PX }}
          onDragOver={(e) => { if (draggedRef.current) e.preventDefault() }}
          onDrop={(e) => {
            e.preventDefault()
            const ev = draggedRef.current
            draggedRef.current = null
            if (ev) onDropAt(ev, timeFromPointer(e))
          }}
          onDoubleClick={(e) => onCreateAt(timeFromPointer(e))}
        >
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className={styles.hourLine} style={{ top: h * HOUR_PX }}>
              <span className={styles.hourLabel}>{String(h).padStart(2, '0')}:00</span>
            </div>
          ))}
          {isToday(day) && (
            <div className={styles.nowLine} style={{ top: (minutesIntoDay(Date.now()) / 60) * HOUR_PX }} />
          )}
          {placements.map(({ event: e, col, cols }) => {
            const top = (minutesIn(e.start) / 60) * HOUR_PX
            const height = Math.max(18, ((minutesIn(e.end) - minutesIn(e.start)) / 60) * HOUR_PX)
            const ability = abilityOf(e)
            return (
              <div
                key={e.uid}
                className={`${styles.dayBlock} ${ability.write ? styles.eventWritable : ''}`}
                style={{
                  top,
                  height,
                  left: `calc(52px + (100% - 60px) * ${col / cols})`,
                  width: `calc((100% - 60px) / ${cols} - 4px)`,
                }}
                title={e.description || e.summary}
                onClick={() => onOpen(e)}
                draggable={ability.write}
                onDragStart={(ev) => { draggedRef.current = e; ev.dataTransfer.effectAllowed = 'move' }}
                onDragEnd={() => { draggedRef.current = null }}
              >
                <span className={styles.stripe} style={e.color ? { background: e.color } : undefined} />
                <span className={styles.eventBody}>
                  <span className={styles.eventTime}>{formatEventTime(e)}</span>
                  <span className={styles.eventTitle}>{e.summary}</span>
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
