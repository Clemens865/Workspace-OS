/**
 * Writing iCalendar — the shared half of "the app can create an event".
 *
 * Split out of local-calendar.ts once CalDAV needed the same escaping, folding
 * and VEVENT construction. Two implementations of iCalendar generation in one
 * codebase would drift, and the drift would be invisible: both would produce
 * files that look right, and one of them would fail to import.
 */

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
}

/** Escapes a text value per RFC 5545 §3.3.11. */
export function escapeText(v: string): string {
  return String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** UTC stamp: 20260817T143000Z. */
export function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** Date-only stamp for an all-day event: 20260817. */
export function dayStamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, '')
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
  const cn = name ? `;CN=${escapeText(name)}` : ''
  return `${prefix}${cn}${extra}:mailto:${email}`
}

/** The VEVENT body, without the surrounding VCALENDAR. */
export function eventLines(e: EventDraft): string[] {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${stamp(Date.now())}`,
    `SEQUENCE:${e.sequence ?? 0}`,
    e.allDay ? `DTSTART;VALUE=DATE:${dayStamp(e.start)}` : `DTSTART:${stamp(e.start)}`,
    e.allDay ? `DTEND;VALUE=DATE:${dayStamp(e.end)}` : `DTEND:${stamp(e.end)}`,
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
  return lines.filter(Boolean).map(foldLine)
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

/** The param string and value of a named property line, or null. */
function findProp(body: string[], name: string): { params: string; value: string } | null {
  for (const l of body) {
    if (propName(l) !== name) continue
    const colon = l.indexOf(':')
    if (colon < 0) continue
    const head = l.slice(0, colon)
    const semi = head.indexOf(';')
    return { params: semi >= 0 ? head.slice(semi) : '', value: l.slice(colon + 1) }
  }
  return null
}

/** `20260825T093000`, as wall-clock time in an IANA zone (for TZID forms). */
export function stampInTz(ms: number, tzid: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tzid, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(ms))
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '00'
  // Intl can emit hour "24" for midnight; the spec wants 00.
  const hour = get('hour') === '24' ? '00' : get('hour')
  return `${get('year')}${get('month')}${get('day')}T${hour}${get('minute')}${get('second')}`
}

/**
 * An occurrence instant written in the SAME form as the master's DTSTART —
 * TZID-local, UTC, or DATE. EXDATE and RECURRENCE-ID only identify an
 * occurrence when they match how the master names its times; a UTC stamp
 * against a TZID series is a comparison some clients refuse.
 */
export function occurrenceStamp(masterBody: string[], ms: number): string {
  const dtstart = findProp(masterBody, 'DTSTART')
  if (dtstart?.params.toUpperCase().includes('VALUE=DATE')) return `;VALUE=DATE:${dayStamp(ms)}`
  const tzid = /;TZID=([^;:]+)/i.exec(dtstart?.params ?? '')?.[1]
  if (tzid && tzid.toUpperCase() !== 'UTC') return `;TZID=${tzid}:${stampInTz(ms, tzid)}`
  return `:${stamp(ms)}`
}

const EDIT_REPLACED = new Set(['SUMMARY', 'DTSTART', 'DTEND', 'DURATION', 'LOCATION', 'DESCRIPTION', 'SEQUENCE', 'DTSTAMP'])

/** Replace one VEVENT body's editable lines (see rewriteEventIcs for the why). */
function editBody(body: string[], edit: EventEdit, keepAlso: (name: string) => boolean = () => false): string[] {
  const oldSeq = Number(findProp(body, 'SEQUENCE')?.value ?? 0)
  const kept = body.filter((l) => {
    const n = propName(l)
    if (keepAlso(n)) return true
    if (n === 'ATTENDEE' || n === 'ORGANIZER') return edit.attendees === undefined
    return !EDIT_REPLACED.has(n)
  })

  const partstatOf = new Map<string, string>()
  if (edit.attendees) {
    for (const l of body) {
      if (propName(l) !== 'ATTENDEE') continue
      const email = l.slice(l.lastIndexOf(':') + 1).replace(/^mailto:/i, '').toLowerCase()
      const ps = /;PARTSTAT=([^;:]+)/i.exec(l)?.[1]
      if (email && ps) partstatOf.set(email, ps.toUpperCase())
    }
  }
  const existingOrganizer = findProp(body, 'ORGANIZER')

  const fresh = [
    `DTSTAMP:${stamp(Date.now())}`,
    `SEQUENCE:${Number.isFinite(oldSeq) ? oldSeq + 1 : 1}`,
    edit.allDay ? `DTSTART;VALUE=DATE:${dayStamp(edit.start)}` : `DTSTART:${stamp(edit.start)}`,
    edit.allDay ? `DTEND;VALUE=DATE:${dayStamp(edit.end)}` : `DTEND:${stamp(edit.end)}`,
    `SUMMARY:${escapeText(edit.summary)}`,
    edit.location ? `LOCATION:${escapeText(edit.location)}` : '',
    edit.description ? `DESCRIPTION:${escapeText(edit.description)}` : '',
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

  return [...fresh, ...kept]
}

/** Index of the master VEVENT (the one WITHOUT a RECURRENCE-ID). */
function masterIndex(events: string[][]): number {
  return events.findIndex((b) => !b.some((l) => propName(l) === 'RECURRENCE-ID'))
}

/**
 * Rewrites ONE event's document with new times/text, preserving everything else.
 *
 * The blunt alternative — rebuild the whole VEVENT from our own draft — would
 * silently DROP whatever this parser does not model: the attendee list of a
 * meeting created in Apple Calendar, its alarms, its custom X- properties. An
 * edit that loses the attendees is worse than no edit at all, so only the
 * properties the edit form can change are replaced; every other line is kept
 * byte-for-byte (modulo refolding).
 *
 * SEQUENCE is bumped and DTSTAMP refreshed: that is how the server and every
 * attendee's client know this copy SUPERSEDES the one they hold — without it,
 * "I moved the meeting and they still showed up at the old time".
 *
 * Refuses a repeating event: rewriting DTSTART under an RRULE shifts the whole
 * series, and exceptions (RECURRENCE-ID) are their own project. Refusing loudly
 * beats corrupting somebody's weekly standup.
 */
export function rewriteEventIcs(raw: string, edit: EventEdit): string {
  const { pre, events, post } = splitVevents(unfoldLines(raw))
  if (events.length === 0) throw new Error('That does not look like a calendar event.')
  const body = events[0]
  if (body.some((l) => ['RRULE', 'RECURRENCE-ID'].includes(propName(l)))) {
    throw new Error('This event repeats — edit the series, or just this occurrence.')
  }
  const next = [...events]
  next[0] = editBody(body, edit)
  return joinVevents(pre, next, post)
}

/**
 * Edits the SERIES: title, place, notes — and optionally its time of day and
 * length — for every occurrence at once. The recurrence itself (RRULE, its
 * EXDATEs, any per-occurrence overrides) is untouched: "the standup is now at
 * 10 and called something else" must not resurrect a deleted occurrence or
 * flatten a moved one.
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
}

export function rewriteSeriesIcs(raw: string, edit: SeriesEdit): string {
  const { pre, events, post } = splitVevents(unfoldLines(raw))
  const mi = masterIndex(events)
  if (mi === -1) throw new Error('That does not look like a recurring event.')
  const body = events[mi]

  const keepRecurrence = (n: string): boolean => ['RRULE', 'EXDATE', 'RDATE'].includes(n)
  const dtstart = findProp(body, 'DTSTART')
  if (!dtstart) throw new Error('The series has no start to edit.')
  const allDay = dtstart.params.toUpperCase().includes('VALUE=DATE')

  let startLine = `DTSTART${dtstart.params}:${dtstart.value}`
  let endLine: string | null = null
  if (edit.time && !allDay) {
    const tzid = /;TZID=([^;:]+)/i.exec(dtstart.params)?.[1]
    // The master's date, with the new wall-clock time. parseIcsDate semantics
    // (host zone for TZID/floating forms) are mirrored here on purpose — the
    // form shows host-zone times, so that is what the picked time means.
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(dtstart.value.trim())
    if (!m) throw new Error('The series start could not be read.')
    const base = dtstart.value.trim().endsWith('Z')
      ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
      : new Date(+m[1], +m[2] - 1, +m[3])
    const local = new Date(base.getFullYear(), base.getMonth(), base.getDate(), edit.time.hour, edit.time.minute, 0, 0)
    const startMs = local.getTime()
    const endMs = startMs + Math.max(0, edit.time.durationMs)
    if (tzid && tzid.toUpperCase() !== 'UTC') {
      startLine = `DTSTART;TZID=${tzid}:${stampInTz(startMs, tzid)}`
      endLine = `DTEND;TZID=${tzid}:${stampInTz(endMs, tzid)}`
    } else {
      startLine = `DTSTART:${stamp(startMs)}`
      endLine = `DTEND:${stamp(endMs)}`
    }
  } else {
    const dtend = findProp(body, 'DTEND')
    if (dtend) endLine = `DTEND${dtend.params}:${dtend.value}`
  }

  const oldSeq = Number(findProp(body, 'SEQUENCE')?.value ?? 0)
  const kept = body.filter((l) => {
    const n = propName(l)
    return keepRecurrence(n) || !EDIT_REPLACED.has(n)
  })
  const fresh = [
    `DTSTAMP:${stamp(Date.now())}`,
    `SEQUENCE:${Number.isFinite(oldSeq) ? oldSeq + 1 : 1}`,
    startLine,
    endLine ?? '',
    `SUMMARY:${escapeText(edit.summary)}`,
    edit.location ? `LOCATION:${escapeText(edit.location)}` : '',
    edit.description ? `DESCRIPTION:${escapeText(edit.description)}` : '',
  ].filter(Boolean)

  const next = [...events]
  next[mi] = [...fresh, ...kept]
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
export function rewriteOccurrenceIcs(raw: string, occurrenceStart: number, edit: EventEdit): string {
  const { pre, events, post } = splitVevents(unfoldLines(raw))
  const mi = masterIndex(events)
  if (mi === -1) throw new Error('That does not look like a recurring event.')
  const master = events[mi]
  const recId = `RECURRENCE-ID${occurrenceStamp(master, occurrenceStart)}`

  const matches = (b: string[]): boolean => {
    const p = findProp(b, 'RECURRENCE-ID')
    return p !== null && `RECURRENCE-ID${p.params}:${p.value}` === recId
  }
  const oi = events.findIndex((b) => b !== master && matches(b))

  const next = [...events]
  if (oi >= 0) {
    next[oi] = editBody(events[oi], edit, (n) => n === 'RECURRENCE-ID')
  } else {
    // A fresh override: the master's own lines minus the series machinery,
    // re-timed, stamped with which occurrence it replaces.
    const seed = master.filter((l) => !['RRULE', 'RDATE', 'EXDATE', 'DTSTART', 'DTEND', 'DURATION'].includes(propName(l)))
    next.push([recId, ...editBody(seed, edit)])
  }
  return joinVevents(pre, next, post)
}

/**
 * Deletes ONE occurrence of a series: an EXDATE on the master, written in the
 * master's own time form. An override for that occurrence is removed too — an
 * exception to an excluded slot is a contradiction some clients render anyway.
 */
export function addExdateIcs(raw: string, occurrenceStart: number): string {
  const { pre, events, post } = splitVevents(unfoldLines(raw))
  const mi = masterIndex(events)
  if (mi === -1) throw new Error('That does not look like a recurring event.')
  const master = events[mi]
  const stampStr = occurrenceStamp(master, occurrenceStart)
  const recId = `RECURRENCE-ID${stampStr}`

  const next = events.filter((b) => {
    if (b === master) return true
    const p = findProp(b, 'RECURRENCE-ID')
    return !(p !== null && `RECURRENCE-ID${p.params}:${p.value}` === recId)
  })
  const oldSeq = Number(findProp(master, 'SEQUENCE')?.value ?? 0)
  const bumped = master.filter((l) => !['SEQUENCE', 'DTSTAMP'].includes(propName(l)))
  next[next.indexOf(master)] = [
    `DTSTAMP:${stamp(Date.now())}`,
    `SEQUENCE:${Number.isFinite(oldSeq) ? oldSeq + 1 : 1}`,
    `EXDATE${stampStr}`,
    ...bumped,
  ]
  return joinVevents(pre, next, post)
}

/** Several events in one document — the local calendar file. */
export function buildCalendarIcs(events: EventDraft[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Workspace OS//EN',
    'CALSCALE:GREGORIAN',
    ...events.flatMap((e) => eventLines(e)),
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}
