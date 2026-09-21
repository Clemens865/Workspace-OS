import type { CalendarEvent } from '../../types/workspace-api'

/**
 * Pure view model for the Calendar surface.
 *
 * All the date arithmetic lives here rather than in the component, because this
 * is where calendars actually go wrong: week boundaries, all-day events that span
 * days, DST transitions, and "today" drifting across midnight. Keeping it pure
 * means those cases are unit tests instead of screenshots.
 */

const DAY_MS = 86_400_000

/** Local midnight at the start of the day containing `ms`. */
export function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Local midnight of the week containing `ms`.
 *
 * `weekStartsOn` defaults to Monday: the app's audience is working people and a
 * work week starting Sunday reads wrong for most of them. Uses calendar-day
 * stepping rather than subtracting milliseconds, so a DST change inside the week
 * cannot shift the boundary by an hour.
 */
export function startOfWeek(ms: number, weekStartsOn = 1): number {
  const d = new Date(startOfDay(ms))
  const shift = (d.getDay() - weekStartsOn + 7) % 7
  d.setDate(d.getDate() - shift)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Add days by calendar arithmetic (DST-safe, unlike `+ n * DAY_MS`). */
export function addDays(ms: number, days: number): number {
  const d = new Date(ms)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

/** The seven local day-start stamps of the week containing `ms`. */
export function weekDays(ms: number, weekStartsOn = 1): number[] {
  const first = startOfWeek(ms, weekStartsOn)
  return Array.from({ length: 7 }, (_, i) => addDays(first, i))
}

/** Does an event overlap the day starting at `dayStart`? */
export function overlapsDay(ev: Pick<CalendarEvent, 'start' | 'end'>, dayStart: number): boolean {
  const dayEnd = addDays(dayStart, 1)
  // End is EXCLUSIVE, so an event ending exactly at midnight belongs to the
  // previous day only — otherwise every evening meeting bleeds into tomorrow.
  return ev.start < dayEnd && ev.end > dayStart
}

/**
 * Group events by day for the given days. A multi-day event appears on EVERY day
 * it covers, which is what a reader expects from a three-day trip.
 */
export function groupByDay(
  events: readonly CalendarEvent[],
  days: readonly number[],
): { day: number; events: CalendarEvent[] }[] {
  return days.map((day) => ({
    day,
    events: events
      .filter((e) => overlapsDay(e, day))
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start || a.summary.localeCompare(b.summary)),
  }))
}

/** `09:30`, in the viewer's locale. All-day events have no meaningful time. */
export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/** The time range to show on an event row — `—` for all-day. */
export function formatEventTime(ev: Pick<CalendarEvent, 'start' | 'end' | 'allDay'>): string {
  if (ev.allDay) return 'All day'
  if (ev.end <= ev.start) return formatTime(ev.start)
  return `${formatTime(ev.start)} – ${formatTime(ev.end)}`
}

/** `Mon 29 Jul`, in the viewer's locale. */
export function formatDayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

/** The week's own label, e.g. `29 Jul – 4 Aug 2026`. */
export function formatWeekLabel(weekStart: number): string {
  const end = addDays(weekStart, 6)
  const a = new Date(weekStart), b = new Date(end)
  const sameMonth = a.getMonth() === b.getMonth()
  const left = a.toLocaleDateString(undefined, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' })
  const right = b.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  return `${left} – ${right}`
}

export function isToday(dayStart: number, now = Date.now()): boolean {
  return startOfDay(now) === dayStart
}

/** Minutes from local midnight — drives the position of a day-grid row. */
export function minutesIntoDay(ms: number): number {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

/* ── day / month views ──────────────────────────────────────────────────── */

/** Calendar-arithmetic month step, clamped so Jan 31 + 1 month is Feb, not Mar. */
export function addMonths(ms: number, months: number): number {
  const d = new Date(ms)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  return d.getTime()
}

/** `August 2026`, in the viewer's locale. */
export function formatMonthLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/** `Wednesday, 20 Aug 2026` — the day view's own title. */
export function formatFullDayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * The month grid containing `ms`: whole weeks (Mon-first), padded with the
 * neighbouring months' days so every row has seven cells — how every month
 * view a person has ever used is shaped.
 */
export function monthGrid(ms: number): { weeks: number[][]; month: number } {
  const d = new Date(startOfDay(ms))
  const month = d.getMonth()
  const first = new Date(d.getFullYear(), month, 1).getTime()
  const firstCell = startOfWeek(first)
  const weeks: number[][] = []
  let cur = firstCell
  do {
    const week = Array.from({ length: 7 }, (_, i) => addDays(cur, i))
    weeks.push(week)
    cur = addDays(cur, 7)
  } while (new Date(cur).getMonth() === month && weeks.length < 6)
  return { weeks, month }
}

/** A timed event placed in the day grid: which column of how many, for overlaps. */
export interface DayPlacement {
  event: CalendarEvent
  col: number
  cols: number
}

/**
 * Lays out one day's TIMED events side-by-side where they overlap.
 *
 * Greedy first-free-column assignment, then every member of an overlapping run
 * is widened to the run's column count — two parallel meetings each get half
 * the width, a lone one gets it all.
 */
export function layoutDayEvents(events: readonly CalendarEvent[]): DayPlacement[] {
  const timed = events.filter((e) => !e.allDay).sort((a, b) => a.start - b.start || a.end - b.end)
  const out: DayPlacement[] = []
  let group: { event: CalendarEvent; col: number }[] = []
  let groupMaxEnd = 0
  const flush = (): void => {
    const cols = Math.max(1, ...group.map((p) => p.col + 1))
    for (const p of group) out.push({ event: p.event, col: p.col, cols })
    group = []
  }
  for (const event of timed) {
    if (group.length > 0 && event.start >= groupMaxEnd) flush()
    const used = new Set(group.filter((p) => p.event.end > event.start).map((p) => p.col))
    let col = 0
    while (used.has(col)) col++
    group.push({ event, col })
    groupMaxEnd = Math.max(groupMaxEnd, event.end)
  }
  if (group.length > 0) flush()
  return out
}

/** The instant at a vertical offset in the day grid, snapped to `snapMin`. */
export function timeAtOffset(dayStart: number, offsetPx: number, pxPerHour: number, snapMin = 15): number {
  const rawMin = (offsetPx / pxPerHour) * 60
  const snapped = Math.round(rawMin / snapMin) * snapMin
  const clamped = Math.max(0, Math.min(24 * 60 - snapMin, snapped))
  const d = new Date(dayStart)
  d.setHours(Math.floor(clamped / 60), clamped % 60, 0, 0)
  return d.getTime()
}

/** A dropped event re-timed to `newStart`, duration kept. */
export function moveEventToTime(
  ev: Pick<CalendarEvent, 'start' | 'end'>,
  newStart: number,
): { start: number; end: number } {
  return { start: newStart, end: newStart + (ev.end - ev.start) }
}

/* ── asking an agent about the calendar ─────────────────────────────────── */

/**
 * The prompt for "Ask" on the Calendar surface: the instruction, then the
 * visible range's events laid out plainly, then the rules.
 *
 * The events go INTO the prompt because the agent has no calendar-read action —
 * and it should reason about exactly what the person is looking at, not about
 * whatever a second fetch would return a moment later. Creating events it CAN
 * do (`wos-action run calendar.createEvent`); inventing invitees or times it
 * may not, and the rules say so in the same breath.
 */
export function buildCalendarAsk(
  instruction: string,
  rangeLabel: string,
  events: readonly (Pick<CalendarEvent, 'summary' | 'start' | 'end' | 'allDay' | 'location'> & { calendar: string })[],
): string {
  const lines = events.map((e) => {
    const day = new Date(e.start).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
    const when = e.allDay ? 'all day' : `${formatTime(e.start)}–${formatTime(e.end)}`
    const where = e.location ? ` @ ${e.location}` : ''
    return `- ${day} ${when} · ${e.summary}${where} (${e.calendar})`
  })
  return [
    instruction.trim(),
    '',
    `THE CALENDAR — ${rangeLabel}:`,
    ...(lines.length > 0 ? lines : ['(no events in view)']),
    '',
    'Times above are local. Today is ' + new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }) + '.',
    'You can put NEW events in the calendar with `wos-action run calendar.createEvent --summary "<title>" --start <epoch-ms> --end <epoch-ms>`.',
    'Do not invent attendees, and if it is unclear which day or time is meant, say so instead of guessing.',
  ].join('\n')
}

export const DAY_MILLIS = DAY_MS

// ── New-event form ──────────────────────────────────────────────────────────
// The form's fields are strings straight from <input type=date|time>; turning
// them into a createEvent payload is pure date arithmetic and validation, so it
// lives here where it is unit-testable rather than in the dialog component.

/** What the New-event form holds, exactly as typed. */
export interface EventDraft {
  title: string
  /** `YYYY-MM-DD` from an <input type=date>. */
  date: string
  /** `HH:MM` from an <input type=time>; ignored when allDay. */
  startTime: string
  endTime: string
  allDay: boolean
  location: string
  description: string
  /** Free text: emails separated by commas, semicolons or whitespace. */
  attendees: string
}

/** The date+times the form starts from: today when it is in the viewed week,
 * otherwise the viewed week's first day — a person who navigated three weeks
 * ahead is planning THERE, not today. */
export function defaultDraft(weekStart: number, now = Date.now()): EventDraft {
  const inView = weekDays(weekStart).some((d) => startOfDay(now) === d)
  const day = new Date(inView ? now : weekStart)
  const y = day.getFullYear()
  const m = String(day.getMonth() + 1).padStart(2, '0')
  const d = String(day.getDate()).padStart(2, '0')
  return {
    title: '', date: `${y}-${m}-${d}`, startTime: '09:00', endTime: '10:00',
    allDay: false, location: '', description: '', attendees: '',
  }
}

/** Source id of events the app owns (mirrors LOCAL_SOURCE_ID in main). */
export const LOCAL_SOURCE = 'workspace-os-local'

/** What can be done to an event, and — when something can't — why not. */
export interface EventAbility {
  /** Delete and drag-reschedule. */
  write: boolean
  /** The edit form can represent it (single-day). */
  editForm: boolean
  /** A slice of a series — edits and deletes ask occurrence-or-series. */
  recurring: boolean
  /** Why write is off. */
  reason?: string
  /** Why the form is off even though write is on. */
  formReason?: string
}

/**
 * Which occurrence of a series this instance IS, for occurrence-scoped writes.
 * An untouched expanded instance starts at its original slot; an override
 * carries the original in recurrenceId no matter where it was moved to.
 */
export function occurrenceOf(ev: Pick<CalendarEvent, 'start' | 'recurrenceId'>): number {
  return ev.recurrenceId ?? ev.start
}

/** True when the event covers more than one local calendar day. */
export function spansDays(ev: Pick<CalendarEvent, 'start' | 'end' | 'allDay'>): boolean {
  if (ev.allDay) return ev.end - ev.start > DAY_MS
  // End is exclusive: ending exactly at midnight still belongs to the start day.
  return startOfDay(ev.start) !== startOfDay(Math.max(ev.start, ev.end - 1))
}

/**
 * Decides what the surface may offer for an event.
 *
 * Honesty rule carried over from the panel: a control that would fail after
 * being clicked is worse than its absence WITH the reason. So the reasons are
 * part of the result, for the details view to show.
 */
export function eventAbility(
  ev: Pick<CalendarEvent, 'start' | 'end' | 'allDay' | 'sourceId' | 'href' | 'rrule' | 'recurringUid' | 'recurrenceId'>,
  kindOf: (sourceId: string) => string | undefined,
): EventAbility {
  const recurring = Boolean(ev.rrule || ev.recurringUid || ev.recurrenceId !== undefined)
  const no = (reason: string): EventAbility => ({ write: false, editForm: false, recurring, reason })

  if (ev.sourceId !== LOCAL_SOURCE) {
    const kind = kindOf(ev.sourceId)
    if (kind === 'ics') return no('From a subscribed feed — it belongs to whoever publishes it.')
    if (kind === 'google' || kind === 'microsoft') return no('This account is connected read-only.')
    if (kind !== 'caldav') return no('This calendar is read-only.')
    if (!ev.href) return no('The server did not say where this event lives, so it cannot be changed from here.')
  } else if (recurring) {
    // Occurrence surgery (EXDATE, overrides) is built for server calendars;
    // the local file has no path that creates a series in the first place.
    return no('A repeating event in the local calendar can only be changed where it was created.')
  }

  if (spansDays(ev)) {
    return { write: true, editForm: false, recurring, formReason: 'Spans several days — drag it to move it, or edit it where it was created.' }
  }
  return { write: true, editForm: true, recurring }
}

/** The same event shifted to another day: same time of day, same duration. */
export function shiftEventToDay(
  ev: Pick<CalendarEvent, 'start' | 'end' | 'allDay'>,
  dayStart: number,
): { start: number; end: number } {
  if (ev.allDay) {
    const days = Math.max(1, Math.round((ev.end - ev.start) / DAY_MS))
    return { start: dayStart, end: addDays(dayStart, days) }
  }
  // Calendar arithmetic, not millisecond offsets: a shift across a DST change
  // must keep "09:00" meaning 09:00.
  const s = new Date(ev.start)
  const d = new Date(dayStart)
  d.setHours(s.getHours(), s.getMinutes(), s.getSeconds(), s.getMilliseconds())
  const start = d.getTime()
  return { start, end: start + (ev.end - ev.start) }
}

const two = (n: number): string => String(n).padStart(2, '0')

/** Prefill the form from an existing event (single-day; see eventAbility). */
export function draftFromEvent(
  ev: Pick<CalendarEvent, 'summary' | 'start' | 'end' | 'allDay' | 'location' | 'description' | 'attendees'>,
): EventDraft {
  const s = new Date(ev.start)
  const e = new Date(ev.allDay ? ev.start : ev.end)
  return {
    title: ev.summary,
    date: `${s.getFullYear()}-${two(s.getMonth() + 1)}-${two(s.getDate())}`,
    startTime: `${two(s.getHours())}:${two(s.getMinutes())}`,
    endTime: ev.allDay ? '10:00' : `${two(e.getHours())}:${two(e.getMinutes())}`,
    allDay: ev.allDay,
    location: ev.location ?? '',
    description: ev.description ?? '',
    // The current invite list, editable in place — kept people keep their RSVP.
    attendees: (ev.attendees ?? []).map((a) => a.email).join(', '),
  }
}

/** Form fields for "create an event starting at this clicked slot" (1h long,
 * clamped to the day so a 23:30 slot does not end before it starts). */
export function draftForSlot(startMs: number): Partial<EventDraft> {
  const s = new Date(startMs)
  const e = new Date(startMs + 3_600_000)
  const sameDay = e.getDate() === s.getDate()
  return {
    date: `${s.getFullYear()}-${two(s.getMonth() + 1)}-${two(s.getDate())}`,
    startTime: `${two(s.getHours())}:${two(s.getMinutes())}`,
    endTime: sameDay ? `${two(e.getHours())}:${two(e.getMinutes())}` : '23:59',
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Parse the attendees field. Invalid entries are returned, never dropped —
 * an invitation silently not sent is the failure this feature exists to end. */
export function parseAttendees(text: string): { emails: { email: string }[]; invalid: string[] } {
  const parts = text.split(/[\s,;]+/).filter(Boolean)
  const emails: { email: string }[] = []
  const invalid: string[] = []
  for (const p of parts) (EMAIL.test(p) ? emails.push({ email: p }) : invalid.push(p))
  return { emails, invalid }
}

/** Local epoch ms for a form date + time, or null when either is malformed. */
function toEpoch(date: string, time: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!m || !t) return null
  return new Date(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]).getTime()
}

export type DraftResult =
  | { ok: true; input: { summary: string; start: number; end: number; allDay: boolean; location?: string; description?: string; attendees: { email: string }[] } }
  | { ok: false; error: string }

/** Turn the form into a createEvent payload, or say precisely what is wrong. */
export function buildEventInput(draft: EventDraft): DraftResult {
  const summary = draft.title.trim()
  if (!summary) return { ok: false, error: 'The event needs a title.' }

  const { emails, invalid } = parseAttendees(draft.attendees)
  if (invalid.length > 0) {
    return { ok: false, error: `Not an email address: ${invalid.join(', ')}` }
  }

  let start: number | null
  let end: number | null
  if (draft.allDay) {
    start = toEpoch(draft.date, '00:00')
    // End is exclusive throughout the calendar — one all-day is [midnight, midnight+1d).
    end = start == null ? null : addDays(start, 1)
  } else {
    start = toEpoch(draft.date, draft.startTime)
    end = toEpoch(draft.date, draft.endTime)
  }
  if (start == null || end == null) return { ok: false, error: 'The event needs a date and a time.' }
  if (!draft.allDay && end <= start) return { ok: false, error: 'The event ends before it starts.' }

  return {
    ok: true,
    input: {
      summary, start, end, allDay: draft.allDay,
      ...(draft.location.trim() ? { location: draft.location.trim() } : {}),
      ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
      attendees: emails,
    },
  }
}
