import type { CalendarEvent } from './ics'
import type { CalendarCollection } from './caldav-client'

/**
 * Google Calendar and Microsoft Graph readers — the cloud half of Calendar,
 * added AFTER the local CalDAV path so it is additive rather than a rewrite.
 *
 * Neither provider is reached over CalDAV: Microsoft removed CalDAV entirely, and
 * Google's REST API is the supported path. Both are plain JSON over HTTPS with a
 * bearer token, so the OAuth machinery mail already owns (PKCE flow, refresh,
 * client-id resolution) carries over untouched — only the endpoints and the
 * response mapping are new.
 *
 * The mapping is the part that actually needs care, and it is pure and tested:
 * each provider expresses "all-day" differently, and getting that wrong shifts an
 * event by a day or invents a midnight-to-midnight meeting.
 *
 *   Google  — `start.date` (all-day, exclusive `end.date`) vs `start.dateTime`.
 *   Graph   — `isAllDay` plus `start.dateTime`+`start.timeZone`, where the
 *             timeZone is a WINDOWS zone name unless you ask for IANA.
 */

/** Scopes — read-only on purpose: this increment only displays a calendar. */
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
export const MS_CALENDAR_SCOPE = 'Calendars.Read'

const GOOGLE_API = 'https://www.googleapis.com/calendar/v3'
const GRAPH_API = 'https://graph.microsoft.com/v1.0'

type Fetcher = typeof fetch

export class CloudCalendarError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'CloudCalendarError'
  }
}

async function getJson(url: string, token: string, fetcher: Fetcher): Promise<unknown> {
  let res: Response
  try {
    res = await fetcher(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  } catch (e) {
    throw new CloudCalendarError(`Could not reach the calendar service: ${(e as Error).message}`)
  }
  if (res.status === 401) throw new CloudCalendarError('The sign-in expired — reconnect this calendar.', 401)
  if (res.status === 403) throw new CloudCalendarError('That account did not grant calendar access.', 403)
  if (!res.ok) throw new CloudCalendarError(`The calendar service returned ${res.status}.`, res.status)
  return res.json()
}

// ── Google ───────────────────────────────────────────────────────────────────

/** `YYYY-MM-DD` → local midnight. All-day dates carry no zone by definition. */
export function parseAllDayDate(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim())
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

/**
 * Map one Google event. Cancelled events are dropped (they still appear in a
 * list response), and anything without a usable start is skipped rather than
 * given a guessed time.
 */
export function mapGoogleEvent(raw: unknown, sourceId: string): CalendarEvent | null {
  const e = raw as Record<string, unknown>
  if (!e || typeof e !== 'object') return null
  if (e.status === 'cancelled') return null
  const id = typeof e.id === 'string' ? e.id : null
  if (!id) return null

  const start = e.start as Record<string, string> | undefined
  const end = e.end as Record<string, string> | undefined
  if (!start) return null

  let startMs: number | null
  let endMs: number | null
  let allDay = false
  if (start.date) {
    allDay = true
    startMs = parseAllDayDate(start.date)
    // Google's end.date is EXCLUSIVE, matching iCalendar — use it as-is.
    endMs = end?.date ? parseAllDayDate(end.date) : null
    if (startMs !== null && endMs === null) endMs = startMs + 86_400_000
  } else {
    startMs = start.dateTime ? Date.parse(start.dateTime) : null
    endMs = end?.dateTime ? Date.parse(end.dateTime) : null
    if (startMs !== null && endMs === null) endMs = startMs
  }
  if (startMs === null || Number.isNaN(startMs) || endMs === null || Number.isNaN(endMs)) return null

  return {
    uid: id,
    summary: typeof e.summary === 'string' && e.summary ? e.summary : '(no title)',
    start: startMs,
    end: endMs,
    allDay,
    ...(typeof e.location === 'string' && e.location ? { location: e.location } : {}),
    ...(typeof e.description === 'string' && e.description ? { description: e.description } : {}),
    ...(typeof start.timeZone === 'string' && start.timeZone ? { tzid: start.timeZone } : {}),
    sourceId,
  } as CalendarEvent & { sourceId: string }
}

export async function listGoogleCalendars(token: string, fetcher: Fetcher = fetch): Promise<CalendarCollection[]> {
  const data = (await getJson(`${GOOGLE_API}/users/me/calendarList`, token, fetcher)) as { items?: unknown[] }
  return (data.items ?? []).flatMap((raw) => {
    const c = raw as Record<string, unknown>
    if (typeof c.id !== 'string') return []
    return [{
      url: c.id,
      displayName: typeof c.summary === 'string' ? c.summary : c.id,
      ...(typeof c.backgroundColor === 'string' ? { color: c.backgroundColor } : {}),
    }]
  })
}

/**
 * Google events in a window. `singleEvents=true` makes the API expand recurrence
 * for us, so these arrive already flattened — unlike CalDAV, where we expand the
 * master rule locally.
 */
export async function fetchGoogleEvents(
  token: string,
  calendarId: string,
  from: number,
  to: number,
  sourceId: string,
  fetcher: Fetcher = fetch,
): Promise<CalendarEvent[]> {
  const url =
    `${GOOGLE_API}/calendars/${encodeURIComponent(calendarId)}/events` +
    `?timeMin=${encodeURIComponent(new Date(from).toISOString())}` +
    `&timeMax=${encodeURIComponent(new Date(to).toISOString())}` +
    '&singleEvents=true&orderBy=startTime&maxResults=250'
  const data = (await getJson(url, token, fetcher)) as { items?: unknown[] }
  return (data.items ?? []).flatMap((i) => {
    const ev = mapGoogleEvent(i, sourceId)
    return ev ? [ev] : []
  })
}

// ── Microsoft Graph ──────────────────────────────────────────────────────────

/**
 * Map one Graph event.
 *
 * Graph returns `dateTime` with NO trailing Z plus a separate `timeZone`. Parsing
 * it directly would read it as local time and silently shift every event for a
 * user whose calendar zone differs from their machine. We request UTC via the
 * Prefer header (see fetchGraphEvents) and append the Z here so the parse is
 * unambiguous; an all-day event keeps local-midnight semantics instead.
 */
export function mapGraphEvent(raw: unknown, sourceId: string): CalendarEvent | null {
  const e = raw as Record<string, unknown>
  if (!e || typeof e !== 'object') return null
  const id = typeof e.id === 'string' ? e.id : null
  if (!id) return null
  const start = e.start as Record<string, string> | undefined
  const end = e.end as Record<string, string> | undefined
  if (!start?.dateTime) return null

  const allDay = e.isAllDay === true
  let startMs: number
  let endMs: number
  if (allDay) {
    // Graph gives midnight in the event's own zone; treat as a local calendar day.
    const d = parseAllDayDate(start.dateTime.slice(0, 10))
    const e2 = end?.dateTime ? parseAllDayDate(end.dateTime.slice(0, 10)) : null
    if (d === null) return null
    startMs = d
    endMs = e2 ?? d + 86_400_000
  } else {
    startMs = Date.parse(asUtc(start.dateTime))
    endMs = end?.dateTime ? Date.parse(asUtc(end.dateTime)) : startMs
  }
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null

  const location = (e.location as Record<string, unknown> | undefined)?.displayName
  const body = (e.bodyPreview as string | undefined) ?? undefined

  return {
    uid: id,
    summary: typeof e.subject === 'string' && e.subject ? e.subject : '(no title)',
    start: startMs,
    end: endMs,
    allDay,
    ...(typeof location === 'string' && location ? { location } : {}),
    ...(body ? { description: body } : {}),
    sourceId,
  } as CalendarEvent & { sourceId: string }
}

/** Graph omits the zone designator; we ask for UTC, so mark it explicitly. */
function asUtc(dt: string): string {
  return /[Zz]|[+-]\d{2}:\d{2}$/.test(dt) ? dt : `${dt}Z`
}

export async function listGraphCalendars(token: string, fetcher: Fetcher = fetch): Promise<CalendarCollection[]> {
  const data = (await getJson(`${GRAPH_API}/me/calendars`, token, fetcher)) as { value?: unknown[] }
  return (data.value ?? []).flatMap((raw) => {
    const c = raw as Record<string, unknown>
    if (typeof c.id !== 'string') return []
    return [{ url: c.id, displayName: typeof c.name === 'string' ? c.name : c.id }]
  })
}

/**
 * Graph events in a window via `calendarView`, which — like Google's
 * singleEvents — expands recurrence server-side. The Prefer header pins the
 * response to UTC so `mapGraphEvent` never has to guess a zone.
 */
export async function fetchGraphEvents(
  token: string,
  calendarId: string,
  from: number,
  to: number,
  sourceId: string,
  fetcher: Fetcher = fetch,
): Promise<CalendarEvent[]> {
  const base = calendarId ? `${GRAPH_API}/me/calendars/${encodeURIComponent(calendarId)}` : `${GRAPH_API}/me`
  const url =
    `${base}/calendarView?startDateTime=${encodeURIComponent(new Date(from).toISOString())}` +
    `&endDateTime=${encodeURIComponent(new Date(to).toISOString())}&$top=250`
  let res: Response
  try {
    res = await fetcher(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        Prefer: 'outlook.timezone="UTC"',
      },
    })
  } catch (e) {
    throw new CloudCalendarError(`Could not reach the calendar service: ${(e as Error).message}`)
  }
  if (res.status === 401) throw new CloudCalendarError('The sign-in expired — reconnect this calendar.', 401)
  if (!res.ok) throw new CloudCalendarError(`The calendar service returned ${res.status}.`, res.status)
  const data = (await res.json()) as { value?: unknown[] }
  return (data.value ?? []).flatMap((i) => {
    const ev = mapGraphEvent(i, sourceId)
    return ev ? [ev] : []
  })
}
