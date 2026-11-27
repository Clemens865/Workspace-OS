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
 *   - VTIMEZONE offset tables. A TZID the runtime knows (IANA) is resolved with
 *     the runtime's own rules; a floating time, or a TZID we have no rules for,
 *     is interpreted in the host's zone — right for the overwhelmingly common
 *     case (an event authored in the zone it is read in). `tzid` is preserved on
 *     the event — we never silently pretend it was UTC.
 *   - VTODO / VJOURNAL / VALARM, attendee round-tripping, attachments.
 *   - RRULE parts BYYEARDAY, BYWEEKNO, BYHOUR, BYMINUTE, BYSECOND and sub-daily
 *     frequencies: such an event shows once rather than on invented dates.
 */

import { epochOf, knownZone, wallTimeOf, type WallTime } from './zoned-time'

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
  /** DTSTART was written in UTC, so a recurrence steps in UTC too. */
  utc?: boolean
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
 *   `20260729T093000`         → floating, or wall-clock time in `tzid` (see header)
 */
export function parseIcsDate(value: string, allDay: boolean, tzid?: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, hh, mm, ss, z] = m
  const year = Number(y), month = Number(mo) - 1, day = Number(d)
  if (allDay || hh === undefined) return new Date(year, month, day, 0, 0, 0, 0).getTime()
  const H = Number(hh), M = Number(mm), S = Number(ss)
  return z
    ? Date.UTC(year, month, day, H, M, S)
    : epochOf({ y: year, mo: month, d: day, h: H, mi: M, s: S }, tzid)
}

const DAY_MS = 86_400_000

/** The same wall-clock time `days` calendar days later (DST-safe). */
function plusDays(ms: number, days: number, zone?: string): number {
  const w = wallTimeOf(ms, zone)
  return epochOf({ ...w, d: w.d + days }, zone)
}

/** `P1DT2H30M` applied to a start, or null when it is not a duration. */
function endFromDuration(start: number, value: string, zone?: string): number | null {
  const m = /^\+?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim())
  if (!m) return null
  const [w, d, h, mi, s] = m.slice(1).map((v) => Number(v ?? 0))
  // Days and weeks are calendar days; the time part is elapsed time.
  const days = w * 7 + d
  return (days ? plusDays(start, days, zone) : start) + ((h * 60 + mi) * 60 + s) * 1000
}

type Parsing = Partial<CalendarEvent> & {
  dtEndRaw?: string
  dtEndAllDay?: boolean
  dtEndTzid?: string
  durationRaw?: string
}

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
  let cur: Parsing | null = null
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
        const t = parseIcsDate(line.value, allDay, line.params.TZID)
        if (t !== null) {
          cur.start = t
          cur.allDay = allDay
          const tz = line.params.TZID
          if (tz && tz.toUpperCase() !== 'UTC') cur.tzid = tz
          else if (!allDay && (tz || line.value.trim().endsWith('Z'))) cur.utc = true
        }
        break
      }
      case 'DTEND':
        cur.dtEndRaw = line.value
        cur.dtEndAllDay = line.params.VALUE === 'DATE'
        cur.dtEndTzid = line.params.TZID
        break
      case 'DURATION':
        cur.durationRaw = line.value
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
          const t = parseIcsDate(v, line.params.VALUE === 'DATE', line.params.TZID)
          if (t !== null) (cur.exdates ??= []).push(t)
        }
        break
      }
      case 'RECURRENCE-ID': {
        const t = parseIcsDate(line.value, line.params.VALUE === 'DATE', line.params.TZID)
        if (t !== null) cur.recurrenceId = t
        break
      }
      default: break
    }
  }
  return events
}

function finishEvent(cur: Parsing): CalendarEvent | null {
  if (!cur.uid || typeof cur.start !== 'number') return null
  const allDay = cur.allDay === true
  let end: number | null = cur.dtEndRaw
    ? parseIcsDate(cur.dtEndRaw, cur.dtEndAllDay ?? allDay, cur.dtEndTzid)
    : cur.durationRaw
      ? endFromDuration(cur.start, cur.durationRaw, cur.utc ? 'UTC' : cur.tzid)
      : null
  if (end === null) end = allDay ? plusDays(cur.start, 1) : cur.start
  return {
    uid: cur.uid,
    summary: cur.summary ?? '(no title)',
    start: cur.start,
    end,
    allDay,
    ...(cur.location ? { location: cur.location } : {}),
    ...(cur.description ? { description: cur.description } : {}),
    ...(cur.tzid ? { tzid: cur.tzid } : {}),
    ...(cur.utc ? { utc: true } : {}),
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
  /** UNTIL was a bare DATE: the whole of that day is included. */
  untilIsDate?: boolean
  /** BYDAY weekday numbers (0=Sun), including those that carry an ordinal. */
  byDay?: number[]
  /** The positional BYDAY entries — `2MO` is the 2nd Monday, `-1FR` the last Friday. */
  byDayOrdinals?: { weekday: number; ordinal: number }[]
  /** Days of the month; negative counts from the end. */
  byMonthDay?: number[]
  /** Months, 1–12. */
  byMonth?: number[]
  /** Which of a period's matches to keep; negative counts from the end. */
  bySetPos?: number[]
  /** First day of the week for WEEKLY; Monday unless the rule says otherwise. */
  weekStart?: number
}

const UNSUPPORTED = ['BYYEARDAY', 'BYWEEKNO', 'BYHOUR', 'BYMINUTE', 'BYSECOND']

/** A comma list of non-zero integers within ±limit; junk entries are dropped. */
function numberList(value: string | undefined, limit: number): number[] {
  return (value ?? '')
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isInteger(n) && n !== 0 && Math.abs(n) <= limit)
}

export function parseRrule(rrule: string, tzid?: string): Rrule | null {
  const parts: Record<string, string> = {}
  for (const kv of rrule.split(';')) {
    const eq = kv.indexOf('=')
    if (eq > 0) parts[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1)
  }
  const freq = (parts.FREQ ?? '').toUpperCase()
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null
  // A part we cannot honour would silently change WHICH days match.
  if (UNSUPPORTED.some((k) => k in parts)) return null
  const interval = Math.max(1, Math.floor(Number(parts.INTERVAL ?? 1)) || 1)
  const out: Rrule = { freq, interval }
  if (parts.COUNT) {
    const n = Number(parts.COUNT)
    if (Number.isFinite(n) && n > 0) out.count = n
  }
  if (parts.UNTIL) {
    const isDate = !parts.UNTIL.includes('T')
    const t = parseIcsDate(parts.UNTIL, isDate, tzid)
    if (t !== null) {
      out.until = t
      if (isDate) out.untilIsDate = true
    }
  }
  if (parts.BYDAY) {
    const days: number[] = []
    const ordinals: { weekday: number; ordinal: number }[] = []
    for (const entry of parts.BYDAY.split(',')) {
      const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(entry.trim().toUpperCase())
      const weekday = m ? WEEKDAY[m[2]] : undefined
      if (!m || weekday === undefined) continue
      if (!days.includes(weekday)) days.push(weekday)
      if (m[1] && Number(m[1]) !== 0) ordinals.push({ weekday, ordinal: Number(m[1]) })
    }
    if (days.length) out.byDay = days
    if (ordinals.length) out.byDayOrdinals = ordinals
  }
  const byMonthDay = numberList(parts.BYMONTHDAY, 31)
  if (byMonthDay.length) out.byMonthDay = byMonthDay
  const byMonth = numberList(parts.BYMONTH, 12).filter((m) => m > 0)
  if (byMonth.length) out.byMonth = byMonth
  const bySetPos = numberList(parts.BYSETPOS, 366)
  if (bySetPos.length) out.bySetPos = bySetPos
  const wkst = WEEKDAY[(parts.WKST ?? '').toUpperCase()]
  if (wkst !== undefined) out.weekStart = wkst
  return out
}

/*
 * Dates below are "day stamps": UTC midnight of a calendar date, used purely as
 * a calendar (no zone, no DST). Only a day that is actually shown is turned into
 * an instant, in the series' own zone.
 */
const weekdayOf = (day: number): number => new Date(day).getUTCDay()
const monthLength = (y: number, mo: number): number => new Date(Date.UTC(y, mo + 1, 0)).getUTCDate()

/** The days of [first, first+length) that BYDAY picks, ordinals counted within that span. */
function byDayWithin(rule: Rrule, first: number, length: number): number[] {
  const ordinals = rule.byDayOrdinals ?? []
  const plain = (rule.byDay ?? []).filter((wd) => !ordinals.some((o) => o.weekday === wd))
  const out: number[] = []
  for (let i = 0; i < length; i++) {
    const day = first + i * DAY_MS
    const wd = weekdayOf(day)
    const nth = Math.floor(i / 7) + 1
    const nthFromEnd = -(Math.floor((length - 1 - i) / 7) + 1)
    const positional = ordinals.some((o) => o.weekday === wd && (o.ordinal === nth || o.ordinal === nthFromEnd))
    if (positional || plain.includes(wd)) out.push(day)
  }
  return out
}

/** Does BYMONTHDAY (when present) allow this day? */
function monthDayAllows(rule: Rrule, day: number): boolean {
  if (!rule.byMonthDay) return true
  const d = new Date(day)
  const length = monthLength(d.getUTCFullYear(), d.getUTCMonth())
  return rule.byMonthDay.some((n) => (n > 0 ? n : length + 1 + n) === d.getUTCDate())
}

/** The days of one month the rule picks. `fallbackDay` is DTSTART's day of month. */
function daysInMonth(rule: Rrule, y: number, mo: number, fallbackDay: number): number[] {
  const length = monthLength(y, mo)
  const first = Date.UTC(y, mo, 1)
  const all = (): number[] => Array.from({ length }, (_, i) => first + i * DAY_MS)
  if (rule.byDay) return byDayWithin(rule, first, length).filter((d) => monthDayAllows(rule, d))
  if (rule.byMonthDay) return all().filter((d) => monthDayAllows(rule, d))
  // A month without that day is SKIPPED (RFC 5545 §3.3.10), never rolled over.
  return fallbackDay <= length ? [Date.UTC(y, mo, fallbackDay)] : []
}

/** The i-th period of the rule: where it begins, and the days in it that match. */
function periodDays(rule: Rrule, first: WallTime, i: number): { begins: number; days: number[] } {
  const start = Date.UTC(first.y, first.mo, first.d)
  const inMonths = (d: number): boolean => !rule.byMonth || rule.byMonth.includes(new Date(d).getUTCMonth() + 1)
  let begins: number
  let days: number[]
  if (rule.freq === 'DAILY') {
    begins = start + i * rule.interval * DAY_MS
    const weekdayOk = !rule.byDay || rule.byDay.includes(weekdayOf(begins))
    days = weekdayOk && monthDayAllows(rule, begins) && inMonths(begins) ? [begins] : []
  } else if (rule.freq === 'WEEKLY') {
    const wkst = rule.weekStart ?? 1
    const offset = (wd: number): number => ((wd - wkst + 7) % 7) * DAY_MS
    begins = start - offset(weekdayOf(start)) + i * rule.interval * 7 * DAY_MS
    days = (rule.byDay ?? [weekdayOf(start)]).map((wd) => begins + offset(wd)).filter(inMonths)
  } else if (rule.freq === 'MONTHLY') {
    begins = Date.UTC(first.y, first.mo + i * rule.interval, 1)
    const d = new Date(begins)
    days = inMonths(begins) ? daysInMonth(rule, d.getUTCFullYear(), d.getUTCMonth(), first.d) : []
  } else {
    const y = first.y + i * rule.interval
    begins = Date.UTC(y, 0, 1)
    if (rule.byDay && !rule.byMonth && !rule.byMonthDay) {
      // "The 20th Monday of the year": ordinals count across the whole year.
      days = byDayWithin(rule, begins, (Date.UTC(y + 1, 0, 1) - begins) / DAY_MS)
    } else {
      const months = rule.byMonth?.map((m) => m - 1)
        ?? (rule.byMonthDay ? Array.from({ length: 12 }, (_, m) => m) : [first.mo])
      days = months.flatMap((mo) => daysInMonth(rule, y, mo, first.d))
    }
  }
  days = [...new Set(days)].sort((a, b) => a - b)
  if (rule.bySetPos) {
    const picked = rule.bySetPos.map((p) => days[p > 0 ? p - 1 : days.length + p])
    days = [...new Set(picked.filter((d): d is number => d !== undefined))].sort((a, b) => a - b)
  }
  return { begins, days }
}

/** Enough daily periods for a century; the cap is what stops an impossible rule. */
const MAX_PERIODS = 40_000

/**
 * Expand a recurring event into the instances overlapping [rangeStart, rangeEnd).
 *
 * A work calendar is mostly recurring events, so a calendar that shows only the
 * first occurrence of each is not usable. Expansion is bounded three ways — the
 * window, COUNT/UNTIL, and a hard iteration cap — so a malformed infinite rule
 * can never hang the surface.
 *
 * Instances keep the series' wall-clock time in the series' own zone, so a DST
 * change does not move a 09:00 meeting.
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
  const zone = ev.allDay ? undefined : ev.utc ? 'UTC' : knownZone(ev.tzid)
  const rule = parseRrule(ev.rrule, zone)
  if (!rule) return overlaps(ev.start, ev.end) ? [ev] : []

  const duration = Math.max(0, ev.end - ev.start)
  // An all-day event lasts a number of DAYS; some of those are 23 or 25 hours.
  const wholeDays = Math.round(duration / DAY_MS)
  const first = wallTimeOf(ev.start, zone)
  const firstDay = Date.UTC(first.y, first.mo, first.d)
  const timeOfDay = ((first.h * 60 + first.mi) * 60 + first.s) * 1000
  const untilWall = rule.untilIsDate && rule.until !== undefined ? wallTimeOf(rule.until) : null
  const lastDay = untilWall ? Date.UTC(untilWall.y, untilWall.mo, untilWall.d) : null
  // A day stamp is within this much of the real instant in any zone.
  const slack = 2 * DAY_MS
  const out: CalendarEvent[] = []
  let emitted = 0

  for (let i = 0; i < MAX_PERIODS && out.length < maxInstances; i++) {
    const { begins, days } = periodDays(rule, first, i)
    // Past the window → nothing later can qualify.
    if (begins - slack >= rangeEnd) break
    for (const day of days) {
      if (day < firstDay) continue
      if (lastDay !== null && day > lastDay) return out
      if (rule.count !== undefined && emitted >= rule.count) return out
      // Long before the window: counts toward COUNT, needs no instant.
      if (day + timeOfDay + duration + slack < rangeStart) { emitted++; continue }
      const d = new Date(day)
      const s = day === firstDay
        ? ev.start
        : epochOf({ ...first, y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate() }, zone)
      if (lastDay === null && rule.until !== undefined && s > rule.until) return out
      emitted++
      // EXDATE: the occurrence exists for COUNT purposes but is not shown —
      // that is what "delete this one occurrence" writes.
      if (ev.exdates?.some((x) => x === s || (ev.allDay && sameLocalDay(x, s)))) continue
      const e = ev.allDay ? plusDays(s, wholeDays) : s + duration
      if (overlaps(s, e) && out.length < maxInstances) {
        out.push({ ...ev, start: s, end: e, recurringUid: ev.uid, uid: `${ev.uid}-${s}` })
      }
    }
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
