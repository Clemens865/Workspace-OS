import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CalendarEvent, CalendarSource, CalendarSourceStatus } from '../../types/workspace-api'
import { ConnectCalendarDialog } from './ConnectCalendarDialog'
import { NewEventDialog } from './NewEventDialog'
import { EventDetailsDialog } from './EventDetailsDialog'
import { DayView } from './DayView'
import { PromptBar } from '../PromptBar/PromptBar'
import { MonthView } from './MonthView'
import {
  addDays, addMonths, buildCalendarAsk, draftForSlot, eventAbility, formatDayLabel, formatEventTime,
  formatFullDayLabel, formatMonthLabel, formatWeekLabel, groupByDay, isToday, LOCAL_SOURCE, monthGrid,
  moveEventToTime, occurrenceOf, overlapsDay, shiftEventToDay, startOfDay, startOfWeek, weekDays, type EventDraft,
} from './calendarModel'
import styles from './CalendarPanel.module.css'

/**
 * The Calendar surface — a week of the user's real calendars, read from CalDAV
 * accounts and .ics subscriptions, and a New-event button that writes through
 * the same `calendar.createEvent` path the agent and the cockpit use, so every
 * route to "put this in the calendar" lands in the same place.
 *
 * Failures are per-source and never blank the view. If one account's password is
 * gone or a shared feed 404s, that source is called out by name while everything
 * else still shows — the honest read, and the one you can act on.
 */
type ViewKind = 'day' | 'week' | 'month'

export function CalendarPanel(): JSX.Element {
  const [view, setView] = useState<ViewKind>('week')
  // The day the view is anchored on; week/month are derived from it, so
  // switching views keeps looking at the same place in time.
  const [anchor, setAnchor] = useState(() => startOfDay(Date.now()))
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [sources, setSources] = useState<CalendarSource[]>([])
  const [status, setStatus] = useState<CalendarSourceStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [connectOpen, setConnectOpen] = useState(false)
  const [newEventOpen, setNewEventOpen] = useState(false)
  // What the last write reported — the only visible proof invitations went out.
  const [notice, setNotice] = useState<string | null>(null)
  const [details, setDetails] = useState<CalendarEvent | null>(null)
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  // The event mid-drag. A ref, not dataTransfer: drag data is string-only and
  // unreadable during dragover, and the drag never leaves this component.
  const draggedRef = useRef<CalendarEvent | null>(null)
  const [dropDay, setDropDay] = useState<number | null>(null)
  // "Ask" — hand the visible range to an agent with any instruction.
  const [askBusy, setAskBusy] = useState(false)
  // Prefills New-event when a time slot was double-clicked in the day grid.
  const [slotDraft, setSlotDraft] = useState<Partial<EventDraft> | null>(null)

  const weekStart = useMemo(() => startOfWeek(anchor), [anchor])
  const days = useMemo(() => weekDays(weekStart), [weekStart])

  /** What is on screen, as [from, to) — one day of slack on each side. */
  const range = useMemo(() => {
    if (view === 'day') return { from: addDays(anchor, -1), to: addDays(anchor, 2) }
    if (view === 'week') return { from: addDays(weekStart, -1), to: addDays(weekStart, 8) }
    const g = monthGrid(anchor)
    return { from: addDays(g.weeks[0][0], -1), to: addDays(g.weeks.at(-1)![6], 2) }
  }, [view, anchor, weekStart])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [srcs, v] = await Promise.all([
        window.workspace.calendar.sources(),
        window.workspace.calendar.events(range.from, range.to),
      ])
      setSources(srcs)
      setEvents(v.events)
      setStatus(v.sources)
    } catch {
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { void load() }, [load])

  // A calendar-ask agent run finishing means the calendar may have changed.
  useEffect(() => {
    return window.workspace.agent.onDone((runId) => {
      if (runId.startsWith('calendar-ask-')) {
        setAskBusy(false)
        setNotice('The agent finished — anything it scheduled is in the view now.')
        void load()
      }
    })
  }, [load])

  /** One step of the view's own unit — what ‹ › mean here. */
  const step = useCallback((delta: number) => {
    setAnchor((a) => (view === 'day' ? addDays(a, delta) : view === 'week' ? addDays(a, 7 * delta) : addMonths(a, delta)))
  }, [view])

  const title = view === 'day' ? formatFullDayLabel(anchor) : view === 'week' ? formatWeekLabel(weekStart) : formatMonthLabel(anchor)

  const runAsk = useCallback(async (instruction: string, mentions: string[]) => {
    if (!instruction.trim() && mentions.length === 0) return
    const inView = events
      .filter((e) => e.end > range.from && e.start < range.to)
      .map((e) => ({
        summary: e.summary, start: e.start, end: e.end, allDay: e.allDay,
        ...(e.location ? { location: e.location } : {}),
        calendar: sources.find((s) => s.id === e.sourceId)?.displayName ?? 'On this Mac',
      }))
    const prompt = buildCalendarAsk(instruction.trim() || 'Look at the attached files.', title, inView)
    setAskBusy(true)
    setNotice('Asked the agent — it is working; the view refreshes when it finishes.')
    try {
      // @-mentions ride the real context-files slot.
      await window.workspace.agent.run(`calendar-ask-${Date.now()}`, prompt, mentions, null, 'full', null)
    } catch (e) {
      setAskBusy(false)
      setNotice(`Could not start the agent: ${(e as Error).message}`)
    }
  }, [events, range, sources, title])

  const grouped = useMemo(() => groupByDay(events, days), [events, days])
  const failing = status.filter((s) => s.error)

  const disconnect = useCallback(async (id: string) => {
    await window.workspace.calendar.remove(id)
    await load()
  }, [load])

  /** Which connected source an event came from, for its abilities and its name. */
  const kindOf = useCallback(
    (sourceId: string) => sources.find((s) => s.id === sourceId)?.kind,
    [sources],
  )
  const sourceNameOf = useCallback(
    (sourceId: string) =>
      sourceId === LOCAL_SOURCE ? 'On this Mac' : sources.find((s) => s.id === sourceId)?.displayName ?? 'Calendar',
    [sources],
  )

  /** The write identity of an event — master uid, server address, and, for a
   * series slice being MOVED, which occurrence is meant. */
  const refOf = (ev: CalendarEvent, recurring: boolean): { uid: string; sourceId?: string; href?: string; scope?: 'occurrence' | 'series'; occurrence?: number } => ({
    uid: ev.recurringUid ?? ev.uid,
    sourceId: ev.sourceId,
    ...(ev.href ? { href: ev.href } : {}),
    ...(recurring ? { scope: 'occurrence' as const, occurrence: occurrenceOf(ev) } : {}),
  })

  /** Drop an event on a day: same time, same duration, that day. A series
   * slice moves as ONE occurrence — dragging Tuesday's standup must not move
   * every standup ever. */
  const rescheduleTo = useCallback(async (ev: CalendarEvent, dayStart: number) => {
    if (startOfDay(ev.start) === dayStart) return
    const recurring = eventAbility(ev, kindOf).recurring
    const shifted = shiftEventToDay(ev, dayStart)
    try {
      await window.workspace.calendar.updateEvent(refOf(ev, recurring), {
        summary: ev.summary,
        start: shifted.start,
        end: shifted.end,
        allDay: ev.allDay,
        ...(ev.location ? { location: ev.location } : {}),
        ...(ev.description ? { description: ev.description } : {}),
      })
      setNotice(`Moved to ${formatDayLabel(dayStart)}${recurring ? ' — just this occurrence' : ''}${ev.href ? '; anyone invited is told' : ''}.`)
    } catch (e) {
      setNotice(`Could not move it: ${(e as Error).message}`)
    }
    await load()
  }, [load, kindOf])

  const deleteEvent = useCallback(async (ev: CalendarEvent, scope: 'single' | 'occurrence' | 'series') => {
    const base = { uid: ev.recurringUid ?? ev.uid, sourceId: ev.sourceId, ...(ev.href ? { href: ev.href } : {}) }
    await window.workspace.calendar.removeEvent(
      scope === 'occurrence' ? { ...base, scope: 'occurrence' as const, occurrence: occurrenceOf(ev) } : base,
    )
    setDetails(null)
    setNotice(
      scope === 'occurrence'
        ? 'This occurrence is gone — the series continues.'
        : ev.href
          ? `Deleted${scope === 'series' ? ' — the whole series' : ''}; anyone invited is told it is cancelled.`
          : 'Deleted.',
    )
    await load()
  }, [load])

  return (
    <div className={styles.root}>
      <header className={styles.bar}>
        <div className={styles.nav}>
          <button className={styles.navBtn} onClick={() => step(-1)} title={`Previous ${view}`}>‹</button>
          <button className={styles.today} onClick={() => setAnchor(startOfDay(Date.now()))}>Today</button>
          <button className={styles.navBtn} onClick={() => step(1)} title={`Next ${view}`}>›</button>
        </div>
        <h1 className={styles.title}>{title}</h1>
        <div className={styles.viewSwitch} role="tablist">
          {(['day', 'week', 'month'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              className={view === v ? styles.viewOn : styles.viewOff}
              onClick={() => setView(v)}
            >
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <div className={styles.spacer} />
        <div className={styles.askWrap}>
          <PromptBar
            compact
            popover="down"
            placeholder={askBusy ? 'The agent is working…' : 'Ask an agent — @ mentions a file'}
            disabled={askBusy}
            onSubmit={(t, m) => void runAsk(t, m)}
          />
        </div>
        <button className={styles.connect} onClick={() => { setNotice(null); setNewEventOpen(true) }}>New event</button>
        <button className={styles.connect} onClick={() => setConnectOpen(true)}>Add calendar</button>
      </header>

      {notice && <p className={styles.notice}>{notice}</p>}

      {failing.length > 0 && (
        <div className={styles.warnings}>
          {failing.map((s) => (
            <p key={s.id} className={styles.warning}>
              <strong>{s.displayName}</strong> — {s.error}
            </p>
          ))}
        </div>
      )}

      {sources.length === 0 && !loading ? (
        <div className={styles.empty}>
          <div>
            <h2>No calendars yet</h2>
            <p>
              Connect a CalDAV account — iCloud, Fastmail, Nextcloud — with an app-specific
              password, or subscribe to a shared <code>.ics</code> link. Everything stays on
              this machine.
            </p>
            <button className={styles.connectBig} onClick={() => setConnectOpen(true)}>Add a calendar</button>
          </div>
        </div>
      ) : view === 'day' ? (
        <DayView
          day={anchor}
          events={events.filter((e) => overlapsDay(e, anchor))}
          abilityOf={(e) => eventAbility(e, kindOf)}
          onOpen={(e) => { setNotice(null); setDetails(e) }}
          onDropAt={(e, startMs) => {
            const recurring = eventAbility(e, kindOf).recurring
            const moved = moveEventToTime(e, startMs)
            void (async () => {
              try {
                await window.workspace.calendar.updateEvent(refOf(e, recurring), {
                  summary: e.summary, start: moved.start, end: moved.end, allDay: e.allDay,
                  ...(e.location ? { location: e.location } : {}),
                  ...(e.description ? { description: e.description } : {}),
                })
                setNotice(`Moved${recurring ? ' — just this occurrence' : ''}${e.href ? '; anyone invited is told' : ''}.`)
              } catch (err) {
                setNotice(`Could not move it: ${(err as Error).message}`)
              }
              await load()
            })()
          }}
          onCreateAt={(startMs) => { setSlotDraft(draftForSlot(startMs)); setNewEventOpen(true) }}
          draggedRef={draggedRef}
        />
      ) : view === 'month' ? (
        <MonthView
          anchor={anchor}
          events={events}
          abilityOf={(e) => eventAbility(e, kindOf)}
          onOpen={(e) => { setNotice(null); setDetails(e) }}
          onOpenDay={(day) => { setAnchor(day); setView('day') }}
          onDropOnDay={(e, day) => void rescheduleTo(e, day)}
          draggedRef={draggedRef}
          dropDay={dropDay}
          setDropDay={setDropDay}
        />
      ) : (
        <div className={styles.week}>
          {grouped.map(({ day, events: dayEvents }) => (
            <section
              key={day}
              className={`${styles.day} ${isToday(day) ? styles.dayToday : ''} ${dropDay === day ? styles.dayDrop : ''}`}
              onDragOver={(e) => {
                if (!draggedRef.current) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setDropDay(day)
              }}
              onDragLeave={() => setDropDay((d) => (d === day ? null : d))}
              onDrop={(e) => {
                e.preventDefault()
                const ev = draggedRef.current
                draggedRef.current = null
                setDropDay(null)
                if (ev) void rescheduleTo(ev, day)
              }}
            >
              <h2 className={styles.dayHead}>
                <span className={styles.dayLabel}>{formatDayLabel(day)}</span>
                {isToday(day) && <span className={styles.todayDot} aria-label="Today" />}
              </h2>
              {dayEvents.length === 0 ? (
                <p className={styles.free}>—</p>
              ) : (
                <ul className={styles.events}>
                  {dayEvents.map((e) => {
                    const ability = eventAbility(e, kindOf)
                    return (
                      <li
                        key={`${e.uid}-${day}`}
                        className={`${styles.event} ${ability.write ? styles.eventWritable : ''}`}
                        title={e.description || e.summary}
                        onClick={() => { setNotice(null); setDetails(e) }}
                        draggable={ability.write}
                        onDragStart={(ev) => {
                          draggedRef.current = e
                          ev.dataTransfer.effectAllowed = 'move'
                        }}
                        onDragEnd={() => { draggedRef.current = null; setDropDay(null) }}
                      >
                        <span className={styles.stripe} style={e.color ? { background: e.color } : undefined} />
                        <span className={styles.eventBody}>
                          <span className={styles.eventTime}>{formatEventTime(e)}</span>
                          <span className={styles.eventTitle}>{e.summary}</span>
                          {e.location && <span className={styles.eventWhere}>{e.location}</span>}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      {sources.length > 0 && (
        <footer className={styles.footer}>
          {sources.map((s) => (
            <span key={s.id} className={styles.sourceChip}>
              {s.displayName}
              <button className={styles.remove} onClick={() => void disconnect(s.id)} title={`Disconnect ${s.displayName}`}>×</button>
            </span>
          ))}
          {loading && <span className={styles.loading}>Syncing…</span>}
        </footer>
      )}

      {connectOpen && (
        <ConnectCalendarDialog
          onClose={() => setConnectOpen(false)}
          onConnected={() => { setConnectOpen(false); void load() }}
        />
      )}

      {(newEventOpen || editing) && (
        <NewEventDialog
          weekStart={weekStart}
          editing={editing}
          recurring={editing ? eventAbility(editing, kindOf).recurring : false}
          initialDraft={slotDraft ?? undefined}
          onClose={() => { setNewEventOpen(false); setEditing(null); setSlotDraft(null) }}
          onCreated={({ calendar, invited }) => {
            setNewEventOpen(false)
            setSlotDraft(null)
            setNotice(
              invited.length > 0
                ? `Added to ${calendar} — invitations sent to ${invited.join(', ')}.`
                : `Added to ${calendar}.`,
            )
            void load()
          }}
          onUpdated={() => {
            const wasServer = Boolean(editing?.href)
            setEditing(null)
            setNotice(wasServer ? 'Saved — anyone invited is told about the change.' : 'Saved.')
            void load()
          }}
        />
      )}

      {details && !editing && (
        <EventDetailsDialog
          event={details}
          sourceName={sourceNameOf(details.sourceId)}
          ability={eventAbility(details, kindOf)}
          onClose={() => setDetails(null)}
          onEdit={() => { setEditing(details); setDetails(null) }}
          onDelete={(scope) => deleteEvent(details, scope)}
        />
      )}
    </div>
  )
}
