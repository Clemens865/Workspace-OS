import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  addLocal, readLocal, removeLocal, updateLocal, calendarToIcs, localCalendarPath,
  updateLocalOccurrence, updateLocalSeries, removeLocalOccurrence,
} from './local-calendar'
import { foldLine } from './ics-write'
import { parseIcs, eventsInRange } from './ics'

/**
 * The local calendar is the only writable one, so the thing that matters is
 * that what we WRITE is what we can READ — and that the file is real
 * iCalendar, because the promise is that these events are not trapped here.
 * The round trip goes through the existing parser rather than a bespoke one,
 * which is what makes it a real check.
 */

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-cal-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

const AT = Date.UTC(2026, 7, 20, 9, 0, 0)

describe('local calendar', () => {
  it('writes an event the parser reads back', () => {
    addLocal(root, { summary: 'Interview — ALPLA', start: AT, end: AT + 3600_000 })
    const back = readLocal(root)
    expect(back).toHaveLength(1)
    expect(back[0].summary).toBe('Interview — ALPLA')
    expect(back[0].start).toBe(AT)
  })

  it('produces a file another calendar app could open', () => {
    addLocal(root, { summary: 'X', start: AT, end: AT + 3600_000 })
    const text = fs.readFileSync(localCalendarPath(root), 'utf8')
    expect(text.startsWith('BEGIN:VCALENDAR')).toBe(true)
    expect(text).toContain('VERSION:2.0')
    expect(text.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
    // CRLF is required by RFC 5545; some clients reject bare LF.
    expect(text).toContain('\r\n')
  })

  it('keeps events across appends', () => {
    addLocal(root, { summary: 'One', start: AT, end: AT + 1000 })
    addLocal(root, { summary: 'Two', start: AT + 7200_000, end: AT + 9000_000 })
    expect(readLocal(root).map((e) => e.summary).sort()).toEqual(['One', 'Two'])
  })

  it('gives every event a distinct uid', () => {
    addLocal(root, { summary: 'A', start: AT, end: AT + 1000 })
    addLocal(root, { summary: 'B', start: AT, end: AT + 1000 })
    const [a, b] = readLocal(root)
    expect(a.uid).not.toBe(b.uid)
  })

  it('escapes characters that would otherwise break the format', () => {
    addLocal(root, {
      summary: 'Call; with, Maria\\Schmidt',
      start: AT,
      end: AT + 1000,
      description: 'line one\nline two',
    })
    const back = readLocal(root)
    expect(back[0].summary).toBe('Call; with, Maria\\Schmidt')
    expect(back[0].description).toContain('line one')
  })

  /** A zero-length event is invisible in most clients — quietly useless. */
  it('gives an event with no duration a sensible length', () => {
    addLocal(root, { summary: 'Instant', start: AT, end: AT })
    expect(readLocal(root)[0].end).toBe(AT + 3600_000)
  })

  it('writes an all-day event as a DATE, not a timestamp', () => {
    addLocal(root, { summary: 'Deadline', start: AT, end: AT + 86_400_000, allDay: true })
    const text = fs.readFileSync(localCalendarPath(root), 'utf8')
    expect(text).toContain('DTSTART;VALUE=DATE:2026082')
    expect(readLocal(root)[0].allDay).toBe(true)
  })

  it('removes an event by uid', () => {
    const e = addLocal(root, { summary: 'Gone', start: AT, end: AT + 1000 })
    expect(removeLocal(root, e.uid)).toBe(true)
    expect(readLocal(root)).toHaveLength(0)
  })

  it('reports when there was nothing to remove', () => {
    expect(removeLocal(root, 'nope')).toBe(false)
  })

  it('reads an empty calendar rather than throwing', () => {
    expect(readLocal(root)).toEqual([])
  })

  it('survives a corrupt file instead of taking the calendar down', () => {
    fs.mkdirSync(path.dirname(localCalendarPath(root)), { recursive: true })
    fs.writeFileSync(localCalendarPath(root), 'this is not iCalendar')
    expect(readLocal(root)).toEqual([])
  })
})

describe('line folding', () => {
  /**
   * A long line emitted unfolded is what makes an otherwise valid file fail to
   * import into Apple Calendar — and it fails SILENTLY: the event just does not
   * appear.
   */
  it('folds a long line and the parser unfolds it back', () => {
    const long = 'x'.repeat(300)
    const ics = calendarToIcs([
      { uid: 'u', summary: long, start: AT, end: AT + 1000, allDay: false },
    ])
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(76)
    expect(parseIcs(ics)[0].summary).toBe(long)
  })

  it('leaves a short line alone', () => {
    expect(foldLine('SUMMARY:hello')).toBe('SUMMARY:hello')
  })
})

describe('updateLocal', () => {
  it('replaces the editable fields and keeps the uid', () => {
    const ev = addLocal(root, { summary: 'Before', start: AT, end: AT + 3600_000, location: 'Old' })
    const updated = updateLocal(root, ev.uid, { summary: 'After', start: AT + 86_400_000, end: AT + 90_000_000 })
    expect(updated?.uid).toBe(ev.uid)
    const back = readLocal(root)
    expect(back).toHaveLength(1)
    expect(back[0].summary).toBe('After')
    expect(back[0].start).toBe(AT + 86_400_000)
    expect(back[0].location).toBeUndefined()
  })

  it('says no for an event that is not there instead of appending one', () => {
    addLocal(root, { summary: 'X', start: AT, end: AT + 1000 })
    expect(updateLocal(root, 'nope@nowhere', { summary: 'Y', start: AT, end: AT + 1000 })).toBeNull()
    expect(readLocal(root)).toHaveLength(1)
  })

  it('leaves the other events untouched', () => {
    const a = addLocal(root, { summary: 'A', start: AT, end: AT + 1000 })
    addLocal(root, { summary: 'B', start: AT + 7200_000, end: AT + 9000_000 })
    updateLocal(root, a.uid, { summary: 'A2', start: AT, end: AT + 1000 })
    expect(readLocal(root).map((e) => e.summary).sort()).toEqual(['A2', 'B'])
  })
})

describe('repeating events in the local file', () => {
  const START = new Date(2026, 7, 5, 9).getTime() // Wednesday
  const END = START + 3600_000
  const weekly = { freq: 'WEEKLY' as const, interval: 1, byWeekday: [3], count: 4 }
  const august = (): number[] =>
    eventsInRange(readLocal(root), new Date(2026, 7, 1).getTime(), new Date(2026, 8, 15).getTime()).map((e) => e.start)
  const week = (n: number, h = 9): number => new Date(2026, 7, 5 + 7 * n, h).getTime()
  const text = (): string => fs.readFileSync(localCalendarPath(root), 'utf8')

  it('saves the rule and reads it back as occurrences', () => {
    addLocal(root, { summary: 'Weekly', start: START, end: END, recurrence: weekly })
    expect(readLocal(root)[0].rrule).toBe('FREQ=WEEKLY;COUNT=4;BYDAY=WE')
    expect(august()).toEqual([week(0), week(1), week(2), week(3)])
  })

  /** The bug: every save rebuilt the file from a draft that had no rrule field. */
  it('keeps the rule when OTHER events are added, edited and removed', () => {
    addLocal(root, { summary: 'Weekly', start: START, end: END, recurrence: weekly })
    const other = addLocal(root, { summary: 'Other', start: START, end: END })
    updateLocal(root, other.uid, { summary: 'Other 2', start: START, end: END })
    expect(readLocal(root)[0].rrule).toBe('FREQ=WEEKLY;COUNT=4;BYDAY=WE')
    removeLocal(root, other.uid)
    expect(readLocal(root)[0].rrule).toBe('FREQ=WEEKLY;COUNT=4;BYDAY=WE')
  })

  it('calendarToIcs carries the rule and its exclusions', () => {
    const ics = calendarToIcs([
      { uid: 'u', summary: 'S', start: AT, end: AT + 1000, allDay: false, rrule: 'FREQ=DAILY', exdates: [AT + 86_400_000] },
    ])
    expect(parseIcs(ics)[0]).toMatchObject({ rrule: 'FREQ=DAILY', exdates: [AT + 86_400_000] })
  })

  it('deletes one occurrence and keeps the series', () => {
    const ev = addLocal(root, { summary: 'Weekly', start: START, end: END, recurrence: weekly })
    expect(removeLocalOccurrence(root, ev.uid, week(1))).toBe(true)
    expect(august()).toEqual([week(0), week(2), week(3)])
  })

  it('moves one occurrence and leaves the rest', () => {
    const ev = addLocal(root, { summary: 'Weekly', start: START, end: END, recurrence: weekly })
    updateLocalOccurrence(root, ev.uid, week(1), { summary: 'Later', start: week(1, 15), end: week(1, 16) })
    expect(august()).toEqual([week(0), week(1, 15), week(2), week(3)])
  })

  it('edits the whole series without resurrecting a deleted occurrence', () => {
    const ev = addLocal(root, { summary: 'Weekly', start: START, end: END, recurrence: weekly })
    removeLocalOccurrence(root, ev.uid, week(1))
    updateLocalSeries(root, ev.uid, { summary: 'Renamed', time: { hour: 11, minute: 0, durationMs: 3600_000 } })
    expect(readLocal(root)[0].summary).toBe('Renamed')
    expect(august()).toEqual([week(0, 11), week(2, 11), week(3, 11)])
  })

  it('removes the series together with its overrides', () => {
    const ev = addLocal(root, { summary: 'Weekly', start: START, end: END, recurrence: weekly })
    updateLocalOccurrence(root, ev.uid, week(1), { summary: 'Later', start: week(1, 15), end: week(1, 16) })
    expect(removeLocal(root, ev.uid)).toBe(true)
    expect(readLocal(root)).toEqual([])
    expect(text()).not.toContain('BEGIN:VEVENT')
  })

  it('refuses a single-event edit of a series instead of flattening it', () => {
    const ev = addLocal(root, { summary: 'Weekly', start: START, end: END, recurrence: weekly })
    expect(() => updateLocal(root, ev.uid, { summary: 'X', start: START, end: END })).toThrow(/repeats/i)
    expect(readLocal(root)[0].rrule).toBeDefined()
  })

  it('refuses occurrence changes on an event that does not repeat', () => {
    const ev = addLocal(root, { summary: 'Once', start: START, end: END })
    expect(removeLocalOccurrence(root, ev.uid, START)).toBe(false)
    expect(readLocal(root)).toHaveLength(1)
  })
})

describe('saving never drops what it did not change', () => {
  const FOREIGN = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Mine',
    'BEGIN:VEVENT', 'UID:kept@x', 'DTSTART:20260820T090000Z', 'DTEND:20260820T100000Z', 'SUMMARY:Kept',
    'ATTENDEE;PARTSTAT=ACCEPTED:mailto:anna@example.com', 'CATEGORIES:WORK',
    'BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n')

  beforeEach(() => {
    fs.mkdirSync(path.dirname(localCalendarPath(root)), { recursive: true })
    fs.writeFileSync(localCalendarPath(root), FOREIGN)
  })

  it('keeps attendees, alarms and unknown properties through add, edit and remove', () => {
    const added = addLocal(root, { summary: 'New', start: AT, end: AT + 1000 })
    updateLocal(root, 'kept@x', { summary: 'Kept, renamed', start: AT, end: AT + 3600_000 })
    removeLocal(root, added.uid)
    const out = fs.readFileSync(localCalendarPath(root), 'utf8')
    for (const line of ['X-WR-CALNAME:Mine', 'mailto:anna@example.com', 'CATEGORIES:WORK', 'TRIGGER:-PT15M', 'DESCRIPTION:Reminder']) {
      expect(out).toContain(line)
    }
    expect(readLocal(root).map((e) => e.summary)).toEqual(['Kept, renamed'])
  })

  it('leaves a file it cannot read as a calendar untouched', () => {
    fs.writeFileSync(localCalendarPath(root), 'this is not iCalendar')
    expect(() => addLocal(root, { summary: 'X', start: AT, end: AT + 1000 })).toThrow(/left untouched/i)
    expect(fs.readFileSync(localCalendarPath(root), 'utf8')).toBe('this is not iCalendar')
  })
})
