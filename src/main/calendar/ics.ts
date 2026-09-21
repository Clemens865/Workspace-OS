/**
 * iCalendar (RFC 5545) reader — the shared core of both calendar paths.
 *
 * CalDAV hands back iCalendar bodies and a subscribed `.ics` URL *is* an
 * iCalendar body, so one parser serves both. Written here rather than taken from
 * a dependency because the format is small, the useful subset is smaller, and
 * this file is where the correctness lives: everything is pure and unit-tested,
 * so a calendar that renders the wrong day is a test failure and not a support
 * ticket.
 *
 * Deliberately NOT supported (and why):
 *   - VTIMEZONE offset tables. A floating local time is interpreted in the host's
 *     zone, which is right for the overwhelmingly common case (an event authored
 *     in the same zone the user reads it in) and wrong for cross-zone events with
 *     a TZID we have no rules for. `tzid` is preserved on the event so a caller
 *     can resolve it properly later — we never silently pretend it was UTC.
 *   - VTODO / VJOURNAL / VALARM, attendee round-tripping, attachments.
 *   - RRULE beyond the common shapes (see expandRecurrence).
 */

/** Someone on the event, with where their RSVP stands. */
export interface EventAttendee {
  email: string
  name?: string
  /** NEEDS-ACTION until they answer; absent when the feed did not say. */
  partstat?: string
}

export interface CalendarEvent {
  /** UID from the feed. Stable across edits — used to dedupe and to update. */
  uid: string
  summary: string
  /** Start instant (epoch ms). For an all-day event, local midnight of the day. */
  start: number
  /** End instant (epoch ms), exclusive — matching iCalendar's DTEND semantics. */
  end: number
  allDay: boolean
  location?: string
  description?: string
  /** The DTSTART TZID when the feed named one and it is not UTC. */
  tzid?: string
  /** Raw RRULE, kept so a caller can re-expand or display "repeats weekly". */
  rrule?: string
  /** Set on instances produced by expanding an RRULE. */
  recurringUid?: string
  /** Who is invited, with RSVP state — read-only round-trip of ATTENDEE. */
  attendees?: EventAttendee[]
  organizer?: { email: string; name?: string }
  /** Occurrence starts EXCLUDED from this master's recurrence (EXDATE). */
  exdates?: number[]
  /** On an override VEVENT: the ORIGINAL start of the occurrence it replaces. */
  recurrenceId?: number
}

/** One parsed `NAME;PARAM=V:value` content line. */
export interface IcsLine {
  name: string
  params: Record<string, string>
  value: string
}

/**
 * Undo RFC 5545 line folding: a CRLF (or LF) followed by a single space or tab
 * is a continuation, not a new line. Feeds fold aggressively at 75 octets, so
 * skipping this step truncates most long summaries and every long description.
 */
export function unfoldLines(text: string): string[] {
  const out: string[] = []
  // Normalise line endings first — feeds in the wild mix CRLF, LF and even CR.
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1)
    } else if (line.length > 0) {
      out.push(line)
    }
  }
  return out
}

/** Parse one unfolded content line into name, params and raw value. */
export function parseLine(line: string): IcsLine | null {
  // The value starts at the first colon that is not inside a quoted param value.
  let colon = -1
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQuote = !inQuote
    else if (ch === ':' && !inQuote) { colon = i; break }
  }
  if (colon <= 0) return null
  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const parts = head.split(';')
  const name = parts[0].toUpperCase()
  const params: Record<string, string> = {}
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=')
    if (eq <= 0) continue
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name, params, value }
}

/** Unescape a TEXT value: \n \N → newline, and \\ \, \; → the literal char. */
export function unescapeText(value: string): string {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '\\') { out += value[i]; continue }
    const next = value[++i]
    if (next === 'n' || next === 'N') out += '\n'
    else if (next === undefined) out += '\\'
    else out += next // covers \\ \, \; and any stray escape
  }
  return out
}

/**
 * Parse an iCalendar DATE or DATE-TIME into epoch ms.
 *
 * Three forms, and the difference matters:
 *   `20260729`                → DATE, all-day; local midnight
 *   `20260729T093000Z`        → UTC instant
 *   `20260729T093000`         → floating/TZID local time; host zone (see header)
 */
export function parseIcsDate(value: string, allDay: boolean): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, hh, mm, ss, z] = m
  const year = Number(y), month = Number(mo) - 1, day = Number(d)
  if (allDay || hh === undefined) return new Date(year, month, day, 0, 0, 0, 0).getTime()
  const H = Number(hh), M = Number(mm), S = Number(ss)
  return z
    ? Date.UTC(year, month, day, H, M, S)
    : new Date(year, month, day, H, M, S).getTime()
}

const DAY_MS = 86_400_000

/**
 * Parse every VEVENT in an iCalendar body.
 *
 * Events missing a UID or an unparseable DTSTART are skipped rather than
 * guessed at — a calendar that invents times is worse than one that omits an
 * entry. A VEVENT with no DTEND gets iCalendar's default duration: one day for
 * an all-day event, otherwise zero-length (an instant).
 */
export function parseIcs(text: string): CalendarEvent[] {
  const events: CalendarEvent[] = []
  let cur: Partial<CalendarEvent> & { dtEndRaw?: string; dtEndAllDay?: boolean } | null = null
  let depth = 0 // nesting depth of non-VEVENT components (skip VALARM contents)

  for (const raw of unfoldLines(text)) {
    const line = parseLine(raw)
    if (!line) continue

    if (line.name === 'BEGIN') {
      const comp = line.value.toUpperCase()
      if (comp === 'VEVENT') { cur = {}; depth = 0 }
      else if (cur) depth++ // e.g. VALARM inside the event — ignore its lines
      continue
    }
    if (line.name === 'END') {
      const comp = line.value.toUpperCase()
      if (comp === 'VEVENT' && cur) {
        const ev = finishEvent(cur)
        if (ev) events.push(ev)
        cur = null
      } else if (cur && depth > 0) depth--
      continue
    }
    if (!cur || depth > 0) continue

    switch (line.name) {
      case 'UID': cur.uid = line.value.trim(); break
      case 'SUMMARY': cur.summary = unescapeText(line.value); break
      case 'LOCATION': cur.location = unescapeText(line.value); break
      case 'DESCRIPTION': cur.description = unescapeText(line.value); break
      case 'RRULE': cur.rrule = line.value.trim(); break
      case 'DTSTART': {
        const allDay = line.params.VALUE === 'DATE'
        const t = parseIcsDate(line.value, allDay)
        if (t !== null) {
          cur.start = t
          cur.allDay = allDay
          const tz = line.params.TZID
          if (tz && tz.toUpperCase() !== 'UTC') cur.tzid = tz
        }
        break
      }
      case 'DTEND':
        cur.dtEndRaw = line.value
        cur.dtEndAllDay = line.params.VALUE === 'DATE'
        break
      case 'ATTENDEE': {
        const email = line.value.trim().replace(/^mailto:/i, '')
        if (!email || email.includes(':')) break // urn:uuid etc. — not an address
        const a: EventAttendee = { email }
        if (line.params.CN) a.name = line.params.CN
        if (line.params.PARTSTAT) a.partstat = line.params.PARTSTAT.toUpperCase()
        ;(cur.attendees ??= []).push(a)
        break
      }
      case 'ORGANIZER': {
        const email = line.value.trim().replace(/^mailto:/i, '')
        if (!email || email.includes(':')) break
        cur.organizer = { email, ...(line.params.CN ? { name: line.params.CN } : {}) }
        break
      }
      case 'EXDATE': {
        // Comma-separated, possibly across several EXDATE lines.
        for (const v of line.value.split(',')) {
          const t = parseIcsDate(v, line.params.VALUE === 'DATE')
          if (t !== null) (cur.exdates ??= []).push(t)
        }
        break
      }
      case 'RECURRENCE-ID': {
        const t = parseIcsDate(line.value, line.params.VALUE === 'DATE')
        if (t !== null) cur.recurrenceId = t
        break
      }
      default: break
    }
  }
  return events
}

function finishEvent(
  cur: Partial<CalendarEvent> & { dtEndRaw?: string; dtEndAllDay?: boolean },
): CalendarEvent | null {
  if (!cur.uid || typeof cur.start !== 'number') return null
  const allDay = cur.allDay === true
  let end: number | null = cur.dtEndRaw ? parseIcsDate(cur.dtEndRaw, cur.dtEndAllDay ?? allDay) : null
  if (end === null) end = allDay ? cur.start + DAY_MS : cur.start
  return {
    uid: cur.uid,
    summary: cur.summary ?? '(no title)',
    start: cur.start,
    end,
    allDay,
    ...(cur.location ? { location: cur.location } : {}),
    ...(cur.description ? { description: cur.description } : {}),
    ...(cur.tzid ? { tzid: cur.tzid } : {}),
    ...(cur.rrule ? { rrule: cur.rrule } : {}),
    ...(cur.attendees?.length ? { attendees: cur.attendees } : {}),
    ...(cur.organizer ? { organizer: cur.organizer } : {}),
    ...(cur.exdates?.length ? { exdates: cur.exdates } : {}),
    ...(cur.recurrenceId !== undefined ? { recurrenceId: cur.recurrenceId } : {}),
  }
}

// ── Recurrence ────────────────────────────────────────────────────────────────

const WEEKDAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

/** A parsed RRULE — only the fields we act on. */
export interface Rrule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  count?: number
  until?: number
  /** BYDAY weekday numbers (0=Sun), for WEEKLY. */
  byDay?: number[]
}

export function parseRrule(rrule: string): Rrule | null {
  const parts: Record<string, string> = {}
  for (const kv of rrule.split(';')) {
    const eq = kv.indexOf('=')
    if (eq > 0) parts[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1)
  }
  const freq = (parts.FREQ ?? '').toUpperCase()
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null
  const interval = Math.max(1, Number(parts.INTERVAL ?? 1) || 1)
  const out: Rrule = { freq, interval }
  if (parts.COUNT) {
    const n = Number(parts.COUNT)
    if (Number.isFinite(n) && n > 0) out.count = n
  }
  if (parts.UNTIL) {
    const t = parseIcsDate(parts.UNTIL, !parts.UNTIL.includes('T'))
    if (t !== null) out.until = t
  }
  if (parts.BYDAY) {
    // Strip any ordinal prefix ("2MO" → MO); positional BYDAY is not supported,
    // so it degrades to "that weekday" rather than dropping the event entirely.
    const days = parts.BYDAY.split(',')
      .map((d) => WEEKDAY[d.trim().replace(/^[+-]?\d+/, '').toUpperCase()])
      .filter((d): d is number => d !== undefined)
    if (days.length) out.byDay = days
  }
  return out
}

/**
 * Expand a recurring event into the instances overlapping [rangeStart, rangeEnd).
 *
 * A work calendar is mostly recurring events, so a calendar that shows only the
 * first occurrence of each is not usable. Expansion is bounded three ways — the
 * window, COUNT/UNTIL, and a hard iteration cap — so a malformed infinite rule
 * can never hang the surface.
 *
 * A non-recurring event is returned as-is when it overlaps the window.
 */
export function expandRecurrence(
  ev: CalendarEvent,
  rangeStart: number,
  rangeEnd: number,
  maxInstances = 500,
): CalendarEvent[] {
  const overlaps = (s: number, e: number): boolean => s < rangeEnd && e > rangeStart
  if (!ev.rrule) return overlaps(ev.start, ev.end) ? [ev] : []
  const rule = parseRrule(ev.rrule)
  if (!rule) return overlaps(ev.start, ev.end) ? [ev] : []

  const duration = Math.max(0, ev.end - ev.start)
  const out: CalendarEvent[] = []
  const first = new Date(ev.start)
  let emitted = 0

  // Step a cursor by the rule's period; for WEEKLY+BYDAY, each period yields one
  // instance per named weekday.
  for (let i = 0; i < maxInstances * 2 && out.length < maxInstances; i++) {
    const cursor = new Date(first)
    if (rule.freq === 'DAILY') cursor.setDate(first.getDate() + i * rule.interval)
    else if (rule.freq === 'WEEKLY') cursor.setDate(first.getDate() + i * rule.interval * 7)
    else if (rule.freq === 'MONTHLY') cursor.setMonth(first.getMonth() + i * rule.interval)
    else cursor.setFullYear(first.getFullYear() + i * rule.interval)

    const starts: number[] = []
    if (rule.freq === 'WEEKLY' && rule.byDay?.length) {
      // Walk to the Sunday of the cursor's week, then offset to each named day.
      const weekStart = new Date(cursor)
      weekStart.setDate(cursor.getDate() - cursor.getDay())
      for (const wd of rule.byDay) {
        const d = new Date(weekStart)
        d.setDate(weekStart.getDate() + wd)
        d.setHours(first.getHours(), first.getMinutes(), first.getSeconds(), 0)
        if (d.getTime() >= ev.start) starts.push(d.getTime())
      }
      starts.sort((a, b) => a - b)
    } else {
      starts.push(cursor.getTime())
    }

    for (const s of starts) {
      if (rule.until !== undefined && s > rule.until) return out
      if (rule.count !== undefined && emitted >= rule.count) return out
      emitted++
      // EXDATE: the occurrence exists for COUNT purposes but is not shown —
      // that is what "delete this one occurrence" writes.
      if (ev.exdates?.some((x) => x === s || (ev.allDay && sameLocalDay(x, s)))) continue
      const e = s + duration
      if (overlaps(s, e)) {
        out.push({ ...ev, start: s, end: e, recurringUid: ev.uid, uid: `${ev.uid}-${s}` })
      }
    }
    // Past the window and not bounded by COUNT → nothing later can qualify.
    if (starts.length && starts[starts.length - 1] >= rangeEnd && rule.count === undefined) break
  }
  return out
}

/** Same local calendar day (all-day EXDATEs are dates, not instants). */
function sameLocalDay(a: number, b: number): boolean {
  const da = new Date(a), db = new Date(b)
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate()
}

/**
 * Every instance from a set of events that overlaps the window, time-ordered.
 *
 * RECURRENCE-ID overrides are applied here: an override VEVENT (same UID as its
 * master, plus RECURRENCE-ID naming the occurrence it replaces) REPLACES that
 * expanded instance. Before this, a series rescheduled once in Apple Calendar
 * showed twice — the moved copy AND the ghost of the original slot.
 */
export function eventsInRange(
  events: readonly CalendarEvent[],
  rangeStart: number,
  rangeEnd: number,
): CalendarEvent[] {
  const overridden = new Set(
    events.filter((e) => e.recurrenceId !== undefined).map((e) => `${e.uid}:${e.recurrenceId}`),
  )
  const out: CalendarEvent[] = []
  for (const ev of events) {
    if (ev.recurrenceId !== undefined) {
      // The override itself shows on its own (possibly moved) time. It keeps
      // its master's identity so edits and deletes target the right slice.
      if (ev.start < rangeEnd && ev.end > rangeStart) {
        out.push({ ...ev, recurringUid: ev.uid, uid: `${ev.uid}-ovr-${ev.recurrenceId}` })
      }
      continue
    }
    for (const inst of expandRecurrence(ev, rangeStart, rangeEnd)) {
      const original = inst.recurringUid ? inst.start : undefined
      if (original !== undefined && overridden.has(`${ev.uid}:${original}`)) continue
      out.push(inst)
    }
  }
  return out.sort((a, b) => a.start - b.start || a.summary.localeCompare(b.summary))
}
