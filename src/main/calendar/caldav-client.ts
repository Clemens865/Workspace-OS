import { parseIcs, type CalendarEvent } from './ics'

/**
 * Minimal CalDAV (RFC 4791) client — discovery + a time-bounded event fetch.
 *
 * Written against `fetch` rather than a dependency: CalDAV is HTTP with two extra
 * verbs (PROPFIND, REPORT) and small XML bodies, and the alternative libraries
 * pull in an XML stack for what amounts to four requests. Keeping it here also
 * keeps the network shape auditable, which matters for a surface that holds
 * someone's whole schedule.
 *
 * Auth is HTTP Basic over HTTPS. That is what iCloud, Fastmail and Nextcloud
 * expect with an app-specific password, and app passwords are the right unit of
 * trust here: revocable, scoped to one service, never the account password.
 *
 * The XML parsing is deliberately shallow — regex over well-known element names
 * rather than a DOM. CalDAV responses are machine-generated and shallow, and the
 * one field we cannot afford to misread (the event body) is handed to the real
 * iCalendar parser. Anything unrecognised is skipped, never guessed at.
 */

export interface CalDavAccount {
  /** Server base or collection URL, e.g. https://caldav.icloud.com */
  url: string
  username: string
  password: string
}

export interface CalendarCollection {
  /** Absolute URL of the calendar collection. */
  url: string
  displayName: string
  /** The colour the server suggests, when it sends one (#rrggbb). */
  color?: string
  /**
   * True only when the server SAID this calendar cannot be written to.
   *
   * A subscribed calendar — holidays, a colleague's shared read-only feed — is
   * a normal thing to have on iCloud, and putting an event in one fails with a
   * 403 after the person has already been told it was scheduled. Absence of the
   * privilege set means unknown, and unknown is treated as writable: refusing
   * to write to a server that simply did not answer the question would be worse
   * than trying and reporting the real error.
   */
  readOnly?: boolean
}

/** Who the account is, in the terms the server will accept as an organizer. */
export interface CalDavIdentity {
  principalUrl: string
  /** Every address the server considers this user — mailto: values, unprefixed. */
  addresses: string[]
}

export class CalDavError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'CalDavError'
  }
}

const PROPFIND_CALENDARS =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
  '<d:prop><d:resourcetype/><d:displayname/><cs:calendar-color/><c:supported-calendar-component-set/><d:current-user-privilege-set/></d:prop>' +
  '</d:propfind>'

const PROPFIND_HOME =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
  '<d:prop><c:calendar-home-set/><d:current-user-principal/></d:prop>' +
  '</d:propfind>'

const PROPFIND_IDENTITY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
  '<d:prop><c:calendar-user-address-set/><d:current-user-principal/></d:prop>' +
  '</d:propfind>'

function basicAuth(a: CalDavAccount): string {
  return 'Basic ' + Buffer.from(`${a.username}:${a.password}`).toString('base64')
}

/** Absolutise a server-relative href against the request URL. */
export function resolveHref(base: string, href: string): string {
  try {
    return new URL(href, base).toString()
  } catch {
    return href
  }
}

/** iCalendar UTC stamp for a CalDAV time-range filter. */
export function icsStamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  )
}

/** Split a multistatus body into its <response> chunks (namespace-agnostic). */
export function splitResponses(xml: string): string[] {
  return xml.match(/<[a-zA-Z0-9]*:?response[\s>][\s\S]*?<\/[a-zA-Z0-9]*:?response>/g) ?? []
}

/** First text content of a named element, namespace-agnostic. */
export function pickTag(xml: string, local: string): string | null {
  const re = new RegExp(`<[a-zA-Z0-9]*:?${local}[^>]*>([\\s\\S]*?)</[a-zA-Z0-9]*:?${local}>`, 'i')
  const m = re.exec(xml)
  return m ? m[1].trim() : null
}

/** Does this element appear at all (possibly self-closing)? */
export function hasTag(xml: string, local: string): boolean {
  return new RegExp(`<[a-zA-Z0-9]*:?${local}[\\s/>]`, 'i').test(xml)
}

/** Decode the XML entities that appear in DAV text nodes. */
export function decodeXmlText(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&') // last, so &amp;lt; doesn't become <
}

/**
 * Parse a calendar-listing multistatus into collections.
 *
 * Only collections that are `<calendar>` AND advertise VEVENT support are kept —
 * a CalDAV home also contains address books, task lists and the home itself, and
 * offering those as calendars would be a confusing lie. A collection that names
 * no component set is kept, since many servers omit it and mean "everything".
 */
export function parseCalendarList(xml: string, baseUrl: string): CalendarCollection[] {
  const out: CalendarCollection[] = []
  for (const chunk of splitResponses(xml)) {
    if (!hasTag(chunk, 'calendar')) continue
    const comps = chunk.match(/<[a-zA-Z0-9]*:?comp\s[^>]*name="([^"]+)"/gi) ?? []
    if (comps.length > 0 && !comps.some((c) => /name="VEVENT"/i.test(c))) continue
    const href = pickTag(chunk, 'href')
    if (!href) continue
    const name = pickTag(chunk, 'displayname')
    const color = pickTag(chunk, 'calendar-color')
    // Only claim read-only when the server actually answered the question.
    const privs = pickTag(chunk, 'current-user-privilege-set')
    const readOnly = privs !== null && !/<[a-zA-Z0-9]*:?(write-content|write|all)\s*\/?>/i.test(privs)
    out.push({
      url: resolveHref(baseUrl, decodeXmlText(href)),
      displayName: name ? decodeXmlText(name) : 'Calendar',
      ...(color ? { color: decodeXmlText(color).slice(0, 7) } : {}),
      ...(readOnly ? { readOnly: true } : {}),
    })
  }
  return out
}

/** Extract every calendar-data payload from a REPORT multistatus. */
export function parseCalendarData(xml: string): string[] {
  return parseReportEntries(xml).map((e) => e.ics)
}

/** One REPORT response: the event document plus its server identity. */
export interface ReportEntry {
  /** The object's own address — what an edit PUTs to and a delete DELETEs. */
  href: string
  /** Version marker for conditional writes; null when the server omitted it. */
  etag: string | null
  ics: string
}

/**
 * Parse a REPORT multistatus keeping each payload PAIRED with its href/etag.
 *
 * The href is the one thing that makes an event editable later: object names on
 * a server are arbitrary (Apple Calendar does not name files `<uid>.ics`), so
 * an edit that guessed the URL from the UID would 404 against most real data.
 */
export function parseReportEntries(xml: string): ReportEntry[] {
  const out: ReportEntry[] = []
  for (const chunk of splitResponses(xml)) {
    const data = /<[a-zA-Z0-9]*:?calendar-data[^>]*>([\s\S]*?)<\/[a-zA-Z0-9]*:?calendar-data>/i.exec(chunk)
    if (!data) continue
    const href = pickTag(chunk, 'href')
    const etag = pickTag(chunk, 'getetag')
    out.push({
      href: href ? decodeXmlText(href) : '',
      etag: etag ? decodeXmlText(etag) : null,
      ics: decodeXmlText(data[1]),
    })
  }
  return out
}

type Fetcher = typeof fetch

async function dav(
  account: CalDavAccount,
  url: string,
  method: 'PROPFIND' | 'REPORT',
  body: string,
  depth: '0' | '1',
  fetcher: Fetcher,
): Promise<string> {
  let res: Response
  try {
    res = await fetcher(url, {
      method,
      headers: {
        Authorization: basicAuth(account),
        'Content-Type': 'application/xml; charset=utf-8',
        Depth: depth,
      },
      body,
    })
  } catch (e) {
    // A DNS/TLS/offline failure — say which, since "failed" alone sends people
    // hunting for a wrong password.
    throw new CalDavError(`Could not reach the calendar server: ${(e as Error).message}`)
  }
  if (res.status === 401 || res.status === 403) {
    throw new CalDavError('The server rejected these credentials. For iCloud/Fastmail use an app-specific password, not your account password.', res.status)
  }
  if (!res.ok && res.status !== 207) {
    /**
     * Say WHICH request failed and WHAT the server said about it.
     *
     * This used to be `returned 400.` and nothing else — with the response body
     * read and dropped. A CalDAV server explains itself in that body, so the
     * one piece of evidence that identifies the problem was being discarded at
     * the exact moment it was needed, leaving nothing to debug with but a
     * number. The url matters too: the discovery walk makes three requests to
     * three different addresses, and "400" alone does not say which hop died.
     */
    const detail = await res.text().catch(() => '')
    const said = detail
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300)
    throw new CalDavError(
      `The calendar server returned ${res.status} for ${method} ${url}` + (said ? ` — ${said}` : '.'),
      res.status,
    )
  }
  return res.text()
}

/**
 * Find the account's calendars.
 *
 * Tries the given URL directly first: users commonly paste a collection URL
 * straight from their provider's settings, and that already works. Only if it
 * yields nothing do we walk the discovery chain (current-user-principal →
 * calendar-home-set → list), which is what a bare hostname needs.
 */
export async function discoverCalendars(
  account: CalDavAccount,
  fetcher: Fetcher = fetch,
): Promise<CalendarCollection[]> {
  /**
   * The direct attempt is OPTIONAL, not fatal.
   *
   * Listing calendars is a Depth:1 PROPFIND, which only means something if the
   * url already points AT a calendar home. Against a server root it is
   * meaningless — and iCloud answers 400, which used to abort the connection
   * with "the calendar server returned 400" before the discovery walk that
   * would have worked was ever attempted. Authentication had already succeeded
   * by then, so the message sent people hunting for a password problem they did
   * not have.
   *
   * A failure here now just means "not that kind of url", and discovery
   * continues. Servers whose root does serve the list still short-circuit.
   * Only a credentials error is re-thrown, because trying three more times with
   * a wrong password helps nobody.
   */
  try {
    const direct = parseCalendarList(
      await dav(account, account.url, 'PROPFIND', PROPFIND_CALENDARS, '1', fetcher),
      account.url,
    )
    if (direct.length > 0) return direct
  } catch (e) {
    // A credentials failure is worth surfacing immediately; anything else just
    // means this url is not a calendar home, so carry on and discover.
    if (e instanceof CalDavError && (e.status === 401 || e.status === 403)) throw e
  }

  /**
   * The canonical walk: root → principal → calendar home → calendars.
   *
   * The order matters, and getting it wrong is what iCloud answers 400 to. A
   * root advertises only `current-user-principal`; the calendar home lives on
   * the PRINCIPAL, not on the root. This code used to take whichever of the two
   * it found and immediately run a Depth:1 listing against it — so on iCloud it
   * tried to enumerate the principal collection, which is precisely the thing a
   * server refuses. Asking the principal for its home first (Depth:0) is one
   * extra request and the difference between working and not.
   */
  const rootXml = await dav(account, account.url, 'PROPFIND', PROPFIND_HOME, '0', fetcher)

  const hrefIn = (xml: string | null): string | null => {
    if (!xml) return null
    const inner = pickTag(xml, 'href') ?? xml
    return inner ? decodeXmlText(inner).trim() : null
  }

  let homeUrl: string | null = null
  const rootHome = hrefIn(pickTag(rootXml, 'calendar-home-set'))
  if (rootHome) {
    homeUrl = resolveHref(account.url, rootHome)
  } else {
    // Only a principal: ask IT where the calendars live.
    const principal = hrefIn(pickTag(rootXml, 'current-user-principal'))
    if (!principal) {
      throw new CalDavError('No calendars found at that address, and the server did not advertise a calendar home.')
    }
    const principalUrl = resolveHref(account.url, principal)
    const principalXml = await dav(account, principalUrl, 'PROPFIND', PROPFIND_HOME, '0', fetcher)
    const home = hrefIn(pickTag(principalXml, 'calendar-home-set'))
    if (!home) {
      throw new CalDavError('Signed in, but that account does not advertise a calendar home.')
    }
    homeUrl = resolveHref(principalUrl, home)
  }

  return parseCalendarList(
    await dav(account, homeUrl, 'PROPFIND', PROPFIND_CALENDARS, '1', fetcher),
    homeUrl,
  )
}

/**
 * Every address the server accepts as "this user".
 *
 * Needed before an event can invite anybody. The server sends the invitations
 * — that is the whole reason to write there rather than to a local file — but
 * it only does so for an event whose ORGANIZER is one of the addresses it
 * knows this account by. Put someone else's address there, or a plausible
 * guess, and iCloud either rejects the write or accepts it and silently sends
 * nothing, which is the worse of the two.
 */
export async function discoverIdentity(
  account: CalDavAccount,
  fetcher: Fetcher = fetch,
): Promise<CalDavIdentity> {
  const hrefIn = (xml: string | null): string | null => {
    if (!xml) return null
    const inner = pickTag(xml, 'href') ?? xml
    return inner ? decodeXmlText(inner).trim() : null
  }

  const rootXml = await dav(account, account.url, 'PROPFIND', PROPFIND_IDENTITY, '0', fetcher)
  const principal = hrefIn(pickTag(rootXml, 'current-user-principal'))
  const principalUrl = principal ? resolveHref(account.url, principal) : account.url

  // The address set usually lives on the principal, not on the root.
  let xml = rootXml
  if (!pickTag(rootXml, 'calendar-user-address-set') && principal) {
    xml = await dav(account, principalUrl, 'PROPFIND', PROPFIND_IDENTITY, '0', fetcher)
  }

  const block = pickTag(xml, 'calendar-user-address-set') ?? ''
  const addresses: string[] = []
  for (const m of block.matchAll(/<[a-zA-Z0-9]*:?href[^>]*>([\s\S]*?)<\/[a-zA-Z0-9]*:?href>/gi)) {
    const v = decodeXmlText(m[1]).trim()
    // urn:uuid: forms are the principal's own id, not something to put in a
    // mailto — an invitation needs a real address.
    if (/^mailto:/i.test(v)) addresses.push(v.replace(/^mailto:/i, ''))
  }
  return { principalUrl, addresses }
}

/**
 * Fetch the events of one calendar overlapping [from, to).
 *
 * The time-range filter is applied server-side so a decade-old calendar does not
 * arrive in full. Recurring events still need local expansion (the server returns
 * the master VEVENT plus its rule), which `eventsInRange` handles.
 */
export interface FetchedEvent extends CalendarEvent {
  /** Server identity, present on events read over CalDAV — what makes an edit possible. */
  href?: string
  etag?: string | null
  calendarUrl?: string
}

export async function fetchEvents(
  account: CalDavAccount,
  calendarUrl: string,
  from: number,
  to: number,
  fetcher: Fetcher = fetch,
): Promise<FetchedEvent[]> {
  const body =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
    '<d:prop><d:getetag/><c:calendar-data/></d:prop>' +
    '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">' +
    `<c:time-range start="${icsStamp(from)}" end="${icsStamp(to)}"/>` +
    '</c:comp-filter></c:comp-filter></c:filter>' +
    '</c:calendar-query>'
  const xml = await dav(account, calendarUrl, 'REPORT', body, '1', fetcher)
  const out: FetchedEvent[] = []
  for (const entry of parseReportEntries(xml)) {
    const ident = entry.href
      ? { href: resolveHref(calendarUrl, entry.href), etag: entry.etag, calendarUrl }
      : {}
    for (const e of parseIcs(entry.ics)) out.push({ ...e, ...ident })
  }
  return out
}

/**
 * Read one event document by its own address — the fresh copy an edit starts
 * from. Editing the version we cached at read time would base the rewrite on
 * stale bytes and lose whatever changed elsewhere since.
 */
export async function fetchEventRaw(
  account: CalDavAccount,
  url: string,
  fetcher: Fetcher = fetch,
): Promise<{ ics: string; etag: string | null }> {
  let res: Response
  try {
    res = await fetcher(url, {
      headers: { Authorization: basicAuth(account), Accept: 'text/calendar, */*' },
    })
  } catch (e) {
    throw new CalDavError(`Could not reach the calendar server: ${(e as Error).message}`)
  }
  if (res.status === 404 || res.status === 410) {
    throw new CalDavError('That event no longer exists on the server — it may have been deleted elsewhere.', res.status)
  }
  if (res.status === 401 || res.status === 403) {
    throw new CalDavError('The server rejected these credentials.', res.status)
  }
  if (!res.ok) throw new CalDavError(`The calendar server returned ${res.status} reading the event.`, res.status)
  return { ics: await res.text(), etag: res.headers.get('etag') }
}

/**
 * Read a plain `.ics` subscription URL (webcal or https). No auth, no CalDAV —
 * the read-only half of "bring your own calendar", and the path most shared
 * team/holiday calendars take.
 */
export async function fetchIcsFeed(url: string, fetcher: Fetcher = fetch): Promise<CalendarEvent[]> {
  const https = url.replace(/^webcal:\/\//i, 'https://')
  let res: Response
  try {
    res = await fetcher(https, { headers: { Accept: 'text/calendar, text/plain, */*' } })
  } catch (e) {
    throw new CalDavError(`Could not fetch that calendar feed: ${(e as Error).message}`)
  }
  if (!res.ok) throw new CalDavError(`The calendar feed returned ${res.status}.`, res.status)
  return parseIcs(await res.text())
}
