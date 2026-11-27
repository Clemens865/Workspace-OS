import { describe, it, expect, afterEach } from 'vitest'
import { parseIcs, parseRrule, expandRecurrence, eventsInRange, type CalendarEvent } from './ics'
import { parseRecurrenceInput, toRrule } from './recurrence'
import { buildEventIcs, dayStamp } from './ics-write'

/**
 * Recurrence is where a calendar quietly lies: a meeting on a day it is not, or
 * an hour off for half the year. These pin the RFC 5545 behaviour — skipped
 * short months, positional weekdays, and wall-clock time kept in the SERIES'
 * zone across DST — plus the strictness of what the app will author.
 */

/** Local wall-clock time as epoch ms. */
const at = (y: number, mo: number, d: number, h = 0, mi = 0): number =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

const series = (rrule: string, start: number, o: Partial<CalendarEvent> = {}): CalendarEvent => ({
  uid: 'r', summary: 'R', allDay: false, start, end: start + 3_600_000, rrule, ...o,
})

/** `M/D` of every instance, in local time. */
const days = (events: CalendarEvent[]): string[] =>
  events.map((e) => `${new Date(e.start).getMonth() + 1}/${new Date(e.start).getDate()}`)

const expand = (rrule: string, start: number, from: number, to: number): string[] =>
  days(expandRecurrence(series(rrule, start), from, to))

// Deleting TZ does not switch Node back, so restore the zone by name.
const originalTz = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone
afterEach(() => {
  process.env.TZ = originalTz
})

describe('parseRrule — the parts that used to be ignored', () => {
  it('reads BYMONTHDAY, positional BYDAY, BYMONTH, BYSETPOS and WKST', () => {
    expect(parseRrule('FREQ=MONTHLY;BYMONTHDAY=15,-1')?.byMonthDay).toEqual([15, -1])
    expect(parseRrule('FREQ=MONTHLY;BYDAY=2MO,-1FR')?.byDayOrdinals).toEqual([
      { weekday: 1, ordinal: 2 }, { weekday: 5, ordinal: -1 },
    ])
    expect(parseRrule('FREQ=YEARLY;BYMONTH=11;BYDAY=4TH')?.byMonth).toEqual([11])
    expect(parseRrule('FREQ=MONTHLY;BYDAY=MO,FR;BYSETPOS=-1')?.bySetPos).toEqual([-1])
    expect(parseRrule('FREQ=WEEKLY;WKST=SU')?.weekStart).toBe(0)
  })

  it('refuses parts it cannot honour rather than inventing dates', () => {
    expect(parseRrule('FREQ=YEARLY;BYYEARDAY=100')).toBeNull()
    expect(parseRrule('FREQ=YEARLY;BYWEEKNO=2;BYDAY=MO')).toBeNull()
    expect(parseRrule('FREQ=DAILY;BYHOUR=9,17')).toBeNull()
  })
})

describe('expandRecurrence — calendar rules', () => {
  it('monthly on the 31st SKIPS short months instead of rolling into the next', () => {
    expect(expand('FREQ=MONTHLY', at(2026, 1, 31, 9), at(2026, 1, 1), at(2026, 8, 1)))
      .toEqual(['1/31', '3/31', '5/31', '7/31'])
  })

  it('skipped months do not use up COUNT', () => {
    expect(expand('FREQ=MONTHLY;COUNT=3', at(2026, 1, 31, 9), at(2026, 1, 1), at(2027, 1, 1)))
      .toEqual(['1/31', '3/31', '5/31'])
  })

  it('yearly on 29 February only happens in leap years', () => {
    const out = expandRecurrence(series('FREQ=YEARLY;COUNT=2', at(2028, 2, 29, 9)), at(2028, 1, 1), at(2029, 12, 31))
    expect(days(out)).toEqual(['2/29'])
    expect(expand('FREQ=YEARLY', at(2028, 2, 29, 9), at(2032, 1, 1), at(2033, 1, 1))).toEqual(['2/29'])
  })

  it('honours BYMONTHDAY, including counting from the end', () => {
    expect(expand('FREQ=MONTHLY;BYMONTHDAY=-1', at(2026, 1, 31, 9), at(2026, 1, 1), at(2026, 4, 1)))
      .toEqual(['1/31', '2/28', '3/31'])
    expect(expand('FREQ=MONTHLY;BYMONTHDAY=1,15', at(2026, 1, 1, 9), at(2026, 1, 1), at(2026, 3, 1)))
      .toEqual(['1/1', '1/15', '2/1', '2/15'])
  })

  it('honours positional BYDAY — the second Monday, the last Friday', () => {
    expect(expand('FREQ=MONTHLY;BYDAY=2MO', at(2026, 7, 13, 9), at(2026, 7, 1), at(2026, 10, 1)))
      .toEqual(['7/13', '8/10', '9/14'])
    expect(expand('FREQ=MONTHLY;BYDAY=-1FR', at(2026, 7, 31, 9), at(2026, 7, 1), at(2026, 10, 1)))
      .toEqual(['7/31', '8/28', '9/25'])
  })

  it('honours BYSETPOS (last weekday of the month)', () => {
    expect(expand('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', at(2026, 7, 31, 9), at(2026, 7, 1), at(2026, 11, 1)))
      .toEqual(['7/31', '8/31', '9/30', '10/30'])
  })

  it('honours a yearly month + positional weekday', () => {
    expect(expand('FREQ=YEARLY;BYMONTH=11;BYDAY=4TH', at(2026, 11, 26, 9), at(2026, 1, 1), at(2027, 12, 31)))
      .toEqual(['11/26', '11/25'])
  })

  it('every other week uses Monday weeks unless WKST says otherwise', () => {
    // Tue 4 Aug 2026; Monday-first week is 3–9 Aug, so Sunday the 9th belongs to it.
    expect(expand('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,SU;COUNT=4', at(2026, 8, 4, 9), at(2026, 8, 1), at(2026, 10, 1)))
      .toEqual(['8/4', '8/9', '8/18', '8/23'])
    expect(expand('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,SU;COUNT=4;WKST=SU', at(2026, 8, 4, 9), at(2026, 8, 1), at(2026, 10, 1)))
      .toEqual(['8/4', '8/16', '8/18', '8/30'])
  })

  it('BYDAY filters a daily rule', () => {
    expect(expand('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;COUNT=3', at(2026, 7, 31, 9), at(2026, 7, 1), at(2026, 9, 1)))
      .toEqual(['7/31', '8/3', '8/4'])
  })

  it('a daily series started years ago still shows in the current window', () => {
    const out = expandRecurrence(series('FREQ=DAILY', at(2019, 1, 1, 9)), at(2026, 7, 1), at(2026, 7, 8))
    expect(out).toHaveLength(7)
  })

  it('terminates on a rule that can never match', () => {
    expect(expandRecurrence(series('FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=31', at(2026, 1, 1, 9)), at(2026, 1, 1), at(2027, 1, 1)))
      .toEqual([])
  })

  it('a date-only UNTIL on a timed series includes that whole day', () => {
    expect(expand('FREQ=DAILY;UNTIL=20260703', at(2026, 7, 1, 9), at(2026, 7, 1), at(2026, 8, 1)))
      .toEqual(['7/1', '7/2', '7/3'])
  })
})

describe('time zones and DST', () => {
  const FROM = Date.UTC(2026, 9, 1)
  const TO = Date.UTC(2026, 10, 15)

  it('a TZID series keeps its wall-clock time in ITS zone across a DST change', () => {
    const [ev] = parseIcs([
      'BEGIN:VEVENT', 'UID:v', 'DTSTART;TZID=Europe/Vienna:20261019T090000',
      'DTEND;TZID=Europe/Vienna:20261019T100000', 'RRULE:FREQ=WEEKLY;COUNT=2', 'END:VEVENT',
    ].join('\n'))
    // Europe leaves summer time on 25 Oct 2026: 09:00 Vienna is 07:00Z before, 08:00Z after.
    expect(expandRecurrence(ev, FROM, TO).map((e) => e.start)).toEqual([
      Date.UTC(2026, 9, 19, 7), Date.UTC(2026, 9, 26, 8),
    ])
  })

  it('a UTC series stays at the same UTC time', () => {
    process.env.TZ = 'America/Toronto'
    const [ev] = parseIcs('BEGIN:VEVENT\nUID:u\nDTSTART:20261026T130000Z\nRRULE:FREQ=WEEKLY;COUNT=2\nDURATION:PT1H\nEND:VEVENT')
    expect(expandRecurrence(ev, FROM, TO).map((e) => e.start)).toEqual([
      Date.UTC(2026, 9, 26, 13), Date.UTC(2026, 10, 2, 13),
    ])
  })

  it('EXDATE and RECURRENCE-ID in a TZID match the occurrences they name', () => {
    const events = parseIcs([
      'BEGIN:VEVENT', 'UID:v', 'DTSTART;TZID=Asia/Tokyo:20261005T090000', 'DTEND;TZID=Asia/Tokyo:20261005T100000',
      'RRULE:FREQ=WEEKLY;COUNT=3', 'EXDATE;TZID=Asia/Tokyo:20261012T090000', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:v', 'RECURRENCE-ID;TZID=Asia/Tokyo:20261019T090000',
      'DTSTART;TZID=Asia/Tokyo:20261019T150000', 'DTEND;TZID=Asia/Tokyo:20261019T160000', 'END:VEVENT',
    ].join('\n'))
    expect(eventsInRange(events, FROM, TO).map((e) => e.start)).toEqual([
      Date.UTC(2026, 9, 5, 0), Date.UTC(2026, 9, 19, 6),
    ])
  })

  it('an unknown TZID falls back to the host zone rather than failing', () => {
    const [ev] = parseIcs('BEGIN:VEVENT\nUID:w\nDTSTART;TZID=W. Europe Standard Time:20261019T090000\nEND:VEVENT')
    expect(ev.start).toBe(at(2026, 10, 19, 9))
  })

  it('an all-day series covers exactly one day on either side of a DST change', () => {
    process.env.TZ = 'America/Toronto'
    // Spring forward is Sunday 8 March 2026 — a 23-hour day.
    const [first] = parseIcs('BEGIN:VEVENT\nUID:a\nDTSTART;VALUE=DATE:20261031\nDTEND;VALUE=DATE:20261101\nRRULE:FREQ=WEEKLY;COUNT=1\nEND:VEVENT')
    expect(first.end).toBe(at(2026, 11, 1))
    const weekly = series('FREQ=WEEKLY;COUNT=3', at(2026, 3, 1), { allDay: true, end: at(2026, 3, 2) })
    for (const e of expandRecurrence(weekly, at(2026, 3, 1), at(2026, 4, 1))) {
      const next = new Date(e.start); next.setDate(next.getDate() + 1)
      expect(e.end).toBe(next.getTime())
    }
  })

  it('writes an all-day date as the LOCAL day, east of UTC too', () => {
    process.env.TZ = 'Europe/Vienna'
    expect(dayStamp(at(2026, 8, 20))).toBe('20260820')
    process.env.TZ = 'Pacific/Auckland'
    expect(dayStamp(at(2026, 8, 20))).toBe('20260820')
  })

  it('reads DURATION when there is no DTEND', () => {
    const [ev] = parseIcs('BEGIN:VEVENT\nUID:d\nDTSTART:20261026T130000Z\nDURATION:P1DT2H30M\nEND:VEVENT')
    expect(ev.end - ev.start).toBe((26 * 60 + 30) * 60_000)
  })
})

describe('parseRecurrenceInput — strict, because it arrives over IPC', () => {
  const START = at(2026, 8, 5, 9) // a Wednesday

  it('accepts the four shapes the form can make', () => {
    expect(parseRecurrenceInput({ freq: 'DAILY', interval: 1 }, START)).toEqual({ freq: 'DAILY', interval: 1 })
    expect(parseRecurrenceInput({ freq: 'WEEKLY', interval: 2, byWeekday: [5, 3] }, START))
      .toEqual({ freq: 'WEEKLY', interval: 2, byWeekday: [3, 5] })
    expect(parseRecurrenceInput({ freq: 'MONTHLY', interval: 1, count: 6 }, START).count).toBe(6)
    expect(parseRecurrenceInput({ freq: 'YEARLY', interval: 1, until: '2030-08-05' }, START).until).toBe('2030-08-05')
  })

  it.each([
    ['a raw rule string', 'FREQ=DAILY'],
    ['null', null],
    ['an array', []],
    ['an unknown frequency', { freq: 'HOURLY', interval: 1 }],
    ['a lower-case frequency', { freq: 'daily', interval: 1 }],
    ['no interval', { freq: 'DAILY' }],
    ['a zero interval', { freq: 'DAILY', interval: 0 }],
    ['a fractional interval', { freq: 'DAILY', interval: 1.5 }],
    ['a text interval', { freq: 'DAILY', interval: '2' }],
    ['a huge interval', { freq: 'DAILY', interval: 1000 }],
    ['an unknown field', { freq: 'DAILY', interval: 1, rrule: 'x' }],
    ['both endings', { freq: 'DAILY', interval: 1, count: 2, until: '2026-09-01' }],
    ['a zero count', { freq: 'DAILY', interval: 1, count: 0 }],
    ['a huge count', { freq: 'DAILY', interval: 1, count: 1001 }],
    ['an injected until', { freq: 'DAILY', interval: 1, until: '2026-09-01\r\nATTENDEE:x' }],
    ['an impossible date', { freq: 'DAILY', interval: 1, until: '2026-02-30' }],
    ['an until before the start', { freq: 'DAILY', interval: 1, until: '2026-08-04' }],
    ['weekdays on a monthly rule', { freq: 'MONTHLY', interval: 1, byWeekday: [3] }],
    ['an empty weekday list', { freq: 'WEEKLY', interval: 1, byWeekday: [] }],
    ['an out-of-range weekday', { freq: 'WEEKLY', interval: 1, byWeekday: [3, 7] }],
    ['a repeated weekday', { freq: 'WEEKLY', interval: 1, byWeekday: [3, 3] }],
    ['weekdays that omit the start day', { freq: 'WEEKLY', interval: 1, byWeekday: [1] }],
  ])('rejects %s', (_label, input) => {
    expect(() => parseRecurrenceInput(input, START)).toThrow()
  })

  it('rejects a start that is not a real instant', () => {
    expect(() => parseRecurrenceInput({ freq: 'DAILY', interval: 1 }, 1e20)).toThrow()
  })
})

describe('toRrule', () => {
  it('writes frequency, interval, weekdays and a count', () => {
    expect(toRrule({ freq: 'DAILY', interval: 1 }, false)).toBe('FREQ=DAILY')
    expect(toRrule({ freq: 'WEEKLY', interval: 2, byWeekday: [1, 3], count: 4 }, false))
      .toBe('FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=MO,WE')
  })

  it('writes UNTIL as a UTC instant at the end of that local day for timed events', () => {
    process.env.TZ = 'America/Toronto'
    expect(toRrule({ freq: 'DAILY', interval: 1, until: '2026-12-01' }, false))
      .toBe('FREQ=DAILY;UNTIL=20261202T045959Z')
  })

  it('writes UNTIL as a DATE for all-day events, matching DTSTART', () => {
    expect(toRrule({ freq: 'MONTHLY', interval: 1, until: '2026-12-01' }, true))
      .toBe('FREQ=MONTHLY;UNTIL=20261201')
  })
})

describe('writing a series', () => {
  it('writes DTSTART in the zone with a VTIMEZONE, so 09:00 stays 09:00', () => {
    const ics = buildEventIcs({
      uid: 's', summary: 'S', timeZone: 'Europe/Vienna', rrule: 'FREQ=WEEKLY;COUNT=2',
      start: Date.UTC(2026, 9, 19, 7), end: Date.UTC(2026, 9, 19, 8),
    })
    expect(ics).toContain('DTSTART;TZID=Europe/Vienna:20261019T090000')
    expect(ics).toContain('DTEND;TZID=Europe/Vienna:20261019T100000')
    expect(ics).toContain('RRULE:FREQ=WEEKLY;COUNT=2')
    expect(ics).toContain('BEGIN:VTIMEZONE\r\nTZID:Europe/Vienna')
    // The 2026 autumn transition: 03:00 summer time falls back to winter time.
    expect(ics).toContain('BEGIN:STANDARD\r\nDTSTART:20261025T030000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0100')
    expect(ics.indexOf('END:VTIMEZONE')).toBeLessThan(ics.indexOf('BEGIN:VEVENT'))
    expect(expandRecurrence(parseIcs(ics)[0], Date.UTC(2026, 9, 1), Date.UTC(2026, 10, 15)).map((e) => e.start))
      .toEqual([Date.UTC(2026, 9, 19, 7), Date.UTC(2026, 9, 26, 8)])
  })

  it('writes plain UTC when there is no zone to name', () => {
    const ics = buildEventIcs({ uid: 's', summary: 'S', timeZone: 'UTC', start: Date.UTC(2026, 9, 19, 7), end: Date.UTC(2026, 9, 19, 8) })
    expect(ics).toContain('DTSTART:20261019T070000Z')
    expect(ics).not.toContain('VTIMEZONE')
  })
})
