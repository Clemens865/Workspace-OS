import { describe, it, expect, vi } from 'vitest'
import {
  parseAllDayDate, mapGoogleEvent, mapGraphEvent,
  listGoogleCalendars, fetchGoogleEvents, listGraphCalendars, fetchGraphEvents,
  CloudCalendarError,
} from './cloud-providers'

const at = (y: number, mo: number, d: number, h = 0, mi = 0): number =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

describe('parseAllDayDate', () => {
  it('reads YYYY-MM-DD as local midnight', () => {
    expect(parseAllDayDate('2026-07-29')).toBe(at(2026, 7, 29))
  })

  it('rejects anything else rather than guessing', () => {
    expect(parseAllDayDate('29/07/2026')).toBeNull()
    expect(parseAllDayDate('2026-07-29T09:00:00Z')).toBeNull()
  })
})

describe('mapGoogleEvent', () => {
  it('maps a timed event', () => {
    const ev = mapGoogleEvent({
      id: 'g1', summary: 'Kickoff', location: 'Room 2',
      start: { dateTime: '2026-07-29T09:00:00Z' }, end: { dateTime: '2026-07-29T10:00:00Z' },
    }, 's')
    expect(ev?.summary).toBe('Kickoff')
    expect(ev?.allDay).toBe(false)
    expect(ev?.start).toBe(Date.UTC(2026, 6, 29, 9))
    expect(ev?.location).toBe('Room 2')
  })

  it('maps an all-day event with Google\'s EXCLUSIVE end date', () => {
    // start 3rd, end 5th means the 3rd and 4th — treating end as inclusive would
    // add a phantom day to every trip.
    const ev = mapGoogleEvent({ id: 'g2', summary: 'Offsite', start: { date: '2026-08-03' }, end: { date: '2026-08-05' } }, 's')
    expect(ev?.allDay).toBe(true)
    expect(ev?.start).toBe(at(2026, 8, 3))
    expect(ev?.end).toBe(at(2026, 8, 5))
  })

  it('defaults a missing all-day end to one day', () => {
    const ev = mapGoogleEvent({ id: 'g3', start: { date: '2026-08-03' } }, 's')
    expect(ev!.end - ev!.start).toBe(86_400_000)
  })

  it('DROPS a cancelled event', () => {
    // Cancelled entries still come back in a list response.
    expect(mapGoogleEvent({ id: 'g4', status: 'cancelled', start: { dateTime: '2026-07-29T09:00:00Z' } }, 's')).toBeNull()
  })

  it('skips an event with no id or no usable start rather than inventing a time', () => {
    expect(mapGoogleEvent({ summary: 'x', start: { dateTime: '2026-07-29T09:00:00Z' } }, 's')).toBeNull()
    expect(mapGoogleEvent({ id: 'g5', start: { dateTime: 'not-a-date' } }, 's')).toBeNull()
    expect(mapGoogleEvent({ id: 'g6' }, 's')).toBeNull()
  })

  it('falls back to a placeholder title and carries the source id', () => {
    const ev = mapGoogleEvent({ id: 'g7', start: { dateTime: '2026-07-29T09:00:00Z' } }, 'src-1')
    expect(ev?.summary).toBe('(no title)')
    expect((ev as { sourceId: string }).sourceId).toBe('src-1')
  })
})

describe('mapGraphEvent', () => {
  it('treats a zone-less dateTime as UTC (we request UTC via Prefer)', () => {
    // Parsing '2026-07-29T09:00:00.000' directly would read it as LOCAL time and
    // shift the event for anyone whose machine zone differs.
    const ev = mapGraphEvent({
      id: 'm1', subject: 'Sync',
      start: { dateTime: '2026-07-29T09:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-07-29T09:30:00.0000000', timeZone: 'UTC' },
    }, 's')
    expect(ev?.start).toBe(Date.UTC(2026, 6, 29, 9))
    expect(ev?.end).toBe(Date.UTC(2026, 6, 29, 9, 30))
  })

  it('respects an explicit offset when one is present', () => {
    const ev = mapGraphEvent({ id: 'm2', start: { dateTime: '2026-07-29T09:00:00+02:00' } }, 's')
    expect(ev?.start).toBe(Date.parse('2026-07-29T09:00:00+02:00'))
  })

  it('maps an all-day event to local calendar days', () => {
    const ev = mapGraphEvent({
      id: 'm3', subject: 'Leave', isAllDay: true,
      start: { dateTime: '2026-08-03T00:00:00.0000000' }, end: { dateTime: '2026-08-05T00:00:00.0000000' },
    }, 's')
    expect(ev?.allDay).toBe(true)
    expect(ev?.start).toBe(at(2026, 8, 3))
    expect(ev?.end).toBe(at(2026, 8, 5))
  })

  it('reads location.displayName and bodyPreview', () => {
    const ev = mapGraphEvent({
      id: 'm4', subject: 'S', location: { displayName: 'Room 9' }, bodyPreview: 'agenda',
      start: { dateTime: '2026-07-29T09:00:00Z' },
    }, 's')
    expect(ev?.location).toBe('Room 9')
    expect(ev?.description).toBe('agenda')
  })

  it('skips junk instead of guessing', () => {
    expect(mapGraphEvent({ subject: 'no id', start: { dateTime: '2026-07-29T09:00:00Z' } }, 's')).toBeNull()
    expect(mapGraphEvent({ id: 'm5' }, 's')).toBeNull()
    expect(mapGraphEvent({ id: 'm6', start: { dateTime: 'nope' } }, 's')).toBeNull()
  })
})

describe('google api calls', () => {
  it('lists calendars with colour', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      items: [{ id: 'primary', summary: 'Work', backgroundColor: '#123456' }, { summary: 'no id' }],
    })))
    const cals = await listGoogleCalendars('tok', fetcher as never)
    expect(cals).toEqual([{ url: 'primary', displayName: 'Work', color: '#123456' }])
  })

  it('asks the API to expand recurrence and bounds the window', async () => {
    const fetcher = vi.fn(async (u: string, init?: RequestInit) => {
      expect(u).toContain('singleEvents=true')  // server-side expansion
      expect(u).toContain('timeMin=')
      expect(u).toContain('timeMax=')
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok')
      return new Response(JSON.stringify({ items: [{ id: 'g', summary: 'E', start: { dateTime: '2026-07-29T09:00:00Z' }, end: { dateTime: '2026-07-29T10:00:00Z' } }] }))
    })
    const evs = await fetchGoogleEvents('tok', 'primary', Date.UTC(2026, 6, 29), Date.UTC(2026, 6, 30), 's', fetcher as never)
    expect(evs).toHaveLength(1)
  })

  it('explains an expired sign-in rather than showing a raw 401', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 401 }))
    await expect(listGoogleCalendars('tok', fetcher as never)).rejects.toThrow(/sign-in expired/i)
  })

  it('distinguishes a missing grant (403) from an expired token', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 403 }))
    await expect(listGoogleCalendars('tok', fetcher as never)).rejects.toThrow(/did not grant/i)
  })

  it('reports an unreachable service distinctly', async () => {
    const fetcher = vi.fn(async () => { throw new Error('ENOTFOUND') })
    await expect(listGoogleCalendars('tok', fetcher as never)).rejects.toThrow(/Could not reach/i)
  })
})

describe('graph api calls', () => {
  it('lists calendars', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ value: [{ id: 'AAA', name: 'Calendar' }] })))
    expect(await listGraphCalendars('tok', fetcher as never)).toEqual([{ url: 'AAA', displayName: 'Calendar' }])
  })

  it('uses calendarView and PINS the response timezone to UTC', async () => {
    const fetcher = vi.fn(async (u: string, init?: RequestInit) => {
      expect(u).toContain('/calendarView')
      // Without this header Graph answers in the mailbox zone and the mapping
      // would have to guess.
      expect((init?.headers as Record<string, string>).Prefer).toBe('outlook.timezone="UTC"')
      return new Response(JSON.stringify({ value: [{ id: 'm', subject: 'E', start: { dateTime: '2026-07-29T09:00:00.0000000' } }] }))
    })
    const evs = await fetchGraphEvents('tok', 'AAA', Date.UTC(2026, 6, 29), Date.UTC(2026, 6, 30), 's', fetcher as never)
    expect(evs).toHaveLength(1)
    expect(evs[0].start).toBe(Date.UTC(2026, 6, 29, 9))
  })

  it('falls back to the default calendar when no id is given', async () => {
    const fetcher = vi.fn(async (u: string) => {
      expect(u).toContain('/me/calendarView')
      return new Response(JSON.stringify({ value: [] }))
    })
    await fetchGraphEvents('tok', '', 0, 1, 's', fetcher as never)
  })

  it('surfaces a failure with its status', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 500 }))
    await expect(fetchGraphEvents('tok', 'AAA', 0, 1, 's', fetcher as never)).rejects.toThrow(CloudCalendarError)
  })
})
