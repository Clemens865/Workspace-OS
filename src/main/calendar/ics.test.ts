import { describe, it, expect } from 'vitest'
import {
  unfoldLines, parseLine, unescapeText, parseIcsDate,
  parseIcs, parseRrule, expandRecurrence, eventsInRange,
} from './ics'

/** Local wall-clock time as epoch ms — the calendar's own convention. */
const at = (y: number, mo: number, d: number, h = 0, mi = 0): number =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

describe('unfoldLines', () => {
  it('joins RFC 5545 folded continuations', () => {
    // Feeds fold at 75 octets, so without this most long summaries truncate.
    expect(unfoldLines('SUMMARY:Quarterly plan\r\n ning review')).toEqual(['SUMMARY:Quarterly planning review'])
  })

  it('treats a tab continuation the same as a space', () => {
    expect(unfoldLines('DESCRIPTION:one\n\ttwo')).toEqual(['DESCRIPTION:onetwo'])
  })

  it('handles LF-only and CR-only feeds', () => {
    expect(unfoldLines('A:1\nB:2')).toEqual(['A:1', 'B:2'])
    expect(unfoldLines('A:1\rB:2')).toEqual(['A:1', 'B:2'])
  })

  it('drops blank lines without swallowing the next one', () => {
    expect(unfoldLines('A:1\n\nB:2')).toEqual(['A:1', 'B:2'])
  })
})

describe('parseLine', () => {
  it('splits name, params and value', () => {
    expect(parseLine('DTSTART;TZID=Europe/Vienna:20260729T090000')).toEqual({
      name: 'DTSTART', params: { TZID: 'Europe/Vienna' }, value: '20260729T090000',
    })
  })

  it('ignores a colon inside a QUOTED param value', () => {
    // The naive "first colon" split breaks on this and loses the value.
    const line = parseLine('ATTENDEE;CN="Ede, Bob:x":mailto:b@x.com')
    expect(line?.params.CN).toBe('Ede, Bob:x')
    expect(line?.value).toBe('mailto:b@x.com')
  })

  it('returns null for a line with no value', () => {
    expect(parseLine('GARBAGE')).toBeNull()
  })
})

describe('unescapeText', () => {
  it('decodes \\n, \\, and \\; and a literal backslash', () => {
    expect(unescapeText('Line1\\nLine2')).toBe('Line1\nLine2')
    expect(unescapeText('a\\, b\\; c')).toBe('a, b; c')
    expect(unescapeText('back\\\\slash')).toBe('back\\slash')
  })

  it('tolerates a trailing lone backslash', () => {
    expect(unescapeText('oops\\')).toBe('oops\\')
  })
})

describe('parseIcsDate', () => {
  it('reads an all-day DATE as local midnight', () => {
    expect(parseIcsDate('20260729', true)).toBe(at(2026, 7, 29))
  })

  it('reads a Z timestamp as UTC', () => {
    expect(parseIcsDate('20260729T093000Z', false)).toBe(Date.UTC(2026, 6, 29, 9, 30, 0))
  })

  it('reads a floating timestamp in the host zone', () => {
    expect(parseIcsDate('20260729T093000', false)).toBe(at(2026, 7, 29, 9, 30))
  })

  it('returns null for junk rather than guessing a time', () => {
    expect(parseIcsDate('not-a-date', false)).toBeNull()
    expect(parseIcsDate('2026-07-29', false)).toBeNull()
  })
})

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:standup@x
SUMMARY:Daily stand-up
DTSTART;TZID=Europe/Vienna:20260729T090000
DTEND;TZID=Europe/Vienna:20260729T091500
LOCATION:Room 2\\, upstairs
RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=6
BEGIN:VALARM
TRIGGER:-PT10M
SUMMARY:should be ignored
END:VALARM
END:VEVENT
BEGIN:VEVENT
UID:offsite@x
SUMMARY:Team offsite
DTSTART;VALUE=DATE:20260803
DTEND;VALUE=DATE:20260805
DESCRIPTION:Bring\\nwalking shoes
END:VEVENT
BEGIN:VEVENT
SUMMARY:no uid so skipped
DTSTART:20260729T100000Z
END:VEVENT
END:VCALENDAR`

describe('parseIcs', () => {
  const events = parseIcs(ICS)

  it('parses each valid VEVENT and skips the one with no UID', () => {
    expect(events.map((e) => e.uid)).toEqual(['standup@x', 'offsite@x'])
  })

  it('keeps a VALARM from overwriting the event it sits inside', () => {
    // The alarm's own SUMMARY must not leak onto the event.
    expect(events[0].summary).toBe('Daily stand-up')
  })

  it('unescapes text values', () => {
    expect(events[0].location).toBe('Room 2, upstairs')
    expect(events[1].description).toBe('Bring\nwalking shoes')
  })

  it('preserves a non-UTC TZID instead of pretending it was UTC', () => {
    expect(events[0].tzid).toBe('Europe/Vienna')
  })

  it('marks a VALUE=DATE event all-day with an exclusive end', () => {
    expect(events[1].allDay).toBe(true)
    expect(events[1].start).toBe(at(2026, 8, 3))
    expect(events[1].end).toBe(at(2026, 8, 5))
  })

  it('defaults a missing DTEND — one day all-day, else zero-length', () => {
    const [one] = parseIcs('BEGIN:VEVENT\nUID:a\nDTSTART;VALUE=DATE:20260729\nEND:VEVENT')
    expect(one.end - one.start).toBe(86_400_000)
    const [two] = parseIcs('BEGIN:VEVENT\nUID:b\nDTSTART:20260729T090000Z\nEND:VEVENT')
    expect(two.end).toBe(two.start)
  })

  it('falls back to a placeholder title rather than an empty label', () => {
    expect(parseIcs('BEGIN:VEVENT\nUID:c\nDTSTART:20260729T090000Z\nEND:VEVENT')[0].summary).toBe('(no title)')
  })
})

describe('parseRrule', () => {
  it('reads freq, interval, count and until', () => {
    expect(parseRrule('FREQ=DAILY;INTERVAL=2;COUNT=5')).toMatchObject({ freq: 'DAILY', interval: 2, count: 5 })
    expect(parseRrule('FREQ=WEEKLY;UNTIL=20260901T000000Z')?.until).toBe(Date.UTC(2026, 8, 1, 0, 0, 0))
  })

  it('defaults interval to 1 and rejects an unknown freq', () => {
    expect(parseRrule('FREQ=MONTHLY')?.interval).toBe(1)
    expect(parseRrule('FREQ=FORTNIGHTLY')).toBeNull()
    expect(parseRrule('nonsense')).toBeNull()
  })

  it('reads BYDAY and degrades an ordinal prefix to the weekday', () => {
    expect(parseRrule('FREQ=WEEKLY;BYDAY=MO,WE')?.byDay).toEqual([1, 3])
    // "2MO" (2nd Monday) isn't supported positionally — better Mondays than nothing.
    expect(parseRrule('FREQ=MONTHLY;BYDAY=2MO')?.byDay).toEqual([1])
  })
})

describe('expandRecurrence', () => {
  const daily = {
    uid: 'd', summary: 'D', allDay: false,
    start: at(2026, 7, 1, 9), end: at(2026, 7, 1, 10),
    rrule: 'FREQ=DAILY;COUNT=10',
  }

  it('expands a recurring event across the window', () => {
    const out = expandRecurrence(daily, at(2026, 7, 1), at(2026, 7, 5))
    expect(out).toHaveLength(4)
    expect(out[0].start).toBe(at(2026, 7, 1, 9))
    expect(out[3].start).toBe(at(2026, 7, 4, 9))
  })

  it('preserves duration and tags instances with the parent uid', () => {
    const [first] = expandRecurrence(daily, at(2026, 7, 1), at(2026, 7, 2))
    expect(first.end - first.start).toBe(3_600_000)
    expect(first.recurringUid).toBe('d')
    expect(first.uid).not.toBe('d') // instances need distinct keys
  })

  it('honours COUNT', () => {
    const out = expandRecurrence(daily, at(2026, 7, 1), at(2026, 8, 1))
    expect(out).toHaveLength(10)
  })

  it('honours UNTIL', () => {
    const ev = { ...daily, rrule: 'FREQ=DAILY;UNTIL=20260703T235900' }
    expect(expandRecurrence(ev, at(2026, 7, 1), at(2026, 8, 1))).toHaveLength(3)
  })

  it('honours INTERVAL', () => {
    const ev = { ...daily, rrule: 'FREQ=DAILY;INTERVAL=3;COUNT=3' }
    const out = expandRecurrence(ev, at(2026, 7, 1), at(2026, 8, 1))
    expect(out.map((e) => new Date(e.start).getDate())).toEqual([1, 4, 7])
  })

  it('expands WEEKLY;BYDAY to one instance per named day', () => {
    // 2026-07-01 is a Wednesday; Mon+Fri of that week are the 29th (before start,
    // so skipped) and the 3rd.
    const ev = { ...daily, rrule: 'FREQ=WEEKLY;BYDAY=MO,FR' }
    const out = expandRecurrence(ev, at(2026, 7, 1), at(2026, 7, 15))
    const days = out.map((e) => new Date(e.start).getDate())
    expect(days).toEqual([3, 6, 10, 13])
  })

  it('keeps the wall-clock time when expanding', () => {
    const out = expandRecurrence(daily, at(2026, 7, 1), at(2026, 7, 4))
    for (const e of out) expect(new Date(e.start).getHours()).toBe(9)
  })

  it('returns a non-recurring event only when it overlaps', () => {
    const plain = { uid: 'p', summary: 'P', allDay: false, start: at(2026, 7, 10, 9), end: at(2026, 7, 10, 10) }
    expect(expandRecurrence(plain, at(2026, 7, 1), at(2026, 7, 5))).toEqual([])
    expect(expandRecurrence(plain, at(2026, 7, 10), at(2026, 7, 11))).toHaveLength(1)
  })

  it('cannot hang on an unbounded rule — the window and cap bound it', () => {
    const forever = { ...daily, rrule: 'FREQ=DAILY' }
    const out = expandRecurrence(forever, at(2026, 7, 1), at(2026, 7, 8))
    expect(out).toHaveLength(7)
  })

  it('treats an unparseable RRULE as a single event rather than dropping it', () => {
    const bad = { ...daily, rrule: 'FREQ=NEVER' }
    expect(expandRecurrence(bad, at(2026, 7, 1), at(2026, 7, 2))).toHaveLength(1)
  })
})

describe('eventsInRange', () => {
  it('merges, expands and time-orders a whole feed', () => {
    const out = eventsInRange(parseIcs(ICS), at(2026, 7, 29), at(2026, 8, 6))
    expect(out.length).toBeGreaterThan(1)
    for (let i = 1; i < out.length; i++) expect(out[i].start).toBeGreaterThanOrEqual(out[i - 1].start)
  })
})

describe('attendees / organizer round-trip (read)', () => {
  const ICS = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:m@x',
    'DTSTART:20260825T090000Z',
    'DTEND:20260825T100000Z',
    'SUMMARY:Standup',
    'ORGANIZER;CN=Organizer:mailto:organizer@icloud.com',
    'ATTENDEE;CN=Anna Weber;PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:anna@x.com',
    'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:ben@y.org',
    'ATTENDEE:urn:uuid:not-an-address',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  it('reads who is invited and where their RSVP stands', () => {
    const [ev] = parseIcs(ICS)
    expect(ev.organizer).toEqual({ email: 'organizer@icloud.com', name: 'Organizer' })
    expect(ev.attendees).toEqual([
      { email: 'anna@x.com', name: 'Anna Weber', partstat: 'ACCEPTED' },
      { email: 'ben@y.org', partstat: 'NEEDS-ACTION' },
    ])
  })
})

describe('EXDATE and RECURRENCE-ID', () => {
  const at = (d: number, h = 9): number => Date.UTC(2026, 7, d, h, 0, 0)
  const MASTER = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:series@x',
    'DTSTART:20260803T090000Z', // Monday
    'DTEND:20260803T093000Z',
    'RRULE:FREQ=WEEKLY',
    'EXDATE:20260817T090000Z',
    'SUMMARY:Weekly',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  it('a deleted occurrence does not appear, the rest do', () => {
    const evs = eventsInRange(parseIcs(MASTER), at(1), at(32))
    const starts = evs.map((e) => e.start)
    expect(starts).toContain(at(3))
    expect(starts).toContain(at(10))
    expect(starts).not.toContain(at(17)) // EXDATEd
    expect(starts).toContain(at(24))
  })

  it('an override replaces its occurrence instead of duplicating it', () => {
    const withOverride = MASTER.replace(
      'END:VCALENDAR',
      [
        'BEGIN:VEVENT',
        'UID:series@x',
        'RECURRENCE-ID:20260810T090000Z',
        'DTSTART:20260810T140000Z', // moved to the afternoon
        'DTEND:20260810T143000Z',
        'SUMMARY:Weekly (moved)',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    )
    const evs = eventsInRange(parseIcs(withOverride), at(1), at(32))
    const aug10 = evs.filter((e) => e.start >= at(10, 0) && e.start < at(11, 0))
    // ONE event on the 10th — the moved copy, not the ghost of 09:00.
    expect(aug10).toHaveLength(1)
    expect(aug10[0].start).toBe(at(10, 14))
    expect(aug10[0].summary).toBe('Weekly (moved)')
    expect(aug10[0].recurrenceId).toBe(at(10))
    // The untouched weeks still expand normally.
    expect(evs.some((e) => e.start === at(3))).toBe(true)
  })
})
