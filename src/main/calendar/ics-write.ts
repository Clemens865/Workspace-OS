/**
 * Writing iCalendar — the shared half of "the app can create an event".
 *
 * Split out of local-calendar.ts once CalDAV needed the same escaping, folding
 * and VEVENT construction. Two implementations of iCalendar generation in one
 * codebase would drift, and the drift would be invisible: both would produce
 * files that look right, and one of them would fail to import.
 */

import { parseIcs, parseIcsDate, unescapeText, type CalendarEvent } from './ics'
import { epochOf, knownZone, offsetAt, wallTimeOf } from './zoned-time'

export interface Attendee {
  email: string
  name?: string
  /** NEEDS-ACTION unless the organizer themselves. */
  partstat?: 'NEEDS-ACTION' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE'
}

export interface EventDraft {
  uid: string
  summary: string
  start: number
  end: number
  allDay?: boolean
  location?: string
  description?: string
  organizer?: { email: string; name?: string }
  attendees?: Attendee[]
  /**
   * Bumped on every change to an event others hold a copy of.
   *
   * Without it a rescheduled meeting arrives as an unremarkable duplicate:
   * clients use SEQUENCE to decide whether an incoming copy supersedes the one
   * already on the calendar. Getting this wrong is why "I moved the meeting and
   * they still showed up at the old time" happens.
   */
  sequence?: number
  /** RRULE value, without the property name. */
  rrule?: string
  /** Occurrence starts excluded from the series. */
  exdates?: number[]
  /** On an override: the original start of the occurrence it replaces. */
  recurrenceId?: number
  /**
   * IANA zone the times are WRITTEN in (timed events only). A series needs one:
   * a rule written in UTC drifts an hour against the clock at every DST change.
   */
  timeZone?: string
}

/** Escapes a text value per RFC 5545 §3.3.11. */
export function escapeText(v: string): string {
  return String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n?|\n/g, '\\n')
}

/** UTC stamp: 20260817T143000Z. */
export function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

const two = (n: number): string => String(n).padStart(2, '0')

/**
 * Date-only stamp for an all-day event: 20260817, the LOCAL calendar day.
 *
 * All-day instants are local midnights, and reading one as UTC loses a day
 * everywhere east of Greenwich. Half a day of slack takes the nearest midnight.
 */
export function dayStamp(ms: number): string {
  const d = new Date(ms + 43_200_000)
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}`
}

/**
 * Folds a content line at 75 octets, as the spec requires.
 *
 * Not pedantry: a long DESCRIPTION emitted as one line is what makes an
 * otherwise valid file fail to import into Apple Calendar, and it fails
 * SILENTLY — the event simply does not appear.
 */
export function foldLine(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line
  const out: string[] = []
  let cur = ''
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, 'utf8') > (out.length === 0 ? 75 : 74)) {
      out.push(cur)
      cur = ''
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out.join('\r\n ')
}

function person(prefix: string, email: string, name?: string, extra = ''): string {
  // The address is written unescaped, so a line break in it would add a property.
  if (!email || /[\s\u0000-\u001f\u007f]/.test(email)) throw new Error('An invitee needs a valid email address.')
  const cn = name ? `;CN=${escapeText(name)}` : ''
  return `${prefix}${cn}${extra}:mailto:${email}`
}

/** A zone worth naming in a DTSTART: one with rules, and not UTC by another name. */
function namedZone(zone: string | undefined): string | undefined {
  const z = knownZone(zone)
  return z && !['UTC', 'Etc/UTC', 'Etc/GMT', 'GMT'].includes(z) ? z : undefined
}

/** The VEVENT's content lines, unfolded. */
function rawEventLines(e: EventDraft): string[] {
  const zone = e.allDay ? undefined : namedZone(e.timeZone)
  const times = (name: string, values: number[]): string => {
    if (e.allDay) return `${name};VALUE=DATE:${values.map(dayStamp).join(',')}`
    if (zone) return `${name};TZID=${zone}:${values.map((v) => stampInTz(v, zone)).join(',')}`
    return `${name}:${values.map(stamp).join(',')}`
  }
  const lines = [
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${stamp(Date.now())}`,
    `SEQUENCE:${e.sequence ?? 0}`,
    e.recurrenceId !== undefined ? times('RECURRENCE-ID', [e.recurrenceId]) : '',
    times('DTSTART', [e.start]),
    times('DTEND', [e.end]),
    e.rrule ? `RRULE:${e.rrule}` : '',
    e.exdates?.length ? times('EXDATE', e.exdates) : '',
    `SUMMARY:${escapeText(e.summary)}`,
    e.location ? `LOCATION:${escapeText(e.location)}` : '',
    e.description ? `DESCRIPTION:${escapeText(e.description)}` : '',
    e.organizer ? person('ORGANIZER', e.organizer.email, e.organizer.name) : '',
    ...(e.attendees ?? []).map((a) =>
      person(
        'ATTENDEE',
        a.email,
        a.name,
        `;ROLE=REQ-PARTICIPANT;PARTSTAT=${a.partstat ?? 'NEEDS-ACTION'};RSVP=TRUE`,
      ),
    ),
    'END:VEVENT',
  ]
  return lines.filter(Boolean)
}

/** The VEVENT body, without the surrounding VCALENDAR. */
export function eventLines(e: EventDraft): string[] {
  return rawEventLines(e).map(foldLine)
}

/* ── time zone definitions ────────────────────────────────────────────────── */

/** How many years of transitions a written VTIMEZONE spells out. */
const VTIMEZONE_YEARS = 20

function offsetText(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000)
  return `${ms < 0 ? '-' : '+'}${two(Math.floor(minutes / 60))}${two(minutes % 60)}`
}

/**
 * A VTIMEZONE for a zone a document names, as RFC 5545 requires.
 *
 * Transitions are listed one by one, found from the runtime's own zone rules,
 * starting in the year of the first event that uses the zone.
 */
function timezoneLines(zone: string, fromYear: number): string[] {
  const from = Date.UTC(fromYear, 0, 1)
  const to = Date.UTC(fromYear + VTIMEZONE_YEARS, 0, 1)
  const observance = (kind: string, local: string, before: number, after: number): string[] => [
    `BEGIN:${kind}`,
    `DTSTART:${local}`,
    `TZOFFSETFROM:${offsetText(before)}`,
    `TZOFFSETTO:${offsetText(after)}`,
    `END:${kind}`,
  ]
  let offset = offsetAt(from, zone)
  const midYear = offsetAt(Date.UTC(fromYear, 6, 1), zone)
  const out = [
    'BEGIN:VTIMEZONE',
    `TZID:${zone}`,
    ...observance(offset <= midYear ? 'STANDARD' : 'DAYLIGHT', `${fromYear}0101T000000`, offset, offset),
  ]
  const week = 7 * 86_400_000
  for (let t = from; t < to; t += week) {
    const next = offsetAt(t + week, zone)
    if (next === offset) continue
    // Narrow the week down to the minute the clocks changed.
    let low = t
    let high = t + week
    while (high - low > 60_000) {
      const mid = Math.floor((low + high) / 120_000) * 60_000
      if (offsetAt(mid, zone) === offset) low = mid
      else high = mid
    }
    // An observance's DTSTART is read on the clock as it stood BEFORE the change.
    const local = stamp(high + offset).replace('Z', '')
    out.push(...observance(next > offset ? 'DAYLIGHT' : 'STANDARD', local, offset, next))
    offset = next
  }
  out.push('END:VTIMEZONE')
  return out
}

/** One VTIMEZONE per zone the events are written in. */
function zonesFor(events: EventDraft[]): string[] {
  const firstYear = new Map<string, number>()
  for (const e of events) {
    const zone = e.allDay ? undefined : namedZone(e.timeZone)
    if (!zone) continue
    const year = new Date(e.start).getUTCFullYear() - 1
    firstYear.set(zone, Math.min(year, firstYear.get(zone) ?? year))
  }
  return [...firstYear].flatMap(([zone, year]) => timezoneLines(zone, year))
}

/**
 * A complete calendar document for ONE event — what a CalDAV PUT expects.
 *
 * `method` is set only when the document is being sent to people (an emailed
 * invitation is METHOD:REQUEST). A document stored on a server must NOT carry a
 * method: it makes some clients treat the stored copy as an incoming
 * invitation.
 */
export function buildEventIcs(e: EventDraft, method?: 'REQUEST' | 'CANCEL'): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Workspace OS//EN',
    'CALSCALE:GREGORIAN',
    ...(method ? [`METHOD:${method}`] : []),
    ...zonesFor([e]),
    ...eventLines(e),
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}

/* ── editing an existing document ─────────────────────────────────────────── */

/** Unfold RFC 5545 folded lines (a line starting with space/tab continues the previous). */
export function unfoldLines(raw: string): string[] {
  const out: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) out[out.length - 1] += line.slice(1)
    else out.push(line)
  }
  return out.filter((l) => l !== '')
}

/** The property name of a content line — `DTSTART;TZID=X:...` → `DTSTART`. */
function propName(line: string): string {
  const m = /^([A-Za-z0-9-]+)[;:]/.exec(line)
  return m ? m[1].toUpperCase() : ''
}

/** What an edit may change. Everything else in the event is preserved verbatim. */
export interface EventEdit {
  summary: string
  start: number
  end: number
  allDay: boolean
  location?: string
  description?: string
  /**
   * Replace WHO is invited. Omitted = leave the attendee lines alone (the
   * drag-reschedule path). People kept keep their PARTSTAT — an RSVP someone
   * already gave must not be reset to "no answer yet" by an unrelated edit.
   */
  attendees?: { email: string; name?: string }[]
  /** Needed only when attendees are ADDED to an event that has no ORGANIZER. */
  organizer?: { email: string; name?: string }
}

/* ── shared VEVENT surgery ── */

/** Splits an unfolded document into its VEVENT blocks plus everything around them. */
function splitVevents(lines: string[]): { pre: string[]; events: string[][]; post: string[] } {
  const events: string[][] = []
  const pre: string[] = []
  const post: string[] = []
  let cur: string[] | null = null
  let seenAny = false
  for (const l of lines) {
    const u = l.trim().toUpperCase()
    if (u === 'BEGIN:VEVENT') { cur = []; seenAny = true; continue }
    if (u === 'END:VEVENT' && cur) { events.push(cur); cur = null; continue }
    if (cur) cur.push(l)
    else if (!seenAny) pre.push(l)
    else post.push(l)
  }
  return { pre, events, post }
}

function joinVevents(pre: string[], events: string[][], post: string[]): string {
  const lines = [
    ...pre,
    ...events.flatMap((b) => ['BEGIN:VEVENT', ...b, 'END:VEVENT']),
    ...post,
  ]
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

/**
 * A VEVENT body split into its own properties and the components nested in it.
 *
 * An alarm has a DESCRIPTION, a SUMMARY and a DURATION of its own. Filtering the
 * body by property name alone would delete them along with the event's, so every
 * edit works on `own` and carries `nested` across whole.
 */
function splitNested(body: string[]): { own: string[]; nested: string[] } {
  const own: string[] = []
  const nested: string[] = []
  let depth = 0
  for (const l of body) {
    const u = l.trim().toUpperCase()
    if (u.startsWith('BEGIN:')) depth++
    ;(depth > 0 ? nested : own).push(l)
    if (u.startsWith('END:') && depth > 0) depth--
  }
  return { own, nested }
}

/** The param string and value of one of the event's own properties, or null. */
function findProp(body: string[], name: string): { params: string; value: string } | null {
  for (const l of splitNested(body).own) {
    if (propName(l) !== name) continue
    // A quoted parameter may hold a colon (ALTREP="http://…") — it is not the split.
    const split = /^((?:"[^"]*"|[^":])*):(.*)$/s.exec(l)
    if (!split) continue
    const [, head, value] = split
    const semi = head.indexOf(';')
    return { params: semi >= 0 ? head.slice(semi) : '', value }
  }
  return null
}

const tzidOf = (params: string): string | undefined => /;TZID=([^;:]+)/i.exec(params)?.[1]
const uidOf = (body: string[]): string | undefined => findProp(body, 'UID')?.value.trim()

/** What an event body says now, read by the same parser the surface uses. */
function readBody(body: string[]): CalendarEvent | undefined {
  return parseIcs(['BEGIN:VEVENT', 'UID:body', ...splitNested(body).own, 'END:VEVENT'].join('\n'))[0]
}

/** `20260825T093000`, as wall-clock time in an IANA zone (for TZID forms). */
export function stampInTz(ms: number, tzid: string): string {
  const w = wallTimeOf(ms, tzid)
  return `${w.y}${two(w.mo + 1)}${two(w.d)}T${two(w.h)}${two(w.mi)}${two(w.s)}`
}

/**
 * An occurrence instant written in the SAME form as the master's DTSTART —
 * TZID-local, floating, UTC, or DATE. EXDATE and RECURRENCE-ID only identify an
 * occurrence when they match how the master names its times; a UTC stamp
 * against a TZID series is a comparison some clients refuse.
 */
export function occurrenceStamp(masterBody: string[], ms: number): string {
  const dtstart = findProp(masterBody, 'DTSTART')
  if (dtstart?.params.toUpperCase().includes('VALUE=DATE')) return `;VALUE=DATE:${dayStamp(ms)}`
  const tzid = tzidOf(dtstart?.params ?? '')
  if (tzid && tzid.toUpperCase() !== 'UTC') return `;TZID=${tzid}:${stampInTz(ms, tzid)}`
  if (dtstart && !tzid && !dtstart.value.trim().endsWith('Z')) return `:${stampInTz(ms, '')}`
  return `:${stamp(ms)}`
}

const EDIT_REPLACED = new Set(['SUMMARY', 'DTSTART', 'DTEND', 'DURATION', 'LOCATION', 'DESCRIPTION', 'SEQUENCE', 'DTSTAMP'])
const TIME_PROPS = ['DTSTART', 'DTEND', 'DURATION']

/**
 * Which text properties the edit leaves as they were. Their lines are then kept
 * verbatim, parameters (LANGUAGE, ALTREP) included.
 */
function unchangedText(
  body: string[],
  edit: { summary: string; location?: string; description?: string },
): Set<string> {
  const values: [string, string | undefined][] = [
    ['SUMMARY', edit.summary], ['LOCATION', edit.location], ['DESCRIPTION', edit.description],
  ]
  return new Set(values.filter(([name, value]) => {
    const old = findProp(body, name)
    return old !== null && unescapeText(old.value).trim() === (value ?? '').trim()
  }).map(([name]) => name))
}

/** Replace one VEVENT body's editable lines (see rewriteEventIcs for the why). */
function editBody(body: string[], edit: EventEdit, keepAlso: (name: string) => boolean = () => false): string[] {
  const { own, nested } = splitNested(body)
  const oldSeq = Number(findProp(own, 'SEQUENCE')?.value ?? 0)
  const untouched = unchangedText(own, edit)
  // An edit that did not move the event keeps its times as written — zone and all.
  const old = readBody(own)
  if (old && old.allDay === edit.allDay && old.start === edit.start && old.end === edit.end) {
    for (const name of TIME_PROPS) untouched.add(name)
  }
  const kept = own.filter((l) => {
    const n = propName(l)
    if (keepAlso(n)) return true
    if (n === 'ATTENDEE' || n === 'ORGANIZER') return edit.attendees === undefined
    return !EDIT_REPLACED.has(n) || untouched.has(n)
  })

  const partstatOf = new Map<string, string>()
  if (edit.attendees) {
    for (const l of own) {
      if (propName(l) !== 'ATTENDEE') continue
      const email = l.slice(l.lastIndexOf(':') + 1).replace(/^mailto:/i, '').toLowerCase()
      const ps = /;PARTSTAT=([^;:]+)/i.exec(l)?.[1]
      if (email && ps) partstatOf.set(email, ps.toUpperCase())
    }
  }
  const existingOrganizer = findProp(own, 'ORGANIZER')
  const unless = (name: string, line: string): string => (untouched.has(name) ? '' : line)

  const fresh = [
    `DTSTAMP:${stamp(Date.now())}`,
    `SEQUENCE:${Number.isFinite(oldSeq) ? oldSeq + 1 : 1}`,
    unless('DTSTART', edit.allDay ? `DTSTART;VALUE=DATE:${dayStamp(edit.start)}` : `DTSTART:${stamp(edit.start)}`),
    unless('DTEND', edit.allDay ? `DTEND;VALUE=DATE:${dayStamp(edit.end)}` : `DTEND:${stamp(edit.end)}`),
    unless('SUMMARY', `SUMMARY:${escapeText(edit.summary)}`),
    unless('LOCATION', edit.location ? `LOCATION:${escapeText(edit.location)}` : ''),
    unless('DESCRIPTION', edit.description ? `DESCRIPTION:${escapeText(edit.description)}` : ''),
    ...(edit.attendees !== undefined && edit.attendees.length > 0
      ? [
          // Keep the event's own organizer; only a first invitation needs ours.
          existingOrganizer
            ? `ORGANIZER${existingOrganizer.params}:${existingOrganizer.value}`
            : edit.organizer
              ? person('ORGANIZER', edit.organizer.email, edit.organizer.name)
              : '',
          ...edit.attendees.map((a) =>
            person(
              'ATTENDEE',
              a.email,
              a.name,
              // An RSVP already given survives the edit; new people start unanswered.
              `;ROLE=REQ-PARTICIPANT;PARTSTAT=${partstatOf.get(a.email.toLowerCase()) ?? 'NEEDS-ACTION'};RSVP=TRUE`,
            ),
          ),
        ]
      : []),
  ].filter(Boolean)

  return [...fresh, ...kept, ...nested]
}

/** Index of the master VEVENT (no RECURRENCE-ID) — of `uid`, when one is named. */
function masterIndex(events: string[][], uid?: string): number {
  return events.findIndex(
    (b) => findProp(b, 'RECURRENCE-ID') === null && (uid === undefined || uidOf(b) === uid),
  )
}

/**
 * Rewrites ONE event's document with new times/text, preserving everything else.
 * `uid` picks the event when the document holds more than one.
 *
 * The blunt alternative — rebuild the whole VEVENT from our own draft — would
 * silently DROP whatever this parser does not model: the attendee list of a
 * meeting created in Apple Calendar, its alarms, its custom X- properties. An
 * edit that loses the attendees is worse than no edit at all, so only the
 * properties the edit form actually changed are replaced; every other line is
 * kept byte-for-byte (modulo refolding).
 *
 * SEQUENCE is bumped and DTSTAMP refreshed: that is how the server and every
 * attendee's client know this copy SUPERSEDES the one they hold — without it,
 * "I moved the meeting and they still showed up at the old time".
 *
 * Refuses a repeating event: rewriting DTSTART under an RRULE shifts the whole
 * series, and exceptions (RECURRENCE-ID) are their own project. Refusing loudly
 * beats corrupting somebody's weekly standup.
 */
export function rewriteEventIcs(raw: string, edit: EventEdit, uid?: string): string {
  const { pre, events, post } = splitVevents(unfoldLines(raw))
  const i = uid === undefined ? 0 : masterIndex(events, uid)
  const body = events[i]
  if (!body) throw new Error('That does not look like a calendar event.')
  if (findProp(body, 'RRULE') || findProp(body, 'RECURRENCE-ID')) {
    throw new Error('This event repeats — edit the series, or just this occurrence.')
  }
  const next = [...events]
  next[i] = editBody(body, edit)
  return joinVevents(pre, next, post)
}

/**
 * Edits the SERIES: title, place, notes — and optionally its time of day and
 * length — for every occurrence at once. The recurrence itself (RRULE, which
 * occurrences are excluded or individually changed) is kept: "the standup is now
 * at 10 and called something else" must not resurrect a deleted occurrence or
 * flatten a moved one. So when the time changes, the EXDATEs and RECURRENCE-IDs
 * that NAME occurrences by their old time are re-named with the new one.
 *
 * The new time keeps the master's own DTSTART form (TZID kept, via wall-clock
 * formatting in that zone) — rewriting a Vienna series as UTC would shift it
 * an hour at every DST boundary, which is exactly the class of bug nobody
 * traces back to a calendar app.
 */
export interface SeriesEdit {
  summary: string
  location?: string
  description?: string
  /** New wall-clock start (hours/minutes) + length; omitted = times unchanged. */
  time?: { hour: number; minute: number; durationMs: number }
  /** Which occurrence the form was opened on, by its original start. */
  shownAt?: number
}

export function rewriteSeriesIcs(raw: string, edit: SeriesEdit, uid?: string): string {
  const { pre, events, post } = splitVevents(unfoldLines(raw))
  const mi = masterIndex(events, uid)
  if (mi === -1) throw new Error('That does not look like a recurring event.')
  const body = events[mi]
  const { own, nested } = splitNested(body)

  const dtstart = findProp(own, 'DTSTART')
  const old = readBody(own)
  if (!dtstart || !old) throw new Error('The series has no start to edit.')

  // A form opened on a MOVED occurrence shows that occurrence's own time.
  // Handing it back unchanged is not a request to move the series there.
  const shown = events
    .filter((b) => b !== body && uidOf(b) === uidOf(body))
    .map(readBody)
    .find((o) => o !== undefined && o.recurrenceId === edit.shownAt)
  const asShown = Boolean(
    shown && edit.time
    && new Date(shown.start).getHours() === edit.time.hour
    && new Date(shown.start).getMinutes() === edit.time.minute
    && shown.end - shown.start === edit.time.durationMs,
  )

  let start = old.start
  let end = old.end
  if (edit.time && !old.allDay && !asShown) {
    // The form shows host-zone times, so that is what the picked time means —
    // applied to the day the series starts on, as this machine sees it.
    const picked = new Date(old.start)
    picked.setHours(edit.time.hour, edit.time.minute)
    start = picked.getTime()
    end = start + Math.max(0, edit.time.durationMs)
  }
  const retimed = start !== old.start || end !== old.end

  const untouched = unchangedText(own, edit)
  if (!retimed) for (const name of TIME_PROPS) untouched.add(name)

  const oldSeq = Number(findProp(own, 'SEQUENCE')?.value ?? 0)
  let kept = own.filter((l) => {
    const n = propName(l)
    return !EDIT_REPLACED.has(n) || untouched.has(n)
  })
  const unless = (name: string, line: string): string => (untouched.has(name) ? '' : line)
  const fresh = [
    `DTSTAMP:${stamp(Date.now())}`,
    `SEQUENCE:${Number.isFinite(oldSeq) ? oldSeq + 1 : 1}`,
    unless('DTSTART', `DTSTART${occurrenceStamp(own, start)}`),
    unless('DTEND', `DTEND${occurrenceStamp(own, end)}`),
    unless('SUMMARY', `SUMMARY:${escapeText(edit.summary)}`),
    unless('LOCATION', edit.location ? `LOCATION:${escapeText(edit.location)}` : ''),
    unless('DESCRIPTION', edit.description ? `DESCRIPTION:${escapeText(edit.description)}` : ''),
  ].filter(Boolean)

  const next = [...events]
  if (start !== old.start) {
    const tzid = tzidOf(dtstart.params)
    const zone = dtstart.value.trim().endsWith('Z') ? 'UTC' : tzid
    const was = wallTimeOf(old.start, zone)
    const now = wallTimeOf(start, zone)
    const dayShift = (Date.UTC(now.y, now.mo, now.d) - Date.UTC(was.y, was.mo, was.d)) / 86_400_000
    const shift = (t: number): number => {
      const w = wallTimeOf(t, zone)
      return epochOf({ ...w, d: w.d + dayShift, h: now.h, mi: now.mi, s: now.s }, zone)
    }
    const rename = (line: string): string => {
      const name = propName(line)
      if (name !== 'EXDATE' && name !== 'RECURRENCE-ID') return line
      const p = findProp([line], name)
      if (!p) return line
      const named = p.value.split(',')
        .map((v) => parseIcsDate(v, false, tzidOf(p.params)))
        .filter((t): t is number => t !== null)
        .map((t) => occurrenceStamp(own, shift(t)))
      if (named.length === 0) return line
      return name + [named[0], ...named.slice(1).map((n) => n.slice(n.lastIndexOf(':') + 1))].join(',')
    }
    kept = kept.map(rename)
    const id = uidOf(body)
    events.forEach((b, i) => {
      if (i !== mi && uidOf(b) === id) next[i] = b.map(rename)
    })
  }
  next[mi] = [...fresh, ...kept, ...nested]
  return joinVevents(pre, next, post)
}

/**
 * Edits ONE occurrence of a series, leaving the rest alone.
 *
 * If the occurrence already has an override VEVENT (same UID + RECURRENCE-ID)
 * it is edited in place; otherwise one is created by cloning what the master
 * says about the occurrence — attendees included, so the server tells them
 * about the change to THIS meeting and no other.
 */
export function rewriteOccurrenceIcs(raw: string, occurrenceStart: number, edit: EventEdit, uid?: string): string {
  const { pre, events, post } = splitVevents(unfoldLines(raw))
  const mi = masterIndex(events, uid)
  if (mi === -1) throw new Error('That does not look like a recurring event.')
  const master = events[mi]
  const recId = `RECURRENCE-ID${occurrenceStamp(master, occurrenceStart)}`

  const matches = (b: string[]): boolean => {
    const p = findProp(b, 'RECURRENCE-ID')
    return p !== null && uidOf(b) === uidOf(master) && `RECURRENCE-ID${p.params}:${p.value}` === recId
  }
  const oi = events.findIndex((b) => b !== master && matches(b))

  const next = [...events]
  if (oi >= 0) {
    next[oi] = editBody(events[oi], edit, (n) => n === 'RECURRENCE-ID')
  } else {
    // A fresh override: the master's own lines minus the series machinery,
    // re-timed, stamped with which occurrence it replaces.
    const { own, nested } = splitNested(master)
    const seed = own.filter((l) => !['RRULE', 'RDATE', 'EXDATE', 'DTSTART', 'DTEND', 'DURATION'].includes(propName(l)))
    next.push([recId, ...editBody([...seed, ...nested], edit)])
  }
  return joinVevents(pre, next, post)
}

/**
 * Deletes ONE occurrence of a series: an EXDATE on the master, written in the
 * master's own time form. An override for that occurrence is removed too — an
 * exception to an excluded slot is a contradiction some clients render anyway.
 */
export function addExdateIcs(raw: string, occurrenceStart: number, uid?: string): string {
  const { pre, events, post } = splitVevents(unfoldLines(raw))
  const mi = masterIndex(events, uid)
  if (mi === -1) throw new Error('That does not look like a recurring event.')
  const master = events[mi]
  const stampStr = occurrenceStamp(master, occurrenceStart)
  const recId = `RECURRENCE-ID${stampStr}`

  const next = events.filter((b) => {
    if (b === master) return true
    const p = findProp(b, 'RECURRENCE-ID')
    return !(p !== null && uidOf(b) === uidOf(master) && `RECURRENCE-ID${p.params}:${p.value}` === recId)
  })
  const { own, nested } = splitNested(master)
  const oldSeq = Number(findProp(own, 'SEQUENCE')?.value ?? 0)
  const bumped = own.filter((l) => !['SEQUENCE', 'DTSTAMP'].includes(propName(l)))
  next[next.indexOf(master)] = [
    `DTSTAMP:${stamp(Date.now())}`,
    `SEQUENCE:${Number.isFinite(oldSeq) ? oldSeq + 1 : 1}`,
    `EXDATE${stampStr}`,
    ...bumped,
    ...nested,
  ]
  return joinVevents(pre, next, post)
}

/* ── a document holding many events (the local calendar file) ─────────────── */

/** Adds an event to an existing calendar document, leaving what is there alone. */
export function appendEventIcs(raw: string, e: EventDraft): string {
  const lines = unfoldLines(raw)
  const upper = lines.map((l) => l.trim().toUpperCase())
  if (!upper.includes('BEGIN:VCALENDAR') || !upper.includes('END:VCALENDAR')) {
    throw new Error('That is not a complete calendar document — it was left untouched.')
  }
  const zone = e.allDay ? undefined : namedZone(e.timeZone)
  if (zone && !lines.includes(`TZID:${zone}`)) {
    // Definitions go ahead of the events that name them.
    const first = upper.indexOf('BEGIN:VEVENT')
    lines.splice(first >= 0 ? first : upper.lastIndexOf('END:VCALENDAR'), 0, ...zonesFor([e]))
  }
  const end = lines.map((l) => l.trim().toUpperCase()).lastIndexOf('END:VCALENDAR')
  lines.splice(end, 0, ...rawEventLines(e))
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

/** Removes an event and its overrides; null when the document has no such event. */
export function removeEventIcs(raw: string, uid: string): string | null {
  const { pre, events, post } = splitVevents(unfoldLines(raw))
  const kept = events.filter((b) => uidOf(b) !== uid)
  return kept.length === events.length ? null : joinVevents(pre, kept, post)
}

/** Several events in one document. */
export function buildCalendarIcs(events: EventDraft[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Workspace OS//EN',
    'CALSCALE:GREGORIAN',
    ...zonesFor(events),
    ...events.flatMap((e) => eventLines(e)),
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}
