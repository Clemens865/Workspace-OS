import { CalDavError, type CalDavAccount } from './caldav-client'
import { buildEventIcs, type EventDraft } from './ics-write'

/**
 * Putting events ON a CalDAV server.
 *
 * Read landed first and proved the hard part — auth and the discovery walk.
 * This is the other half: an event created in the app has to arrive in Apple
 * Calendar and on the phone, or a "meeting" is a private note that nobody else
 * can see.
 *
 * Writes are conditional, always. CalDAV is a shared filesystem with several
 * clients on it, and an unconditional PUT is how two people editing the same
 * meeting silently overwrite each other. `If-None-Match: *` means "only if it
 * does not exist yet"; `If-Match: <etag>` means "only if it has not changed
 * since I read it". A 412 back is not a failure to hide — it is the server
 * saying somebody got there first, and the caller has to decide what to do.
 */

type Fetcher = typeof fetch

function auth(a: CalDavAccount): string {
  return 'Basic ' + Buffer.from(`${a.username}:${a.password}`).toString('base64')
}

/** The event's own address within a calendar collection. */
export function eventUrl(calendarUrl: string, uid: string): string {
  const base = calendarUrl.endsWith('/') ? calendarUrl : `${calendarUrl}/`
  return `${base}${encodeURIComponent(uid)}.ics`
}

export interface PutResult {
  url: string
  /** The server's new ETag, when it returns one — needed to edit this again. */
  etag: string | null
}

/**
 * Creates or replaces one event.
 *
 * `etag` present  → replace that exact version (If-Match).
 * `etag` absent   → create, and fail if something is already there (If-None-Match).
 */
export async function putEvent(
  account: CalDavAccount,
  calendarUrl: string,
  draft: EventDraft,
  opts: { etag?: string | null } = {},
  fetcher: Fetcher = fetch,
): Promise<PutResult> {
  // No METHOD on a stored document — see buildEventIcs.
  return putRawIcs(account, eventUrl(calendarUrl, draft.uid), buildEventIcs(draft), opts, fetcher)
}

/**
 * PUT an already-built calendar document — the edit path, where the body came
 * from rewriteEventIcs over the server's own bytes rather than from a draft.
 */
export async function putRawIcs(
  account: CalDavAccount,
  url: string,
  body: string,
  opts: { etag?: string | null } = {},
  fetcher: Fetcher = fetch,
): Promise<PutResult> {
  const headers: Record<string, string> = {
    Authorization: auth(account),
    'Content-Type': 'text/calendar; charset=utf-8',
  }
  if (opts.etag) headers['If-Match'] = opts.etag
  else headers['If-None-Match'] = '*'

  let res: Response
  try {
    res = await fetcher(url, { method: 'PUT', headers, body })
  } catch (e) {
    throw new CalDavError(`Could not reach the calendar server: ${(e as Error).message}`)
  }

  if (res.status === 401 || res.status === 403) {
    throw new CalDavError(
      'The server rejected these credentials. For iCloud/Fastmail use an app-specific password, not your account password.',
      res.status,
    )
  }
  if (res.status === 412) {
    throw new CalDavError(
      opts.etag
        ? 'That meeting changed somewhere else while you were editing it. Reload it and try again.'
        : 'An event with that id already exists on the server.',
      412,
    )
  }
  if (!res.ok) {
    const said = (await res.text().catch(() => ''))
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300)
    throw new CalDavError(
      `The calendar server returned ${res.status} for PUT ${url}` + (said ? ` — ${said}` : '.'),
      res.status,
    )
  }
  return { url, etag: res.headers.get('etag') }
}

/**
 * Removes an event.
 *
 * Conditional too: deleting a version you have not seen is how a reschedule
 * somebody else made disappears without either of you noticing.
 */
export async function deleteEvent(
  account: CalDavAccount,
  url: string,
  opts: { etag?: string | null } = {},
  fetcher: Fetcher = fetch,
): Promise<void> {
  const headers: Record<string, string> = { Authorization: auth(account) }
  if (opts.etag) headers['If-Match'] = opts.etag

  let res: Response
  try {
    res = await fetcher(url, { method: 'DELETE', headers })
  } catch (e) {
    throw new CalDavError(`Could not reach the calendar server: ${(e as Error).message}`)
  }
  // Already gone is the outcome the caller wanted.
  if (res.status === 404 || res.status === 410) return
  if (res.status === 401 || res.status === 403) {
    throw new CalDavError('The server rejected these credentials.', res.status)
  }
  if (res.status === 412) {
    throw new CalDavError('That meeting changed somewhere else. Reload it and try again.', 412)
  }
  if (!res.ok) throw new CalDavError(`The calendar server returned ${res.status} for DELETE.`, res.status)
}
