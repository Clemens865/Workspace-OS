import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  rewriteEventIcs, rewriteSeriesIcs, rewriteOccurrenceIcs, addExdateIcs, occurrenceStamp,
} from './ics-write'
import { writeToCalDav } from './calendar-service'
import { parseIcs, eventsInRange } from './ics'
import type { CalendarSourceStore } from './account-store'

/**
 * "Surgical" has to mean it: an edit replaces what the person changed and
 * nothing else — not an alarm's text, not the zone a meeting was written in,
 * and never an occurrence somebody deleted coming back.
 */

// Deleting TZ does not switch Node back, so restore the zone by name.
const originalTz = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone
afterEach(() => {
  process.env.TZ = originalTz
  vi.unstubAllGlobals()
})

const unfolded = (s: string): string => s.replace(/\r\n[ \t]/g, '')
const doc = (...lines: string[]): string => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n')

const SINGLE = doc(
  'BEGIN:VEVENT', 'UID:one@x',
  'DTSTART;TZID=Europe/Vienna:20260825T140000', 'DTEND;TZID=Europe/Vienna:20260825T150000',
  'SUMMARY;LANGUAGE=de:Besprechung', 'LOCATION;ALTREP="http://x.example/room":Room 1',
  'BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:EMAIL', 'SUMMARY:Alarm subject', 'DESCRIPTION:Reminder',
  'DURATION:PT5M', 'REPEAT:2', 'END:VALARM',
  'END:VEVENT',
)
const SINGLE_START = Date.UTC(2026, 7, 25, 12)
const SAME = { summary: 'Besprechung', start: SINGLE_START, end: SINGLE_START + 3_600_000, allDay: false, location: 'Room 1' }

describe('rewriteEventIcs — nothing unchanged is touched', () => {
  it('keeps every line of an alarm, including its own text', () => {
    const out = rewriteEventIcs(SINGLE, { ...SAME, summary: 'New' })
    for (const line of ['SUMMARY:Alarm subject', 'DESCRIPTION:Reminder', 'DURATION:PT5M', 'REPEAT:2']) {
      expect(out).toContain(line)
    }
    // The alarm stays inside the event, after the event's own properties.
    expect(out.indexOf('BEGIN:VALARM')).toBeGreaterThan(out.indexOf('SUMMARY:New'))
  })

  it('keeps the time zone when the time did not change', () => {
    const out = rewriteEventIcs(SINGLE, { ...SAME, summary: 'New' })
    expect(out).toContain('DTSTART;TZID=Europe/Vienna:20260825T140000')
    expect(out).toContain('DTEND;TZID=Europe/Vienna:20260825T150000')
  })

  it('keeps the parameters of text that did not change', () => {
    const out = unfolded(rewriteEventIcs(SINGLE, { ...SAME, start: SINGLE_START + 3_600_000, end: SINGLE_START + 7_200_000 }))
    expect(out).toContain('SUMMARY;LANGUAGE=de:Besprechung')
    expect(out).toContain('LOCATION;ALTREP="http://x.example/room":Room 1')
    expect(out).toContain('DTSTART:20260825T130000Z')
  })

  it('edits the named event in a document holding several', () => {
    const two = SINGLE.replace('END:VCALENDAR', [
      'BEGIN:VEVENT', 'UID:two@x', 'DTSTART:20260901T090000Z', 'DTEND:20260901T100000Z', 'SUMMARY:Second', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'))
    const out = parseIcs(rewriteEventIcs(two, {
      summary: 'Second, renamed', start: Date.UTC(2026, 8, 1, 9), end: Date.UTC(2026, 8, 1, 10), allDay: false,
    }, 'two@x'))
    expect(out.map((e) => e.summary)).toEqual(['Besprechung', 'Second, renamed'])
  })

  it('says so when the named event is not there', () => {
    expect(() => rewriteEventIcs(SINGLE, SAME, 'nope@x')).toThrow(/calendar event/i)
  })
})

/** Mondays 13:00Z, with one occurrence deleted and one moved. */
const UTC_SERIES = doc(
  'BEGIN:VEVENT', 'UID:s@x', 'DTSTART:20260803T130000Z', 'DURATION:PT30M', 'RRULE:FREQ=WEEKLY;COUNT=4',
  'EXDATE:20260810T130000Z', 'SUMMARY:Standup', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:s@x', 'RECURRENCE-ID:20260817T130000Z', 'DTSTART:20260817T180000Z',
  'DTEND:20260817T183000Z', 'SUMMARY:Standup (late)', 'END:VEVENT',
)

describe('rewriteSeriesIcs', () => {
  it('a rename leaves a UTC series on its own days, with its DURATION', () => {
    process.env.TZ = 'America/Toronto'
    const out = rewriteSeriesIcs(UTC_SERIES, { summary: 'Daily sync', time: { hour: 9, minute: 0, durationMs: 1_800_000 } })
    expect(out).toContain('DTSTART:20260803T130000Z')
    expect(out).toContain('DURATION:PT30M')
    expect(out).toContain('EXDATE:20260810T130000Z')
    expect(out).toContain('RECURRENCE-ID:20260817T130000Z')
  })

  it('a new time takes deleted and moved occurrences with it', () => {
    process.env.TZ = 'America/Toronto'
    const out = rewriteSeriesIcs(UTC_SERIES, { summary: 'Standup', time: { hour: 10, minute: 0, durationMs: 1_800_000 } })
    expect(out).toContain('DTSTART:20260803T140000Z')
    expect(out).not.toContain('DURATION:')
    expect(out).toContain('EXDATE:20260810T140000Z')
    expect(out).toContain('RECURRENCE-ID:20260817T140000Z')
    // The moved copy keeps the time it was moved to.
    expect(out).toContain('DTSTART:20260817T180000Z')
    const shown = eventsInRange(parseIcs(out), Date.UTC(2026, 7, 1), Date.UTC(2026, 8, 1))
    expect(shown.map((e) => e.start)).toEqual([
      Date.UTC(2026, 7, 3, 14), Date.UTC(2026, 7, 17, 18), Date.UTC(2026, 7, 24, 14),
    ])
  })
})

describe('a series edit made from a moved occurrence', () => {
  it('does not move the series when that occurrence’s own time was left alone', () => {
    process.env.TZ = 'America/Toronto'
    // The 17th was moved to 14:00 local; the form shows that, and only the title changes.
    const out = rewriteSeriesIcs(UTC_SERIES, {
      summary: 'Daily sync',
      time: { hour: 14, minute: 0, durationMs: 1_800_000 },
      shownAt: Date.UTC(2026, 7, 17, 13),
    })
    expect(out).toContain('DTSTART:20260803T130000Z')
    expect(out).toContain('EXDATE:20260810T130000Z')
  })
})

describe('occurrence surgery', () => {
  it('a new override carries the master alarm whole', () => {
    const series = SINGLE.replace('SUMMARY;LANGUAGE=de:Besprechung', 'SUMMARY:S\r\nRRULE:FREQ=WEEKLY')
    const occ = SINGLE_START + 7 * 86_400_000
    const out = rewriteOccurrenceIcs(series, occ, { summary: 'Once', start: occ, end: occ + 1000, allDay: false })
    const override = out.slice(out.indexOf('RECURRENCE-ID'))
    expect(override).toContain('DURATION:PT5M')
    expect(override).toContain('DESCRIPTION:Reminder')
    expect(override).not.toContain('RRULE')
  })

  it('names an occurrence of a floating series in floating form', () => {
    expect(occurrenceStamp(['DTSTART:20260803T090000'], new Date(2026, 7, 10, 9).getTime()))
      .toBe(':20260810T090000')
  })

  it('does not throw on a TZID it has no rules for', () => {
    const body = ['DTSTART;TZID=W. Europe Standard Time:20260803T090000']
    expect(occurrenceStamp(body, new Date(2026, 7, 10, 9).getTime()))
      .toBe(';TZID=W. Europe Standard Time:20260810T090000')
  })

  it('excludes an occurrence from the NAMED series only', () => {
    const two = UTC_SERIES.replace('END:VCALENDAR', [
      'BEGIN:VEVENT', 'UID:t@x', 'DTSTART:20260804T130000Z', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Other', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'))
    const out = parseIcs(addExdateIcs(two, Date.UTC(2026, 7, 11, 13), 't@x'))
    expect(out.find((e) => e.uid === 't@x')?.exdates).toEqual([Date.UTC(2026, 7, 11, 13)])
    expect(out.find((e) => e.uid === 's@x' && !e.recurrenceId)?.exdates).toEqual([Date.UTC(2026, 7, 10, 13)])
  })
})

describe('writeToCalDav with a repeat', () => {
  it('puts the rule, in the local zone, on the server', async () => {
    process.env.TZ = 'America/Toronto'
    let put = ''
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      put = String(init?.body)
      return new Response('', { status: 201 })
    }))
    const store = {
      get: async () => ({ id: 'src1', kind: 'caldav', url: 'https://dav.example.com', username: 'u' }),
      getSecret: async () => 'p',
    } as unknown as CalendarSourceStore
    await writeToCalDav(
      store,
      { id: 't', label: 'Home', kind: 'caldav', sourceId: 'src1', calendarUrl: 'https://dav.example.com/home/', canInvite: true },
      {
        summary: 'Weekly', start: new Date(2026, 9, 27, 9).getTime(), end: new Date(2026, 9, 27, 10).getTime(),
        recurrence: { freq: 'WEEKLY', interval: 1, byWeekday: [2], count: 3 },
      },
    )
    expect(put).toContain('RRULE:FREQ=WEEKLY;COUNT=3;BYDAY=TU')
    expect(put).toContain('DTSTART;TZID=America/Toronto:20261027T090000')
    expect(put).toContain('BEGIN:VTIMEZONE')
  })
})
