import { describe, it, expect, vi } from 'vitest'
import { writeToCalDav, writeTargets, updateOnCalDav, deleteFromCalDav } from './calendar-service'
import { rewriteEventIcs, rewriteSeriesIcs, rewriteOccurrenceIcs, addExdateIcs } from './ics-write'
import type { CalendarSourceStore, CalendarSource } from './account-store'

/**
 * Putting a meeting on iCloud, and letting iCloud invite the people.
 *
 * The thing worth testing is not that a PUT happened — it is what was in it.
 * An event written without an ORGANIZER the server recognises is accepted and
 * then invites nobody, which looks exactly like success from in here. So these
 * assert the contents of the document, not the status code.
 */

const CALDAV_SOURCE = {
  id: 'src1',
  kind: 'caldav' as const,
  displayName: 'iCloud',
  url: 'https://caldav.icloud.com',
  username: 'clemens',
  createdAt: 0,
  updatedAt: 0,
}

function fakeStore(
  sources: CalendarSource[] = [CALDAV_SOURCE],
  secret: string | null = 'app-password',
): CalendarSourceStore {
  return {
    list: async () => sources,
    get: async (id: string) => sources.find((s) => s.id === id) ?? null,
    getSecret: async () => secret,
  } as unknown as CalendarSourceStore
}

const TARGET = {
  id: 'src1:https://caldav.icloud.com/1/calendars/home/',
  label: 'Home · iCloud',
  kind: 'caldav' as const,
  sourceId: 'src1',
  calendarUrl: 'https://caldav.icloud.com/1/calendars/home/',
  canInvite: true,
}

const IDENTITY_XML = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop>
  <d:current-user-principal><d:href>/p/</d:href></d:current-user-principal>
  <c:calendar-user-address-set><d:href>mailto:organizer@icloud.com</d:href></c:calendar-user-address-set>
</d:prop></d:propstat></d:response></d:multistatus>`

/** Captures what was PUT, answering PROPFINDs with a stock identity. */
function stubFetch(identity = IDENTITY_XML): { fetch: typeof fetch; body: () => string } {
  let put = ''
  const f = vi.fn(async (_url: unknown, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => {
    if (init?.method === 'PUT') {
      put = String(init.body)
      return new Response('', { status: 201, headers: { etag: '"1"' } })
    }
    return new Response(identity, { status: 207 })
  })
  return { fetch: f as unknown as typeof fetch, body: () => put }
}

const EVENT = {
  summary: 'First meeting — Anna Weber',
  start: Date.UTC(2026, 7, 25, 12, 0),
  end: Date.UTC(2026, 7, 25, 13, 0),
}

describe('writeToCalDav', () => {
  it('invites the people, as the account the server knows', async () => {
    const stub = stubFetch()
    vi.stubGlobal('fetch', stub.fetch)
    const res = await writeToCalDav(fakeStore(), TARGET, {
      ...EVENT,
      attendees: [{ email: 'anna@example.com', name: 'Anna Weber' }],
    })
    const ics = stub.body()
    // The organizer is the address the SERVER published, never the username.
    expect(ics).toContain('ORGANIZER:mailto:organizer@icloud.com')
    expect(ics).toContain('ATTENDEE;CN=Anna Weber')
    expect(ics).toContain('mailto:anna@example.com')
    expect(ics).toContain('RSVP=TRUE')
    expect(res.invited).toEqual(['anna@example.com'])
    vi.unstubAllGlobals()
  })

  /**
   * A stored document must not carry METHOD:REQUEST — some clients then treat
   * the copy on the server as an incoming invitation to the organizer.
   */
  it('writes a stored event, not an emailed invitation', async () => {
    const stub = stubFetch()
    vi.stubGlobal('fetch', stub.fetch)
    await writeToCalDav(fakeStore(), TARGET, { ...EVENT, attendees: [{ email: 'a@b.c' }] })
    expect(stub.body()).not.toContain('METHOD:')
    vi.unstubAllGlobals()
  })

  it('does not look up an identity for an event with nobody to invite', async () => {
    const stub = stubFetch()
    vi.stubGlobal('fetch', stub.fetch)
    await writeToCalDav(fakeStore(), TARGET, EVENT)
    expect(stub.body()).not.toContain('ORGANIZER')
    expect(stub.body()).toContain('SUMMARY:First meeting')
    vi.unstubAllGlobals()
  })

  /**
   * The silent failure this whole path exists to avoid: an event that looks
   * scheduled and tells nobody. Better to refuse than to appear to succeed.
   */
  it('refuses rather than creating a meeting that invites nobody', async () => {
    const stub = stubFetch('<d:multistatus xmlns:d="DAV:"></d:multistatus>')
    vi.stubGlobal('fetch', stub.fetch)
    await expect(
      writeToCalDav(fakeStore(), TARGET, { ...EVENT, attendees: [{ email: 'a@b.c' }] }),
    ).rejects.toThrow(/cannot send invitations/i)
    expect(stub.body()).toBe('')
    vi.unstubAllGlobals()
  })

  it('says so when the password is gone rather than failing at the server', async () => {
    await expect(writeToCalDav(fakeStore([CALDAV_SOURCE], null), TARGET, EVENT)).rejects.toThrow(/reconnect/i)
  })

  it('says so when the calendar has been disconnected', async () => {
    await expect(writeToCalDav(fakeStore([]), TARGET, EVENT)).rejects.toThrow(/no longer connected/i)
  })
})

describe('writeTargets', () => {
  const LIST_XML = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
    <d:response><d:href>/1/calendars/home/</d:href><d:propstat><d:prop>
      <d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Home</d:displayname>
      <d:current-user-privilege-set><d:privilege><d:write-content/></d:privilege></d:current-user-privilege-set>
    </d:prop></d:propstat></d:response>
    <d:response><d:href>/1/calendars/holidays/</d:href><d:propstat><d:prop>
      <d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Holidays</d:displayname>
      <d:current-user-privilege-set><d:privilege><d:read/></d:privilege></d:current-user-privilege-set>
    </d:prop></d:propstat></d:response>
  </d:multistatus>`

  it('offers this Mac plus the calendars that accept writes', async () => {
    vi.stubGlobal('fetch', (async () => new Response(LIST_XML, { status: 207 })) as unknown as typeof fetch)
    const t = await writeTargets(fakeStore())
    expect(t.map((x) => x.label)).toEqual(['On this Mac', 'Home · iCloud'])
    vi.unstubAllGlobals()
  })

  /** A second broken account must not stop the first from being used. */
  it('skips an account it cannot reach instead of failing', async () => {
    vi.stubGlobal('fetch', (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch)
    expect((await writeTargets(fakeStore())).map((x) => x.id)).toEqual(['local'])
    vi.unstubAllGlobals()
  })

  /** An .ics feed is somebody else's URL — it is not somewhere to write. */
  it('does not offer a subscribed feed', async () => {
    const ics = { ...CALDAV_SOURCE, id: 'feed', kind: 'ics' as const }
    vi.stubGlobal('fetch', (async () => new Response(LIST_XML, { status: 207 })) as unknown as typeof fetch)
    const t = await writeTargets(fakeStore([ics]))
    expect(t.map((x) => x.id)).toEqual(['local'])
    vi.unstubAllGlobals()
  })
})

/**
 * Editing an event that ANOTHER client created is where a rebuild-from-draft
 * would silently lose data. These pin the surgical rewrite: what the form can
 * change is replaced, everything else — attendees, alarms, X- properties —
 * survives byte-for-byte, and SEQUENCE says the copy supersedes the old one.
 */
const APPLE_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Apple Inc.//macOS 15.0//EN',
  'BEGIN:VEVENT',
  'UID:ABC-123',
  'DTSTAMP:20260810T090000Z',
  'SEQUENCE:2',
  'DTSTART;TZID=Europe/Vienna:20260825T140000',
  'DTEND;TZID=Europe/Vienna:20260825T150000',
  'SUMMARY:Old title',
  'LOCATION:Old room',
  'ORGANIZER;CN=Organizer:mailto:organizer@icloud.com',
  'ATTENDEE;CN=Anna Weber;PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:anna@example.com',
  'X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC',
  'BEGIN:VALARM',
  'TRIGGER:-PT15M',
  'ACTION:DISPLAY',
  'DESCRIPTION:Reminder',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

const EDIT = {
  summary: 'New title',
  start: Date.UTC(2026, 7, 26, 9, 0),
  end: Date.UTC(2026, 7, 26, 10, 0),
  allDay: false,
}

describe('rewriteEventIcs', () => {
  it('changes what the form changed and keeps everything it cannot see', () => {
    const out = rewriteEventIcs(APPLE_ICS, { ...EDIT, location: 'Room 4' })
    expect(out).toContain('SUMMARY:New title')
    expect(out).toContain('DTSTART:20260826T090000Z')
    expect(out).toContain('DTEND:20260826T100000Z')
    expect(out).toContain('LOCATION:Room 4')
    expect(out).not.toContain('Old title')
    expect(out).not.toContain('Old room')
    // The parts a rebuild would have dropped:
    expect(out).toContain('ATTENDEE;CN=Anna Weber;PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:anna@example.com')
    expect(out).toContain('ORGANIZER;CN=Organizer:mailto:organizer@icloud.com')
    expect(out).toContain('X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC')
    expect(out).toContain('BEGIN:VALARM')
    expect(out).toContain('TRIGGER:-PT15M')
  })

  it('bumps SEQUENCE so the copy supersedes what attendees hold', () => {
    expect(rewriteEventIcs(APPLE_ICS, EDIT)).toContain('SEQUENCE:3')
    // An event that never had one starts at 1 — still above the implicit 0.
    const bare = APPLE_ICS.replace('SEQUENCE:2\r\n', '')
    expect(rewriteEventIcs(bare, EDIT)).toContain('SEQUENCE:1')
  })

  it('drops a leftover DURATION when writing a new DTEND', () => {
    const withDuration = APPLE_ICS
      .replace('DTEND;TZID=Europe/Vienna:20260825T150000', 'DURATION:PT1H')
    const out = rewriteEventIcs(withDuration, EDIT)
    expect(out).not.toContain('DURATION:')
    expect(out).toContain('DTEND:20260826T100000Z')
  })

  it('turns a timed event all-day and back', () => {
    const out = rewriteEventIcs(APPLE_ICS, {
      ...EDIT, allDay: true,
      start: Date.UTC(2026, 7, 26), end: Date.UTC(2026, 7, 27),
    })
    expect(out).toContain('DTSTART;VALUE=DATE:20260826')
    expect(out).toContain('DTEND;VALUE=DATE:20260827')
    expect(out).not.toContain('TZID=Europe/Vienna')
  })

  it('survives folded lines — the fold is unfolded, edited, and refolded validly', () => {
    const folded = APPLE_ICS.replace(
      'SUMMARY:Old title',
      'DESCRIPTION:A very long note that was folded by the writing client acros\r\n s two physical lines\r\nSUMMARY:Old title',
    )
    const out = rewriteEventIcs(folded, { ...EDIT, description: 'Short note' })
    expect(out).toContain('DESCRIPTION:Short note')
    expect(out).not.toContain('folded by the writing client')
  })

  it('refuses a repeating event rather than corrupting the series', () => {
    const recurring = APPLE_ICS.replace('SUMMARY:Old title', 'RRULE:FREQ=WEEKLY\r\nSUMMARY:Old title')
    expect(() => rewriteEventIcs(recurring, EDIT)).toThrow(/repeats/i)
  })

  it('refuses a document with no event in it', () => {
    expect(() => rewriteEventIcs('BEGIN:VCALENDAR\r\nEND:VCALENDAR', EDIT)).toThrow(/calendar event/i)
  })
})

describe('updateOnCalDav / deleteFromCalDav', () => {
  const HREF = 'https://p10-caldav.icloud.com/1/calendars/home/whatever-apple-named-it.ics'

  /** GET answers the stored doc; PUT/DELETE are captured with their headers. */
  function stubServer(getStatus = 200): {
    fetch: typeof fetch
    calls: () => { method: string; url: string; headers: Record<string, string>; body: string }[]
  } {
    const calls: { method: string; url: string; headers: Record<string, string>; body: string }[] = []
    const f = vi.fn(async (url: unknown, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => {
      const method = init?.method ?? 'GET'
      calls.push({ method, url: String(url), headers: init?.headers ?? {}, body: String(init?.body ?? '') })
      if (method === 'GET') return new Response(APPLE_ICS, { status: getStatus, headers: { etag: '"v7"' } })
      return new Response(null, { status: 204, headers: { etag: '"v8"' } })
    })
    return { fetch: f as unknown as typeof fetch, calls: () => calls }
  }

  it('re-reads the server copy and PUTs conditionally on ITS etag', async () => {
    const stub = stubServer()
    vi.stubGlobal('fetch', stub.fetch)
    await updateOnCalDav(fakeStore(), { sourceId: 'src1', href: HREF }, { ...EDIT })
    const [get, put] = stub.calls()
    expect(get.method).toBe('GET')
    expect(put.method).toBe('PUT')
    expect(put.url).toBe(HREF)
    expect(put.headers['If-Match']).toBe('"v7"')
    expect(put.body).toContain('SUMMARY:New title')
    expect(put.body).toContain('ATTENDEE;CN=Anna Weber')
    vi.unstubAllGlobals()
  })

  it('deletes conditionally on the current etag', async () => {
    const stub = stubServer()
    vi.stubGlobal('fetch', stub.fetch)
    await deleteFromCalDav(fakeStore(), { sourceId: 'src1', href: HREF })
    const [, del] = stub.calls()
    expect(del.method).toBe('DELETE')
    expect(del.headers['If-Match']).toBe('"v7"')
    vi.unstubAllGlobals()
  })

  it('treats an already-deleted event as done, not as an error', async () => {
    const stub = stubServer(404)
    vi.stubGlobal('fetch', stub.fetch)
    await expect(deleteFromCalDav(fakeStore(), { sourceId: 'src1', href: HREF })).resolves.toBeUndefined()
    expect(stub.calls().every((c) => c.method === 'GET')).toBe(true)
    vi.unstubAllGlobals()
  })

  it('reports a vanished event honestly on edit', async () => {
    const stub = stubServer(404)
    vi.stubGlobal('fetch', stub.fetch)
    await expect(
      updateOnCalDav(fakeStore(), { sourceId: 'src1', href: HREF }, { ...EDIT }),
    ).rejects.toThrow(/no longer exists/i)
    vi.unstubAllGlobals()
  })
})

/**
 * Recurring surgery + attendee edits. The stakes: a series edit must not
 * resurrect deleted occurrences, an occurrence edit must not move the series,
 * and replacing the invite list must not reset RSVPs people already gave.
 */
const SERIES_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:series@x',
  'SEQUENCE:1',
  'DTSTART;TZID=Europe/Vienna:20260803T090000',
  'DTEND;TZID=Europe/Vienna:20260803T093000',
  'RRULE:FREQ=WEEKLY',
  'EXDATE;TZID=Europe/Vienna:20260817T090000',
  'SUMMARY:Standup',
  'ATTENDEE;CN=Anna;PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:anna@x.com',
  'ORGANIZER:mailto:organizer@icloud.com',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

describe('rewriteSeriesIcs', () => {
  it('renames the series but keeps the recurrence machinery intact', () => {
    const out = rewriteSeriesIcs(SERIES_ICS, { summary: 'Daily sync', location: 'Room 2' })
    expect(out).toContain('SUMMARY:Daily sync')
    expect(out).toContain('LOCATION:Room 2')
    expect(out).toContain('RRULE:FREQ=WEEKLY')
    expect(out).toContain('EXDATE;TZID=Europe/Vienna:20260817T090000') // deleted stays deleted
    expect(out).toContain('DTSTART;TZID=Europe/Vienna:20260803T090000') // time untouched
    expect(out).toContain('SEQUENCE:2')
    expect(out).toContain('ATTENDEE;CN=Anna')
  })

  it('moves the series time in ITS OWN zone, never converting to UTC', () => {
    const out = rewriteSeriesIcs(SERIES_ICS, {
      summary: 'Standup',
      time: { hour: 10, minute: 30, durationMs: 45 * 60_000 },
    })
    expect(out).toContain('DTSTART;TZID=Europe/Vienna:20260803T')
    expect(out).toContain('DTEND;TZID=Europe/Vienna:20260803T')
    expect(out).not.toMatch(/DTSTART:\d{8}T\d{6}Z/)
    expect(out).toContain('RRULE:FREQ=WEEKLY')
  })
})

describe('rewriteOccurrenceIcs', () => {
  const OCC = new Date(2026, 7, 10, 9, 0, 0).getTime() // Mon Aug 10, host-local

  it('creates an override carrying the attendees, and leaves the master alone', () => {
    const out = rewriteOccurrenceIcs(SERIES_ICS, OCC, {
      summary: 'Standup (moved)',
      start: new Date(2026, 7, 10, 14, 0).getTime(),
      end: new Date(2026, 7, 10, 14, 30).getTime(),
      allDay: false,
    })
    // The override names WHICH occurrence, in the master's own form.
    expect(out).toContain('RECURRENCE-ID;TZID=Europe/Vienna:20260810T')
    expect(out).toContain('SUMMARY:Standup (moved)')
    // The master still says 09:00 and still recurs.
    expect(out).toContain('DTSTART;TZID=Europe/Vienna:20260803T090000')
    expect(out).toContain('RRULE:FREQ=WEEKLY')
    // The attendees travelled into the override — the server updates them.
    const override = out.slice(out.indexOf('RECURRENCE-ID'))
    expect(override).toContain('mailto:anna@x.com')
  })

  it('edits an existing override in place instead of stacking a second one', () => {
    const once = rewriteOccurrenceIcs(SERIES_ICS, OCC, {
      summary: 'Moved once', start: OCC, end: OCC + 1800_000, allDay: false,
    })
    const twice = rewriteOccurrenceIcs(once, OCC, {
      summary: 'Moved twice', start: OCC, end: OCC + 1800_000, allDay: false,
    })
    expect(twice.match(/RECURRENCE-ID/g)).toHaveLength(1)
    expect(twice).toContain('SUMMARY:Moved twice')
    expect(twice).not.toContain('Moved once')
  })
})

describe('addExdateIcs', () => {
  const OCC = new Date(2026, 7, 24, 9, 0, 0).getTime()

  it('excludes the occurrence in the master, in the master form, and bumps SEQUENCE', () => {
    const out = addExdateIcs(SERIES_ICS, OCC)
    expect(out).toContain('EXDATE;TZID=Europe/Vienna:20260824T')
    expect(out).toContain('EXDATE;TZID=Europe/Vienna:20260817T090000') // the old one survives
    expect(out).toContain('SEQUENCE:2')
    expect(out).toContain('RRULE:FREQ=WEEKLY')
  })

  it('removes a stale override for the deleted occurrence', () => {
    const moved = rewriteOccurrenceIcs(SERIES_ICS, OCC, {
      summary: 'Moved', start: OCC, end: OCC + 1800_000, allDay: false,
    })
    const out = addExdateIcs(moved, OCC)
    expect(out).not.toContain('RECURRENCE-ID')
    expect(out).not.toContain('SUMMARY:Moved')
  })
})

describe('attendee edits on a single event', () => {
  const SINGLE = APPLE_ICS
  // Assertions must look through RFC folding — a long ATTENDEE line legally
  // wraps mid-address, which is invisible to every client and fatal to toContain.
  const unfolded = (s: string): string => s.replace(/\r\n[ \t]/g, '')

  it('keeps the RSVP someone already gave and starts new people unanswered', () => {
    const out = unfolded(rewriteEventIcs(SINGLE, {
      ...EDIT,
      attendees: [{ email: 'anna@example.com', name: 'Anna Weber' }, { email: 'ben@y.org' }],
    }))
    expect(out).toContain('PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:anna@example.com')
    expect(out).toContain('PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:ben@y.org')
    // The event's own organizer survives.
    expect(out).toContain('ORGANIZER;CN=Organizer:mailto:organizer@icloud.com')
  })

  it('removing a person removes their line', () => {
    const out = unfolded(rewriteEventIcs(SINGLE, { ...EDIT, attendees: [{ email: 'ben@y.org' }] }))
    expect(out).not.toContain('anna@example.com')
    expect(out).toContain('mailto:ben@y.org')
  })

  it('an edit that says nothing about attendees leaves them exactly alone', () => {
    const out = rewriteEventIcs(SINGLE, EDIT)
    expect(out).toContain('ATTENDEE;CN=Anna Weber;PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:anna@example.com')
  })
})
