import { describe, it, expect, vi } from 'vitest'
import {
  discoverIdentity,
  resolveHref, icsStamp, splitResponses, pickTag, hasTag, decodeXmlText,
  parseCalendarList, parseCalendarData, parseReportEntries, discoverCalendars, fetchEvents, fetchIcsFeed, CalDavError,
} from './caldav-client'

const ACCOUNT = { url: 'https://dav.example.com/', username: 'u', password: 'p' }

/** A multistatus body mixing a calendar, an address book and the home itself —
 *  the real shape of a CalDAV home, and the reason filtering matters. */
const CAL_LIST = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">
  <d:response>
    <d:href>/dav/u/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:displayname>Home</d:displayname></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/u/work/</d:href>
    <d:propstat><d:prop>
      <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
      <d:displayname>Work &amp; Travel</d:displayname>
      <cs:calendar-color>#FF5733FF</cs:calendar-color>
      <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>
    </d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/u/tasks/</d:href>
    <d:propstat><d:prop>
      <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
      <d:displayname>Reminders</d:displayname>
      <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`

describe('xml helpers', () => {
  it('splits a multistatus into responses', () => {
    expect(splitResponses(CAL_LIST)).toHaveLength(3)
  })

  it('picks a tag namespace-agnostically', () => {
    expect(pickTag('<D:displayname>Work</D:displayname>', 'displayname')).toBe('Work')
    expect(pickTag('<displayname>Bare</displayname>', 'displayname')).toBe('Bare')
    expect(pickTag('<other>x</other>', 'displayname')).toBeNull()
  })

  it('detects a self-closing tag', () => {
    expect(hasTag('<c:calendar/>', 'calendar')).toBe(true)
    expect(hasTag('<d:collection/>', 'calendar')).toBe(false)
  })

  it('decodes entities, ampersand last', () => {
    expect(decodeXmlText('Work &amp; Travel')).toBe('Work & Travel')
    // &amp;lt; must survive as the text "&lt;", not become "<".
    expect(decodeXmlText('&amp;lt;')).toBe('&lt;')
    expect(decodeXmlText('<![CDATA[raw & stuff]]>')).toBe('raw & stuff')
  })

  it('absolutises a server-relative href', () => {
    expect(resolveHref('https://dav.example.com/x/', '/dav/u/work/')).toBe('https://dav.example.com/dav/u/work/')
  })

  it('stamps a UTC time for a time-range filter', () => {
    expect(icsStamp(Date.UTC(2026, 6, 29, 9, 5, 3))).toBe('20260729T090503Z')
  })
})

describe('parseCalendarList', () => {
  const cals = parseCalendarList(CAL_LIST, 'https://dav.example.com/dav/u/')

  it('keeps only VEVENT calendars — not the home, not a task list', () => {
    expect(cals).toHaveLength(1)
    expect(cals[0].displayName).toBe('Work & Travel')
  })

  it('absolutises the collection url', () => {
    expect(cals[0].url).toBe('https://dav.example.com/dav/u/work/')
  })

  it('trims a server colour to #rrggbb', () => {
    expect(cals[0].color).toBe('#FF5733')
  })

  it('keeps a calendar that names no component set (servers often omit it)', () => {
    const xml = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response>
      <d:href>/c/</d:href><d:propstat><d:prop>
      <d:resourcetype><c:calendar/></d:resourcetype><d:displayname>Plain</d:displayname>
      </d:prop></d:propstat></d:response></d:multistatus>`
    expect(parseCalendarList(xml, 'https://x/')).toHaveLength(1)
  })
})

const REPORT = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response><d:propstat><d:prop><c:calendar-data>BEGIN:VCALENDAR
BEGIN:VEVENT
UID:a@x
SUMMARY:Kickoff
DTSTART:20260729T090000Z
DTEND:20260729T100000Z
END:VEVENT
END:VCALENDAR</c:calendar-data></d:prop></d:propstat></d:response>
  <d:response><d:propstat><d:prop><c:calendar-data>BEGIN:VCALENDAR
BEGIN:VEVENT
UID:b@x
SUMMARY:Retro
DTSTART:20260730T090000Z
DTEND:20260730T093000Z
END:VEVENT
END:VCALENDAR</c:calendar-data></d:prop></d:propstat></d:response>
</d:multistatus>`

describe('parseCalendarData', () => {
  it('extracts every calendar-data payload', () => {
    expect(parseCalendarData(REPORT)).toHaveLength(2)
  })
})

describe('fetchEvents', () => {
  it('sends a time-bounded calendar-query and parses the events', async () => {
    const fetcher = vi.fn(async (_u: string, init?: RequestInit) => {
      expect(init?.method).toBe('REPORT')
      expect(String(init?.body)).toContain('time-range')
      expect(String(init?.body)).toContain('20260729T000000Z')
      return new Response(REPORT, { status: 207 })
    })
    const evs = await fetchEvents(ACCOUNT, 'https://dav.example.com/dav/u/work/', Date.UTC(2026, 6, 29), Date.UTC(2026, 6, 31), fetcher as never)
    expect(evs.map((e) => e.summary)).toEqual(['Kickoff', 'Retro'])
  })

  it('sends HTTP Basic auth', async () => {
    const fetcher = vi.fn(async (_u: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>).Authorization
      expect(auth).toBe('Basic ' + Buffer.from('u:p').toString('base64'))
      return new Response(REPORT, { status: 207 })
    })
    await fetchEvents(ACCOUNT, 'https://x/c/', 0, 1, fetcher as never)
  })
})

describe('discoverCalendars', () => {
  it('uses a directly-pasted collection URL without a discovery round-trip', async () => {
    const fetcher = vi.fn(async () => new Response(CAL_LIST, { status: 207 }))
    const cals = await discoverCalendars(ACCOUNT, fetcher as never)
    expect(cals).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(1) // no needless discovery walk
  })

  it('walks principal → home → calendars for a bare hostname', async () => {
    const home = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response>
      <d:propstat><d:prop><c:calendar-home-set><d:href>/dav/u/</d:href></c:calendar-home-set></d:prop></d:propstat>
      </d:response></d:multistatus>`
    const replies = ['<d:multistatus xmlns:d="DAV:"></d:multistatus>', home, CAL_LIST]
    let i = 0
    const fetcher = vi.fn(async () => new Response(replies[i++], { status: 207 }))
    const cals = await discoverCalendars(ACCOUNT, fetcher as never)
    expect(cals.map((c) => c.displayName)).toEqual(['Work & Travel'])
  })

  it('explains a 401 in terms of app passwords rather than saying "failed"', async () => {
    const fetcher = vi.fn(async () => new Response('nope', { status: 401 }))
    await expect(discoverCalendars(ACCOUNT, fetcher as never)).rejects.toThrow(/app-specific password/i)
  })

  it('reports an unreachable server distinctly from a bad password', async () => {
    const fetcher = vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND') })
    await expect(discoverCalendars(ACCOUNT, fetcher as never)).rejects.toThrow(/Could not reach/i)
  })

  it('says so plainly when a server advertises no calendar home', async () => {
    const fetcher = vi.fn(async () => new Response('<d:multistatus xmlns:d="DAV:"></d:multistatus>', { status: 207 }))
    await expect(discoverCalendars(ACCOUNT, fetcher as never)).rejects.toThrow(CalDavError)
  })
})

describe('fetchIcsFeed', () => {
  it('reads a plain https feed', async () => {
    const ics = 'BEGIN:VEVENT\nUID:h@x\nSUMMARY:Holiday\nDTSTART;VALUE=DATE:20260801\nEND:VEVENT'
    const fetcher = vi.fn(async () => new Response(ics, { status: 200 }))
    const evs = await fetchIcsFeed('https://x/cal.ics', fetcher as never)
    expect(evs[0].summary).toBe('Holiday')
    expect(evs[0].allDay).toBe(true)
  })

  it('rewrites webcal:// to https://', async () => {
    const fetcher = vi.fn(async (u: string) => {
      expect(u).toBe('https://x/cal.ics')
      return new Response('', { status: 200 })
    })
    await fetchIcsFeed('webcal://x/cal.ics', fetcher as never)
  })

  it('surfaces a failing feed with its status', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 404 }))
    await expect(fetchIcsFeed('https://x/cal.ics', fetcher as never)).rejects.toThrow(/404/)
  })
})

/**
 * A root that refuses to be listed.
 *
 * iCloud answers 400 to a Depth:1 PROPFIND on its root, which is reasonable —
 * you cannot enumerate everyone's calendars. The connection used to die there
 * with "the calendar server returned 400", BEFORE the principal → home walk
 * that would have succeeded. Authentication had already passed, so the message
 * pointed at a password problem that did not exist.
 */
describe('a server that rejects the direct listing', () => {
  const HOME = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response>
    <d:propstat><d:prop><c:calendar-home-set><d:href>/123/calendars/</d:href></c:calendar-home-set></d:prop></d:propstat>
    </d:response></d:multistatus>`

  it('carries on to discovery after a 400, instead of giving up', async () => {
    let call = 0
    const fetcher = vi.fn(async () => {
      call += 1
      if (call === 1) return new Response('go away', { status: 400 })
      if (call === 2) return new Response(HOME, { status: 207 })
      return new Response(CAL_LIST, { status: 207 })
    })
    const cals = await discoverCalendars(ACCOUNT, fetcher as never)
    expect(cals.map((c) => c.displayName)).toEqual(['Work & Travel'])
  })

  it('also recovers from a 404 or a 405 on that first call', async () => {
    for (const status of [404, 405, 500]) {
      let call = 0
      const fetcher = vi.fn(async () => {
        call += 1
        if (call === 1) return new Response('nope', { status })
        if (call === 2) return new Response(HOME, { status: 207 })
        return new Response(CAL_LIST, { status: 207 })
      })
      expect((await discoverCalendars(ACCOUNT, fetcher as never)).length, String(status)).toBe(1)
    }
  })

  /** Retrying a wrong password three times helps nobody. */
  it('still fails fast on bad credentials', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 401 }))
    await expect(discoverCalendars(ACCOUNT, fetcher as never)).rejects.toThrow(/app-specific password/)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

/**
 * The iCloud shape: a root that offers only a principal.
 *
 * The calendar home lives on the PRINCIPAL, never on the root. Taking the
 * principal and running a Depth:1 listing against it — which is what this used
 * to do — asks a server to enumerate a collection it will not enumerate, and
 * iCloud answers 400. The extra Depth:0 hop is the whole fix.
 */
describe('root advertises only a principal', () => {
  const ROOT_PRINCIPAL = `<d:multistatus xmlns:d="DAV:"><d:response>
    <d:propstat><d:prop><d:current-user-principal><d:href>/1234/principal/</d:href></d:current-user-principal></d:prop></d:propstat>
    </d:response></d:multistatus>`
  const PRINCIPAL_HOME = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response>
    <d:propstat><d:prop><c:calendar-home-set><d:href>/1234/calendars/</d:href></c:calendar-home-set></d:prop></d:propstat>
    </d:response></d:multistatus>`

  it('asks the principal for its home before listing anything', async () => {
    const seen: { url: string; depth: string }[] = []
    const replies = ['<d:multistatus xmlns:d="DAV:"></d:multistatus>', ROOT_PRINCIPAL, PRINCIPAL_HOME, CAL_LIST]
    let i = 0
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url, depth: String((init.headers as Record<string, string>).Depth) })
      return new Response(replies[i++], { status: 207 })
    })
    const cals = await discoverCalendars(ACCOUNT, fetcher as never)
    expect(cals.map((c) => c.displayName)).toEqual(['Work & Travel'])
    // The principal is asked with Depth:0 — never enumerated with Depth:1.
    const principalCall = seen.find((s) => s.url.includes('/principal/'))
    expect(principalCall?.depth).toBe('0')
    // Only the calendar HOME is listed with Depth:1.
    expect(seen[seen.length - 1].depth).toBe('1')
    expect(seen[seen.length - 1].url).toContain('/calendars/')
  })

  it('says something useful when the principal has no calendar home', async () => {
    const replies = [
      '<d:multistatus xmlns:d="DAV:"></d:multistatus>',
      ROOT_PRINCIPAL,
      '<d:multistatus xmlns:d="DAV:"></d:multistatus>',
    ]
    let i = 0
    const fetcher = vi.fn(async () => new Response(replies[i++], { status: 207 }))
    await expect(discoverCalendars(ACCOUNT, fetcher as never)).rejects.toThrow(/does not advertise a calendar home/)
  })
})

describe('error detail', () => {
  /** "400" alone identified neither the hop nor the reason. */
  it('names the request and repeats what the server said', async () => {
    const fetcher = vi.fn(async () =>
      new Response('<error><invalid-depth>Depth 1 not allowed here</invalid-depth></error>', { status: 400 }),
    )
    await expect(discoverCalendars(ACCOUNT, fetcher as never)).rejects.toThrow(/Depth 1 not allowed here/)
  })
})

/**
 * A calendar the server says we may not write to.
 *
 * Subscribed calendars — holidays, somebody's shared feed — are normal to have
 * on iCloud, and offering one as a place to put a meeting means the person is
 * told it is scheduled and then it 403s.
 */
describe('writability', () => {
  const RESPONSE = (privs: string): string =>
    `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
      <d:response><d:href>/cal/one/</d:href><d:propstat><d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>One</d:displayname>${privs}
      </d:prop></d:propstat></d:response>
    </d:multistatus>`

  it('marks a calendar read-only when the server says so', () => {
    const xml = RESPONSE('<d:current-user-privilege-set><d:privilege><d:read/></d:privilege></d:current-user-privilege-set>')
    expect(parseCalendarList(xml, 'https://x/')[0].readOnly).toBe(true)
  })

  it('does not mark one read-only when it may be written to', () => {
    const xml = RESPONSE(
      '<d:current-user-privilege-set><d:privilege><d:read/></d:privilege><d:privilege><d:write-content/></d:privilege></d:current-user-privilege-set>',
    )
    expect(parseCalendarList(xml, 'https://x/')[0].readOnly).toBeUndefined()
  })

  /** Unknown is not the same as forbidden — see the field's comment. */
  it('treats a server that did not answer as writable', () => {
    expect(parseCalendarList(RESPONSE(''), 'https://x/')[0].readOnly).toBeUndefined()
  })
})

/**
 * The organizer address, without which the server sends no invitations.
 */
describe('discoverIdentity', () => {
  const ACCOUNT = { url: 'https://caldav.icloud.com', username: 'u', password: 'p' }

  it('follows the principal to find the addresses', async () => {
    const seen: string[] = []
    const fetcher = (async (url: string) => {
      seen.push(String(url))
      const body = String(url).includes('principal')
        ? `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop>
             <c:calendar-user-address-set>
               <d:href>mailto:alex@example.com</d:href>
               <d:href>urn:uuid:1234</d:href>
             </c:calendar-user-address-set>
           </d:prop></d:propstat></d:response></d:multistatus>`
        : `<d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop>
             <d:current-user-principal><d:href>/principal/123/</d:href></d:current-user-principal>
           </d:prop></d:propstat></d:response></d:multistatus>`
      return new Response(body, { status: 207 })
    }) as unknown as typeof fetch

    const id = await discoverIdentity(ACCOUNT, fetcher)
    // A urn:uuid is the principal's own id — useless as an organizer address.
    expect(id.addresses).toEqual(['alex@example.com'])
    expect(id.principalUrl).toBe('https://caldav.icloud.com/principal/123/')
    expect(seen).toHaveLength(2)
  })

  it('does not walk again when the root already answered', async () => {
    let calls = 0
    const fetcher = (async () => {
      calls++
      return new Response(
        `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop>
           <d:current-user-principal><d:href>/p/</d:href></d:current-user-principal>
           <c:calendar-user-address-set><d:href>mailto:a@b.c</d:href></c:calendar-user-address-set>
         </d:prop></d:propstat></d:response></d:multistatus>`,
        { status: 207 },
      )
    }) as unknown as typeof fetch
    expect((await discoverIdentity(ACCOUNT, fetcher)).addresses).toEqual(['a@b.c'])
    expect(calls).toBe(1)
  })

  it('reports no addresses rather than inventing one', async () => {
    const fetcher = (async () =>
      new Response('<d:multistatus xmlns:d="DAV:"></d:multistatus>', { status: 207 })) as unknown as typeof fetch
    expect((await discoverIdentity(ACCOUNT, fetcher)).addresses).toEqual([])
  })
})

describe('parseReportEntries / event identity', () => {
  const REPORT_WITH_IDS = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response><d:href>/1/calendars/home/apple-named-this.ics</d:href><d:propstat><d:prop>
  <d:getetag>"etag-77"</d:getetag><c:calendar-data>BEGIN:VCALENDAR
BEGIN:VEVENT
UID:a@x
SUMMARY:Kickoff
DTSTART:20260729T090000Z
DTEND:20260729T100000Z
END:VEVENT
END:VCALENDAR</c:calendar-data></d:prop></d:propstat></d:response>
</d:multistatus>`

  it('keeps each payload paired with its href and etag', () => {
    const [e] = parseReportEntries(REPORT_WITH_IDS)
    expect(e.href).toBe('/1/calendars/home/apple-named-this.ics')
    expect(e.etag).toBe('"etag-77"')
    expect(e.ics).toContain('SUMMARY:Kickoff')
  })

  /**
   * The href is what makes an event EDITABLE later — and it is the server's
   * name for the object, not `<uid>.ics`. Guessing the URL from the uid 404s
   * against real Apple data, which is why the identity must come from here.
   */
  it('annotates fetched events with their absolute server identity', async () => {
    const fetcher = vi.fn(async () => new Response(REPORT_WITH_IDS, { status: 207 }))
    const [ev] = await fetchEvents(ACCOUNT, 'https://dav.example.com/1/calendars/home/', 0, 1, fetcher as never)
    expect(ev.href).toBe('https://dav.example.com/1/calendars/home/apple-named-this.ics')
    expect(ev.etag).toBe('"etag-77"')
    expect(ev.calendarUrl).toBe('https://dav.example.com/1/calendars/home/')
  })

  it('leaves events without an href unannotated rather than guessing', async () => {
    const fetcher = vi.fn(async () => new Response(REPORT, { status: 207 }))
    const evs = await fetchEvents(ACCOUNT, 'https://x/c/', 0, 1, fetcher as never)
    expect(evs.every((e) => e.href === undefined)).toBe(true)
  })
})
