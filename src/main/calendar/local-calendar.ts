import fs from 'fs'
import path from 'path'
import { expandRecurrence, parseIcs, type CalendarEvent } from './ics'
import {
  addExdateIcs, appendEventIcs, buildCalendarIcs, removeEventIcs, rewriteEventIcs,
  rewriteOccurrenceIcs, rewriteSeriesIcs, type EventEdit, type SeriesEdit,
} from './ics-write'
import { repeatFields, type RecurrenceInput } from './recurrence'

/**
 * A calendar this app can WRITE to.
 *
 * Every existing source is read-only by construction: an ICS feed is somebody
 * else's URL, and the Google/Microsoft/CalDAV paths fetch. So the app could
 * show you your week and never put anything in it — which meant a note saying
 * "interview on Thursday" could be understood and then not acted on.
 *
 * This is a local calendar the app owns: one `.ics` file, on disk, in standard
 * iCalendar. It is deliberately the dullest possible implementation, for two
 * reasons. Writing to CalDAV or Graph means auth scopes, ETags and conflict
 * handling against a server we have never even proved we can read reliably —
 * and a local file can be dragged into any calendar app, so the events are not
 * trapped here. The same rule the case files follow: the artefact outlives the
 * tool.
 *
 * Stored beside the workspace's other durable work rather than in userData,
 * because these events are the user's, not the app's bookkeeping.
 */

export interface NewEvent {
  summary: string
  start: number
  end: number
  allDay?: boolean
  location?: string
  description?: string
  /** Present → the event repeats. */
  recurrence?: RecurrenceInput
}

const FILE = 'Calendar/workspace-os.ics'

/**
 * A set of events as one document.
 *
 * Generation lives in ics-write.ts, shared with the CalDAV path. Two
 * implementations of iCalendar in one codebase would drift, and the drift
 * would be invisible — both produce files that look right, and one of them
 * fails to import.
 *
 * Saving does NOT rebuild the file through this: edits go through the surgical
 * rewrites, which keep what a CalendarEvent does not model.
 */
export function calendarToIcs(events: CalendarEvent[]): string {
  // Field-by-field: CalendarEvent models more than EventDraft writes (RSVP
  // states), and none of that applies to events the local file owns.
  return buildCalendarIcs(events.map((e) => ({
    uid: e.uid,
    summary: e.summary,
    start: e.start,
    end: e.end,
    ...(e.allDay ? { allDay: true } : {}),
    ...(e.location ? { location: e.location } : {}),
    ...(e.description ? { description: e.description } : {}),
    ...(e.rrule ? { rrule: e.rrule } : {}),
    ...(e.exdates?.length ? { exdates: e.exdates } : {}),
    ...(e.recurrenceId !== undefined ? { recurrenceId: e.recurrenceId } : {}),
    ...(e.tzid ? { timeZone: e.tzid } : {}),
    sequence: 0,
  })))
}

/** A uid that is unique and identifiably ours. */
export function newUid(): string {
  return `wos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@workspace-os`
}

function file(root: string): string {
  return path.join(root, FILE)
}

export function readLocal(root: string): CalendarEvent[] {
  const f = file(root)
  if (!fs.existsSync(f)) return []
  try {
    return parseIcs(fs.readFileSync(f, 'utf8'))
  } catch {
    return []
  }
}

/** The file as it stands, ready to be changed; an empty calendar when there is none. */
function readDocument(root: string): string {
  const f = file(root)
  const raw = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
  if (!raw.trim()) return calendarToIcs([])
  if (!/^BEGIN:VCALENDAR/im.test(raw)) {
    // Rewriting it would destroy whatever it holds.
    throw new Error('The local calendar file is not a readable calendar — it was left untouched.')
  }
  return raw
}

/** Always the whole file: what is on disk is one complete document, never torn mid-append. */
function save(root: string, ics: string): void {
  const f = file(root)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, ics)
}

/** A zero-length event is invisible in most clients; give it an hour (or its day). */
function endOf(input: NewEvent): number {
  if (input.end > input.start) return input.end
  if (!input.allDay) return input.start + 3_600_000
  const next = new Date(input.start)
  next.setDate(next.getDate() + 1)
  return next.getTime()
}

/** Bounds new text — text already longer in the file is not cut short. */
function cap(value: string | undefined, max: number, old: string | undefined): string {
  return value === old?.trim() ? String(value ?? '') : String(value ?? '').slice(0, max)
}

/** The form's fields, bounded. */
function editOf(changes: NewEvent, before: CalendarEvent): EventEdit {
  const location = cap(changes.location, 300, before.location)
  const description = cap(changes.description, 2000, before.description)
  return {
    summary: cap(changes.summary, 300, before.summary) || '(no title)',
    start: changes.start,
    end: endOf(changes),
    allDay: Boolean(changes.allDay),
    ...(location ? { location } : {}),
    ...(description ? { description } : {}),
  }
}

/** The event with this uid — the series master, not one of its overrides. */
function masterOf(root: string, uid: string): CalendarEvent | undefined {
  return readLocal(root).find((e) => e.uid === uid && e.recurrenceId === undefined)
}

/**
 * Appends an event and returns it.
 *
 * A calendar of a few hundred events is kilobytes, so it is rewritten whole —
 * but by adding to the document that is there, not by regenerating it.
 */
export function addLocal(root: string, input: NewEvent): CalendarEvent {
  const allDay = Boolean(input.allDay)
  const event = {
    uid: newUid(),
    summary: String(input.summary ?? '').slice(0, 300) || '(no title)',
    start: input.start,
    end: endOf(input),
    allDay,
    ...(input.location ? { location: String(input.location).slice(0, 300) } : {}),
    ...(input.description ? { description: String(input.description).slice(0, 2000) } : {}),
  } satisfies CalendarEvent
  const repeat = input.recurrence ? repeatFields(input.recurrence, allDay) : undefined
  save(root, appendEventIcs(readDocument(root), { ...event, ...repeat, sequence: 0 }))
  return {
    ...event,
    ...(repeat ? { rrule: repeat.rrule, ...(repeat.timeZone ? { tzid: repeat.timeZone } : {}) } : {}),
  }
}

/**
 * Replace a one-off event's editable fields, keeping its uid and everything the
 * form does not show. Refuses a series — that has its own two edits below.
 */
export function updateLocal(root: string, uid: string, changes: NewEvent): CalendarEvent | null {
  const before = masterOf(root, uid)
  if (!before) return null
  save(root, rewriteEventIcs(readDocument(root), editOf(changes, before), uid))
  return masterOf(root, uid) ?? null
}

/**
 * The series master, when `occurrence` really is one of its occurrences — an
 * instant it does not have would become a phantom event or a dead exclusion.
 */
function seriesWith(root: string, uid: string, occurrence: number): CalendarEvent | null {
  const events = readLocal(root).filter((e) => e.uid === uid)
  const master = events.find((e) => e.recurrenceId === undefined)
  if (!master?.rrule) return null
  const known = events.some((e) => e.recurrenceId === occurrence)
    || expandRecurrence(master, occurrence - 1, occurrence + 1).some((e) => e.start === occurrence)
  return known ? master : null
}

/** Changes ONE occurrence of a local series; false when there is no such occurrence. */
export function updateLocalOccurrence(root: string, uid: string, occurrence: number, changes: NewEvent): boolean {
  const master = seriesWith(root, uid, occurrence)
  if (!master) return false
  save(root, rewriteOccurrenceIcs(readDocument(root), occurrence, editOf(changes, master), uid))
  return true
}

/** Changes every occurrence of a local series; false when there is no such series. */
export function updateLocalSeries(root: string, uid: string, edit: SeriesEdit): boolean {
  const master = masterOf(root, uid)
  if (!master?.rrule) return false
  const location = cap(edit.location, 300, master.location)
  const description = cap(edit.description, 2000, master.description)
  save(root, rewriteSeriesIcs(readDocument(root), {
    ...edit,
    summary: cap(edit.summary, 300, master.summary) || '(no title)',
    ...(location ? { location } : {}),
    ...(description ? { description } : {}),
  }, uid))
  return true
}

/** Removes ONE occurrence of a local series; false when there is no such occurrence. */
export function removeLocalOccurrence(root: string, uid: string, occurrence: number): boolean {
  if (!seriesWith(root, uid, occurrence)) return false
  save(root, addExdateIcs(readDocument(root), occurrence, uid))
  return true
}

/** Removes an event — for a series, all of it. */
export function removeLocal(root: string, uid: string): boolean {
  const next = removeEventIcs(readDocument(root), uid)
  if (next === null) return false
  save(root, next)
  return true
}

/** Where the file lives, for the UI to show and for tests. */
export function localCalendarPath(root: string): string {
  return file(root)
}
