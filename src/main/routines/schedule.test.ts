import { describe, it, expect } from 'vitest'
import { parseSchedule, formatSchedule, describeSchedule, nextRun } from './schedule'

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()

describe('schedule grammar', () => {
  it('parses the four shapes and rejects the rest', () => {
    expect(parseSchedule('daily@07:00')).toEqual({ kind: 'daily', hour: 7, minute: 0 })
    expect(parseSchedule('Weekdays@7:30')).toEqual({ kind: 'weekdays', hour: 7, minute: 30 })
    expect(parseSchedule('weekly@mon 09:00')).toEqual({ kind: 'weekly', dow: 1, hour: 9, minute: 0 })
    expect(parseSchedule('every:6h')).toEqual({ kind: 'every', hours: 6 })
    for (const bad of ['daily@25:00', 'daily@07:60', 'weekly@xyz 09:00', 'every:0h', 'every:200h', '0 7 * * *', '', 42, null]) {
      expect(parseSchedule(bad)).toBeNull()
    }
  })

  it('formats back to the canonical string and describes in words', () => {
    for (const s of ['daily@07:00', 'weekdays@07:30', 'weekly@mon 09:00', 'every:6h']) {
      expect(formatSchedule(parseSchedule(s)!)).toBe(s)
    }
    expect(describeSchedule(parseSchedule('daily@07:00')!)).toBe('every day at 07:00')
    expect(describeSchedule(parseSchedule('weekdays@07:30')!)).toBe('every weekday at 07:30')
    expect(describeSchedule(parseSchedule('weekly@fri 17:00')!)).toBe('every Friday at 17:00')
    expect(describeSchedule(parseSchedule('every:1h')!)).toBe('every hour')
    expect(describeSchedule(parseSchedule('every:6h')!)).toBe('every 6 hours')
    expect(describeSchedule(parseSchedule('every:48h')!)).toBe('every 2 days')
  })
})

describe('nextRun', () => {
  it('daily: later today if the time is still ahead, else tomorrow; never "now"', () => {
    const s = parseSchedule('daily@07:00')!
    expect(nextRun(s, local(2026, 9, 3, 6, 59))).toBe(local(2026, 9, 3, 7, 0))
    expect(nextRun(s, local(2026, 9, 3, 7, 0))).toBe(local(2026, 9, 4, 7, 0))
    expect(nextRun(s, local(2026, 9, 3, 12, 0))).toBe(local(2026, 9, 4, 7, 0))
  })

  it('weekdays: skips the weekend', () => {
    const s = parseSchedule('weekdays@07:00')!
    // 2026-09-04 is a Friday.
    expect(nextRun(s, local(2026, 9, 4, 8, 0))).toBe(local(2026, 9, 7, 7, 0))
    expect(nextRun(s, local(2026, 9, 5, 8, 0))).toBe(local(2026, 9, 7, 7, 0))
  })

  it('weekly: the named day, a week out when today is that day and the time has passed', () => {
    const s = parseSchedule('weekly@fri 17:00')!
    expect(nextRun(s, local(2026, 9, 3, 12, 0))).toBe(local(2026, 9, 4, 17, 0))
    expect(nextRun(s, local(2026, 9, 4, 17, 0))).toBe(local(2026, 9, 11, 17, 0))
  })

  it('every: counted from the last run, and due-in-the-past stays in the past (fire once)', () => {
    const s = parseSchedule('every:6h')!
    const nine = local(2026, 9, 3, 9, 0)
    expect(nextRun(s, local(2026, 9, 3, 10, 0), nine)).toBe(local(2026, 9, 3, 15, 0))
    expect(nextRun(s, local(2026, 9, 3, 20, 0), nine)).toBe(local(2026, 9, 3, 15, 0))
    expect(nextRun(s, nine, null)).toBe(local(2026, 9, 3, 15, 0))
  })

  it('daily across a DST change keeps the wall-clock time', () => {
    const s = parseSchedule('daily@07:00')!
    // Europe: 2026-10-25 is the autumn change. Whatever the zone, 07:00 stays 07:00 local.
    const next = nextRun(s, local(2026, 10, 24, 12, 0))
    const d = new Date(next)
    expect([d.getHours(), d.getMinutes()]).toEqual([7, 0])
    expect(d.getDate()).toBe(25)
  })
})
