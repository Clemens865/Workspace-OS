import fs from 'fs'
import path from 'path'
import { parseIcs, type CalendarEvent } from './ics'
import { buildCalendarIcs } from './ics-write'

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
}

const FILE = 'Calendar/workspace-os.ics'

/**
 * The whole local calendar as one document.
 *
 * Generation lives in ics-write.ts, shared with the CalDAV path. Two
 * implementations of iCalendar in one codebase would drift, and the drift
 * would be invisible — both produce files that look right, and one of them
 * fails to import.
 */
export function calendarToIcs(events: CalendarEvent[]): string {
  // Field-by-field: CalendarEvent now models more than EventDraft writes
  // (RSVP states, exdates), and none of it applies to the local file.
  return buildCalendarIcs(events.map((e) => ({
    uid: e.uid,
    summary: e.summary,
    start: e.start,
    end: e.end,
    ...(e.allDay ? { allDay: true } : {}),
    ...(e.location ? { location: e.location } : {}),
    ...(e.description ? { description: e.description } : {}),
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

/**
 * Appends an event and returns it.
 *
 * Read-modify-write of the whole file: a calendar of a few hundred events is
 * kilobytes, and rewriting it whole means the file on disk is always a complete
 * valid iCalendar document rather than something that could be torn mid-append.
 */
export function addLocal(root: string, input: NewEvent): CalendarEvent {
  const events = readLocal(root)
  const allDay = Boolean(input.allDay)
  const event: CalendarEvent = {
    uid: newUid(),
    summary: String(input.summary ?? '').slice(0, 300) || '(no title)',
    start: input.start,
    // A zero-length event is invisible in most clients; give it an hour.
    end: input.end > input.start ? input.end : input.start + (allDay ? 86_400_000 : 3_600_000),
    allDay,
    ...(input.location ? { location: String(input.location).slice(0, 300) } : {}),
    ...(input.description ? { description: String(input.description).slice(0, 2000) } : {}),
  }
  const f = file(root)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, calendarToIcs([...events, event]))
  return event
}

/**
 * Replace an event's editable fields, keeping its uid.
 *
 * Same read-modify-write-whole-file shape as addLocal, for the same reason:
 * the file on disk is always one complete valid document.
 */
export function updateLocal(root: string, uid: string, changes: NewEvent): CalendarEvent | null {
  const events = readLocal(root)
  const idx = events.findIndex((e) => e.uid === uid)
  if (idx === -1) return null
  const allDay = Boolean(changes.allDay)
  const next: CalendarEvent = {
    uid,
    summary: String(changes.summary ?? '').slice(0, 300) || '(no title)',
    start: changes.start,
    end: changes.end > changes.start ? changes.end : changes.start + (allDay ? 86_400_000 : 3_600_000),
    allDay,
    ...(changes.location ? { location: String(changes.location).slice(0, 300) } : {}),
    ...(changes.description ? { description: String(changes.description).slice(0, 2000) } : {}),
  }
  const all = [...events]
  all[idx] = next
  fs.writeFileSync(file(root), calendarToIcs(all))
  return next
}

export function removeLocal(root: string, uid: string): boolean {
  const events = readLocal(root)
  const kept = events.filter((e) => e.uid !== uid)
  if (kept.length === events.length) return false
  fs.writeFileSync(file(root), calendarToIcs(kept))
  return true
}

/** Where the file lives, for the UI to show and for tests. */
export function localCalendarPath(root: string): string {
  return file(root)
}
