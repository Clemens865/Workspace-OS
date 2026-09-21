import { describe, it, expect, vi } from 'vitest'
import { putEvent, deleteEvent, eventUrl } from './caldav-write'
import { parseIcs } from './ics'

/**
 * Writing to a shared calendar.
 *
 * The tests that matter here are the conditional ones. CalDAV is a filesystem
 * with several clients on it, and an unconditional write is how two people
 * editing the same meeting overwrite each other silently. A 412 is the server
 * doing its job, not an error to paper over.
 */

const ACCOUNT = { url: 'https://dav.example.com/', username: 'u', password: 'p' }
const CAL = 'https://dav.example.com/1234/calendars/home/'
const DRAFT = {
  uid: 'wos-abc@workspace-os',
  summary: 'Second round — ALPLA',
  start: Date.UTC(2026, 7, 20, 9, 0),
  end: Date.UTC(2026, 7, 20, 10, 0),
}

const ok = (etag = '"v1"') =>
  vi.fn(async (_url: unknown, _init: FetchInit) => new Response('', { status: 201, headers: { etag } }))

/** The shape of the second argument to fetch, so `mock.calls` is typed. */
type FetchInit = { method?: string; body?: unknown; headers?: Record<string, string> }

describe('putEvent', () => {
  it('writes the event where the calendar can find it', async () => {
    const f = ok()
    const r = await putEvent(ACCOUNT, CAL, DRAFT, {}, f as never)
    expect(r.url).toBe(`${CAL}wos-abc%40workspace-os.ics`)
    expect(r.etag).toBe('"v1"')
    expect(f.mock.calls[0][1].method).toBe('PUT')
  })

  it('sends a document the parser reads back', async () => {
    const f = ok()
    await putEvent(ACCOUNT, CAL, DRAFT, {}, f as never)
    const body = String(f.mock.calls[0][1].body)
    const [ev] = parseIcs(body)
    expect(ev.summary).toBe('Second round — ALPLA')
    expect(ev.start).toBe(DRAFT.start)
  })

  /** A stored document must not look like an incoming invitation. */
  it('does not put a METHOD on a stored event', async () => {
    const f = ok()
    await putEvent(ACCOUNT, CAL, DRAFT, {}, f as never)
    expect(String(f.mock.calls[0][1].body)).not.toContain('METHOD:')
  })

  it('creates only when nothing is there yet', async () => {
    const f = ok()
    await putEvent(ACCOUNT, CAL, DRAFT, {}, f as never)
    const h = f.mock.calls[0][1].headers as Record<string, string>
    expect(h['If-None-Match']).toBe('*')
    expect(h['If-Match']).toBeUndefined()
  })

  it('replaces only the exact version it was given', async () => {
    const f = ok()
    await putEvent(ACCOUNT, CAL, DRAFT, { etag: '"v1"' }, f as never)
    const h = f.mock.calls[0][1].headers as Record<string, string>
    expect(h['If-Match']).toBe('"v1"')
    expect(h['If-None-Match']).toBeUndefined()
  })

  /**
   * The whole point of the conditional write: say plainly that somebody else
   * moved it, rather than overwriting them or reporting a bare 412.
   */
  it('explains a lost race in terms a person can act on', async () => {
    const f = vi.fn(async () => new Response('', { status: 412 }))
    await expect(putEvent(ACCOUNT, CAL, DRAFT, { etag: '"old"' }, f as never)).rejects.toThrow(
      /changed somewhere else/,
    )
  })

  it('distinguishes a collision on CREATE from one on update', async () => {
    const f = vi.fn(async () => new Response('', { status: 412 }))
    await expect(putEvent(ACCOUNT, CAL, DRAFT, {}, f as never)).rejects.toThrow(/already exists/)
  })

  it('names app-specific passwords on a 401', async () => {
    const f = vi.fn(async () => new Response('', { status: 401 }))
    await expect(putEvent(ACCOUNT, CAL, DRAFT, {}, f as never)).rejects.toThrow(/app-specific password/)
  })

  it('repeats what the server said on any other failure', async () => {
    const f = vi.fn(async () => new Response('<err>calendar is read-only</err>', { status: 403 }))
    // 403 is a credentials message; use 400 for the detail path.
    const f2 = vi.fn(async () => new Response('<err>bad DTEND</err>', { status: 400 }))
    await expect(putEvent(ACCOUNT, CAL, DRAFT, {}, f2 as never)).rejects.toThrow(/bad DTEND/)
    await expect(putEvent(ACCOUNT, CAL, DRAFT, {}, f as never)).rejects.toThrow(/credentials/)
  })

  it('carries attendees and the organizer when the meeting has them', async () => {
    const f = ok()
    await putEvent(
      ACCOUNT,
      CAL,
      { ...DRAFT, organizer: { email: 'me@example.com' }, attendees: [{ email: 'her@example.com', name: 'Anna Weber' }] },
      {},
      f as never,
    )
    const body = String(f.mock.calls[0][1].body)
    expect(body).toContain('ORGANIZER:mailto:me@example.com')
    expect(body).toContain('ATTENDEE;CN=Anna Weber')
    expect(body).toContain('PARTSTAT=NEEDS-ACTION')
  })

  /** Without a bumped SEQUENCE a moved meeting arrives as a duplicate. */
  it('sends the sequence it was given', async () => {
    const f = ok()
    await putEvent(ACCOUNT, CAL, { ...DRAFT, sequence: 3 }, { etag: '"v1"' }, f as never)
    expect(String(f.mock.calls[0][1].body)).toContain('SEQUENCE:3')
  })
})

describe('deleteEvent', () => {
  it('treats an already-deleted event as success', async () => {
    for (const status of [404, 410]) {
      const f = vi.fn(async () => new Response('', { status }))
      await expect(deleteEvent(ACCOUNT, eventUrl(CAL, 'x'), {}, f as never)).resolves.toBeUndefined()
    }
  })

  it('deletes only the version it was given', async () => {
    // 204 must carry a null body — `new Response('', {status:204})` throws.
    const f = vi.fn(async (_url: unknown, _init: FetchInit) => new Response(null, { status: 204 }))
    await deleteEvent(ACCOUNT, eventUrl(CAL, 'x'), { etag: '"v2"' }, f as never)
    expect((f.mock.calls[0][1].headers ?? {})['If-Match']).toBe('"v2"')
  })

  it('refuses to silently discard somebody else\'s change', async () => {
    const f = vi.fn(async () => new Response('', { status: 412 }))
    await expect(deleteEvent(ACCOUNT, eventUrl(CAL, 'x'), { etag: '"old"' }, f as never)).rejects.toThrow(
      /changed somewhere else/,
    )
  })
})
