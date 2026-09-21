import { describe, it, expect } from 'vitest'
import type { CalendarEvent } from '../../types/workspace-api'
import {
  startOfDay, startOfWeek, addDays, weekDays, overlapsDay, groupByDay,
  formatEventTime, isToday, minutesIntoDay,
  parseAttendees, buildEventInput, defaultDraft, draftFromEvent, eventAbility, shiftEventToDay, LOCAL_SOURCE, type EventDraft,
  addMonths, monthGrid, layoutDayEvents, timeAtOffset, moveEventToTime, occurrenceOf,
} from './calendarModel'

const at = (y: number, mo: number, d: number, h = 0, mi = 0): number =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

const ev = (o: Partial<{ start: number; end: number; allDay: boolean; summary: string }>) => ({
  uid: 'u', summary: o.summary ?? 'E', sourceId: 's',
  start: o.start ?? at(2026, 7, 29, 9), end: o.end ?? at(2026, 7, 29, 10),
  allDay: o.allDay ?? false,
})

describe('startOfWeek', () => {
  it('starts on Monday by default', () => {
    // 2026-07-29 is a Wednesday → Monday the 27th.
    expect(startOfWeek(at(2026, 7, 29, 15))).toBe(at(2026, 7, 27))
  })

  it('treats Sunday as the END of the Monday week, not the start', () => {
    // The classic off-by-one: Sunday 2026-08-02 belongs to the week of Jul 27.
    expect(startOfWeek(at(2026, 8, 2, 12))).toBe(at(2026, 7, 27))
  })

  it('supports a Sunday-first week', () => {
    expect(startOfWeek(at(2026, 7, 29), 0)).toBe(at(2026, 7, 26))
  })

  it('is idempotent on a day already at the boundary', () => {
    const mon = at(2026, 7, 27)
    expect(startOfWeek(mon)).toBe(mon)
  })
})

describe('addDays / weekDays', () => {
  it('steps by calendar days, so a DST change cannot shift the time', () => {
    // Across the EU spring-forward (2026-03-29): +1 day must stay local midnight,
    // which a naive `+ 86400000` would turn into 01:00.
    const before = at(2026, 3, 28)
    const after = addDays(before, 1)
    expect(new Date(after).getHours()).toBe(0)
    expect(new Date(after).getDate()).toBe(29)
  })

  it('gives seven consecutive local midnights', () => {
    const days = weekDays(at(2026, 7, 29))
    expect(days).toHaveLength(7)
    expect(days[0]).toBe(at(2026, 7, 27))
    expect(days[6]).toBe(at(2026, 8, 2))
    for (const d of days) expect(new Date(d).getHours()).toBe(0)
  })

  it('crosses a month boundary correctly', () => {
    expect(weekDays(at(2026, 8, 1)).map((d) => new Date(d).getDate())).toEqual([27, 28, 29, 30, 31, 1, 2])
  })
})

describe('overlapsDay', () => {
  const day = at(2026, 7, 29)

  it('includes an event inside the day', () => {
    expect(overlapsDay(ev({}), day)).toBe(true)
  })

  it('EXCLUDES an event that ends exactly at midnight', () => {
    // DTEND is exclusive; without this every evening meeting bleeds into tomorrow.
    expect(overlapsDay(ev({ start: at(2026, 7, 28, 22), end: at(2026, 7, 29) }), day)).toBe(false)
  })

  it('includes an event that starts exactly at midnight', () => {
    expect(overlapsDay(ev({ start: day, end: at(2026, 7, 29, 1) }), day)).toBe(true)
  })

  it('includes a multi-day event on a middle day', () => {
    expect(overlapsDay(ev({ start: at(2026, 7, 28), end: at(2026, 7, 31) }), day)).toBe(true)
  })

  it('excludes events entirely before or after', () => {
    expect(overlapsDay(ev({ start: at(2026, 7, 27, 9), end: at(2026, 7, 27, 10) }), day)).toBe(false)
    expect(overlapsDay(ev({ start: at(2026, 7, 30, 9), end: at(2026, 7, 30, 10) }), day)).toBe(false)
  })
})

describe('groupByDay', () => {
  it('repeats a multi-day event on every day it covers', () => {
    const trip = ev({ start: at(2026, 8, 3), end: at(2026, 8, 6), allDay: true, summary: 'Offsite' })
    const groups = groupByDay([trip], [at(2026, 8, 3), at(2026, 8, 4), at(2026, 8, 5), at(2026, 8, 6)])
    expect(groups.map((g) => g.events.length)).toEqual([1, 1, 1, 0]) // end exclusive
  })

  it('puts all-day events first, then sorts by start time', () => {
    const events = [
      ev({ start: at(2026, 7, 29, 14), summary: 'Afternoon' }),
      ev({ start: at(2026, 7, 29), end: at(2026, 7, 30), allDay: true, summary: 'Holiday' }),
      ev({ start: at(2026, 7, 29, 9), summary: 'Morning' }),
    ]
    const [{ events: day }] = groupByDay(events, [at(2026, 7, 29)])
    expect(day.map((e) => e.summary)).toEqual(['Holiday', 'Morning', 'Afternoon'])
  })

  it('returns a slot for every requested day, even empty ones', () => {
    const groups = groupByDay([], weekDays(at(2026, 7, 29)))
    expect(groups).toHaveLength(7)
    expect(groups.every((g) => g.events.length === 0)).toBe(true)
  })
})

describe('formatEventTime', () => {
  it('labels an all-day event rather than showing 00:00', () => {
    expect(formatEventTime({ start: at(2026, 7, 29), end: at(2026, 7, 30), allDay: true })).toBe('All day')
  })

  it('shows a single time for a zero-length event', () => {
    const t = at(2026, 7, 29, 9, 30)
    expect(formatEventTime({ start: t, end: t, allDay: false })).not.toContain('–')
  })

  it('shows a range for a normal event', () => {
    expect(formatEventTime({ start: at(2026, 7, 29, 9), end: at(2026, 7, 29, 10), allDay: false })).toContain('–')
  })
})

describe('isToday / minutesIntoDay', () => {
  it('compares by local day, not by instant', () => {
    const now = at(2026, 7, 29, 23, 59)
    expect(isToday(at(2026, 7, 29), now)).toBe(true)
    expect(isToday(at(2026, 7, 30), now)).toBe(false)
  })

  it('measures minutes from local midnight', () => {
    expect(minutesIntoDay(at(2026, 7, 29, 9, 30))).toBe(570)
    expect(minutesIntoDay(startOfDay(at(2026, 7, 29, 13)))).toBe(0)
  })
})

describe('parseAttendees', () => {
  it('splits on commas, semicolons and whitespace', () => {
    const r = parseAttendees('a@x.com, b@y.org; c@z.net d@w.io')
    expect(r.emails.map((e) => e.email)).toEqual(['a@x.com', 'b@y.org', 'c@z.net', 'd@w.io'])
    expect(r.invalid).toEqual([])
  })

  it('returns invalid entries rather than dropping them — a silently unsent invitation is the failure', () => {
    const r = parseAttendees('anna@x.com, Anna Weber, ben@')
    expect(r.emails.map((e) => e.email)).toEqual(['anna@x.com'])
    expect(r.invalid).toEqual(['Anna', 'Weber', 'ben@'])
  })

  it('treats an empty field as nobody, not an error', () => {
    expect(parseAttendees('')).toEqual({ emails: [], invalid: [] })
    expect(parseAttendees('  ')).toEqual({ emails: [], invalid: [] })
  })
})

describe('buildEventInput', () => {
  const draft = (o: Partial<EventDraft> = {}): EventDraft => ({
    title: 'Standup', date: '2026-07-29', startTime: '09:00', endTime: '09:30',
    allDay: false, location: '', description: '', attendees: '', ...o,
  })

  it('builds a timed event in local time', () => {
    const r = buildEventInput(draft())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.input.start).toBe(at(2026, 7, 29, 9))
      expect(r.input.end).toBe(at(2026, 7, 29, 9, 30))
      expect(r.input.allDay).toBe(false)
    }
  })

  it('an all-day event spans [midnight, next midnight) — end stays exclusive', () => {
    const r = buildEventInput(draft({ allDay: true }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.input.start).toBe(at(2026, 7, 29))
      expect(r.input.end).toBe(at(2026, 7, 30))
    }
  })

  it('refuses a missing title, a malformed date, and an event ending before it starts', () => {
    expect(buildEventInput(draft({ title: '  ' })).ok).toBe(false)
    expect(buildEventInput(draft({ date: 'tomorrow' })).ok).toBe(false)
    expect(buildEventInput(draft({ endTime: '08:00' })).ok).toBe(false)
  })

  it('refuses an invalid attendee by name instead of quietly not inviting them', () => {
    const r = buildEventInput(draft({ attendees: 'anna@x.com, not-an-email' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('not-an-email')
  })

  it('omits empty location/description rather than sending empty strings', () => {
    const r = buildEventInput(draft({ location: ' ', description: '' }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect('location' in r.input).toBe(false)
      expect('description' in r.input).toBe(false)
    }
  })
})

describe('defaultDraft', () => {
  it("uses today when it is in the viewed week", () => {
    const now = at(2026, 7, 29, 15) // Wednesday
    expect(defaultDraft(startOfWeek(now), now).date).toBe('2026-07-29')
  })

  it("uses the viewed week's first day when the person navigated elsewhere", () => {
    const now = at(2026, 7, 29, 15)
    const nextWeek = startOfWeek(at(2026, 8, 5))
    expect(defaultDraft(nextWeek, now).date).toBe('2026-08-03')
  })
})

describe('eventAbility', () => {
  const kindOf = (id: string): string | undefined =>
    ({ icloud: 'caldav', feed: 'ics', goog: 'google' })[id]
  const base = { start: at(2026, 7, 29, 9), end: at(2026, 7, 29, 10), allDay: false }

  it('a caldav event with a server address is fully editable', () => {
    const a = eventAbility({ ...base, sourceId: 'icloud', href: 'https://x/e.ics' }, kindOf)
    expect(a).toEqual({ write: true, editForm: true, recurring: false })
  })

  it('the local calendar is fully editable', () => {
    expect(eventAbility({ ...base, sourceId: LOCAL_SOURCE }, kindOf).write).toBe(true)
  })

  it('a caldav series slice is editable and FLAGGED recurring — the occurrence/series question', () => {
    const inst = eventAbility({ ...base, sourceId: 'icloud', href: 'x', recurringUid: 'm' }, kindOf)
    expect(inst).toEqual({ write: true, editForm: true, recurring: true })
    const override = eventAbility({ ...base, sourceId: 'icloud', href: 'x', recurrenceId: base.start }, kindOf)
    expect(override.recurring).toBe(true)
    expect(override.write).toBe(true)
  })

  it('says WHY when it refuses — feed, read-only account, missing address, local series', () => {
    expect(eventAbility({ ...base, sourceId: 'feed' }, kindOf).reason).toMatch(/subscribed feed/i)
    expect(eventAbility({ ...base, sourceId: 'goog' }, kindOf).reason).toMatch(/read-only/i)
    expect(eventAbility({ ...base, sourceId: 'icloud' }, kindOf).reason).toMatch(/where this event lives/i)
    // A recurring event in a feed stays refused — recurring never overrides source rules.
    expect(eventAbility({ ...base, sourceId: 'feed', rrule: 'FREQ=WEEKLY' }, kindOf).write).toBe(false)
    // The local file has no series machinery.
    expect(eventAbility({ ...base, sourceId: LOCAL_SOURCE, rrule: 'FREQ=WEEKLY' }, kindOf).reason).toMatch(/local calendar/i)
  })

  it('names which occurrence an instance is, wherever it was moved to', () => {
    expect(occurrenceOf({ start: at(2026, 7, 29, 9) })).toBe(at(2026, 7, 29, 9))
    expect(occurrenceOf({ start: at(2026, 7, 29, 14), recurrenceId: at(2026, 7, 29, 9) })).toBe(at(2026, 7, 29, 9))
  })

  it('a multi-day event can move and die but not fit the single-day form', () => {
    const a = eventAbility(
      { start: at(2026, 7, 29, 22), end: at(2026, 7, 30, 2), allDay: false, sourceId: LOCAL_SOURCE },
      kindOf,
    )
    expect(a.write).toBe(true)
    expect(a.editForm).toBe(false)
    expect(a.formReason).toMatch(/several days/i)
  })

  it('ending exactly at midnight still counts as one day', () => {
    const a = eventAbility(
      { start: at(2026, 7, 29, 22), end: at(2026, 7, 30, 0), allDay: false, sourceId: LOCAL_SOURCE },
      kindOf,
    )
    expect(a.editForm).toBe(true)
  })
})

describe('shiftEventToDay', () => {
  it('keeps the time of day and the duration', () => {
    const shifted = shiftEventToDay(
      { start: at(2026, 7, 29, 9, 30), end: at(2026, 7, 29, 10, 15), allDay: false },
      at(2026, 8, 3),
    )
    expect(shifted.start).toBe(at(2026, 8, 3, 9, 30))
    expect(shifted.end).toBe(at(2026, 8, 3, 10, 15))
  })

  it('moves an all-day span whole', () => {
    const shifted = shiftEventToDay(
      { start: at(2026, 7, 27), end: at(2026, 7, 30), allDay: true },
      at(2026, 8, 3),
    )
    expect(shifted.start).toBe(at(2026, 8, 3))
    expect(shifted.end).toBe(at(2026, 8, 6))
  })
})

describe('draftFromEvent', () => {
  it('round-trips through the form builder to the same instants', () => {
    const ev = {
      summary: 'Standup', start: at(2026, 7, 29, 9), end: at(2026, 7, 29, 9, 30),
      allDay: false, location: 'Room 4', description: 'notes',
    }
    const built = buildEventInput(draftFromEvent(ev))
    expect(built.ok).toBe(true)
    if (built.ok) {
      expect(built.input.start).toBe(ev.start)
      expect(built.input.end).toBe(ev.end)
      expect(built.input.summary).toBe('Standup')
      expect(built.input.location).toBe('Room 4')
    }
  })
})

describe('month navigation', () => {
  it('steps by calendar month, clamping the day', () => {
    expect(new Date(addMonths(at(2026, 1, 31), 1)).getMonth()).toBe(1) // Feb, not Mar
    expect(new Date(addMonths(at(2026, 1, 31), 1)).getDate()).toBe(28)
    expect(addMonths(at(2026, 7, 15), -1)).toBe(at(2026, 6, 15))
  })

  it('builds whole Mon-first weeks covering the month', () => {
    const g = monthGrid(at(2026, 8, 20))
    expect(g.month).toBe(7) // August
    // August 2026: Sat 1st → the grid starts Mon 27 Jul and ends Sun 6 Sep.
    expect(g.weeks[0][0]).toBe(at(2026, 7, 27))
    expect(g.weeks.at(-1)![6]).toBe(at(2026, 9, 6))
    for (const w of g.weeks) expect(w).toHaveLength(7)
  })
})

describe('layoutDayEvents', () => {
  const ev = (s: number, e: number, uid = 'u'): CalendarEvent =>
    ({ uid, summary: 'x', start: s, end: e, allDay: false, sourceId: 's' })

  it('gives a lone event the full width', () => {
    const [p] = layoutDayEvents([ev(at(2026, 7, 29, 9), at(2026, 7, 29, 10))])
    expect(p.col).toBe(0)
    expect(p.cols).toBe(1)
  })

  it('splits overlapping events into columns of the same group width', () => {
    const out = layoutDayEvents([
      ev(at(2026, 7, 29, 9), at(2026, 7, 29, 11), 'a'),
      ev(at(2026, 7, 29, 10), at(2026, 7, 29, 12), 'b'),
      ev(at(2026, 7, 29, 14), at(2026, 7, 29, 15), 'c'),
    ])
    const byUid = Object.fromEntries(out.map((p) => [p.event.uid, p]))
    expect(byUid.a.cols).toBe(2)
    expect(byUid.b.cols).toBe(2)
    expect(byUid.a.col).not.toBe(byUid.b.col)
    // The afternoon meeting is its own group and gets the full width.
    expect(byUid.c.cols).toBe(1)
  })

  it('reuses a freed column within a group', () => {
    const out = layoutDayEvents([
      ev(at(2026, 7, 29, 9), at(2026, 7, 29, 12), 'long'),
      ev(at(2026, 7, 29, 9), at(2026, 7, 29, 10), 'a'),
      ev(at(2026, 7, 29, 10, 30), at(2026, 7, 29, 11), 'b'),
    ])
    const byUid = Object.fromEntries(out.map((p) => [p.event.uid, p]))
    expect(byUid.a.col).toBe(byUid.b.col) // b takes a's freed column
    expect(byUid.long.cols).toBe(2)
  })

  it('ignores all-day events — they live in the strip, not the grid', () => {
    expect(layoutDayEvents([{ ...ev(at(2026, 7, 29), at(2026, 7, 30)), allDay: true }])).toEqual([])
  })
})

describe('timeAtOffset / moveEventToTime', () => {
  it('maps a pixel offset to a snapped local time', () => {
    // 48px per hour → 100px = 2h05m → snaps to 2h00m.
    expect(timeAtOffset(at(2026, 7, 29), 100, 48)).toBe(at(2026, 7, 29, 2, 0))
    expect(timeAtOffset(at(2026, 7, 29), 118, 48, 30)).toBe(at(2026, 7, 29, 2, 30))
  })

  it('clamps inside the day', () => {
    expect(timeAtOffset(at(2026, 7, 29), -50, 48)).toBe(at(2026, 7, 29, 0, 0))
    expect(timeAtOffset(at(2026, 7, 29), 5000, 48)).toBe(at(2026, 7, 29, 23, 45))
  })

  it('keeps the duration when moving to a time', () => {
    const m = moveEventToTime({ start: at(2026, 7, 29, 9), end: at(2026, 7, 29, 10, 30) }, at(2026, 7, 29, 14))
    expect(m.end - m.start).toBe(90 * 60_000)
    expect(m.start).toBe(at(2026, 7, 29, 14))
  })
})
