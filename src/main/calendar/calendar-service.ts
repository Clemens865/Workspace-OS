import {
  discoverCalendars,
  discoverIdentity,
  fetchEvents,
  fetchEventRaw,
  fetchIcsFeed,
  CalDavError,
  type CalDavAccount,
  type CalendarCollection,
} from './caldav-client'
import { deleteEvent, putEvent, putRawIcs } from './caldav-write'
import {
  addExdateIcs, rewriteEventIcs, rewriteOccurrenceIcs, rewriteSeriesIcs,
  type EventEdit, type SeriesEdit,
} from './ics-write'
import { chooseWriteTarget, targetsForSource, LOCAL_TARGET, type TargetChoice, type WriteTarget } from './write-target'
import { newUid } from './local-calendar'
import type { EventDraft } from './ics-write'
import { eventsInRange, type CalendarEvent } from './ics'
import { isOAuthKind, type CalendarSource, type CalendarSourceStore } from './account-store'
import {
  listGoogleCalendars, fetchGoogleEvents, listGraphCalendars, fetchGraphEvents,
} from './cloud-providers'

/**
 * Mints an access token for an OAuth source from its stored refresh token.
 * Injected so the service stays unit-testable without the OAuth stack, and so
 * the token never has to be cached on disk — it lives for one request.
 */
export type AccessTokenFor = (source: CalendarSource, refreshToken: string) => Promise<string>

/**
 * Reads the user's calendars: resolves each stored source to its events for a
 * window, expands recurrence, and merges everything into one time-ordered list.
 *
 * One source failing must never blank the whole calendar — a stale token on one
 * account, or a shared .ics feed that 404s, should cost you that source and
 * nothing else. So every source is fetched independently and its failure is
 * returned as a per-source `error` alongside whatever else succeeded. The surface
 * can then show "your work calendar is here, this one needs attention", which is
 * the honest read and the actionable one.
 */

export interface CalendarSourceStatus {
  id: string
  displayName: string
  /** Present when this source failed; the calendar still shows the others. */
  error?: string
  /** Discovered collections for a caldav source (empty for an ics feed). */
  calendars?: CalendarCollection[]
}

export interface CalendarView {
  events: CalendarEvent[]
  sources: CalendarSourceStatus[]
}

/** A colour per source so merged events stay visually attributable. */
export interface CalendarEventWithSource extends CalendarEvent {
  sourceId: string
  color?: string
  /** Server identity for CalDAV events — what makes edit and delete possible. */
  href?: string
  etag?: string | null
  calendarUrl?: string
}

function messageOf(e: unknown): string {
  if (e instanceof CalDavError) return e.message
  return (e as Error)?.message ?? 'Unknown error'
}

/** Fetch one source's raw events for the window. */
async function readSource(
  source: CalendarSource,
  store: CalendarSourceStore,
  from: number,
  to: number,
  accessTokenFor?: AccessTokenFor,
): Promise<{ events: CalendarEventWithSource[]; status: CalendarSourceStatus }> {
  const status: CalendarSourceStatus = { id: source.id, displayName: source.displayName }
  try {
    if (source.kind === 'ics') {
      const raw = await fetchIcsFeed(source.url)
      return { events: raw.map((e) => ({ ...e, sourceId: source.id })), status }
    }
    if (isOAuthKind(source.kind)) {
      const refresh = await store.getSecret(source.id)
      if (!refresh || !accessTokenFor) {
        return { events: [], status: { ...status, error: 'Sign-in unavailable — reconnect this calendar.' } }
      }
      const token = await accessTokenFor(source, refresh)
      const collections = source.kind === 'google' ? await listGoogleCalendars(token) : await listGraphCalendars(token)
      const picked = source.enabledCalendars?.length
        ? collections.filter((c) => source.enabledCalendars!.includes(c.url))
        : collections
      const cloud: CalendarEventWithSource[] = []
      for (const cal of picked) {
        const raw = source.kind === 'google'
          ? await fetchGoogleEvents(token, cal.url, from, to, source.id)
          : await fetchGraphEvents(token, cal.url, from, to, source.id)
        for (const e of raw) cloud.push({ ...e, sourceId: source.id, ...(cal.color ? { color: cal.color } : {}) })
      }
      return { events: cloud, status: { ...status, calendars: collections } }
    }

    const password = await store.getSecret(source.id)
    if (!password) {
      // The record survived but the keychain entry did not (copied profile,
      // rotated key). Say that, rather than reporting a network problem.
      return { events: [], status: { ...status, error: 'Password unavailable — reconnect this calendar.' } }
    }
    const account = { url: source.url, username: source.username ?? '', password }
    const collections = await discoverCalendars(account)
    const enabled = source.enabledCalendars?.length
      ? collections.filter((c) => source.enabledCalendars!.includes(c.url))
      : collections
    const out: CalendarEventWithSource[] = []
    // Sequential on purpose: these hit one server, and a burst of parallel
    // REPORTs is how you get rate-limited by iCloud.
    for (const cal of enabled) {
      const raw = await fetchEvents(account, cal.url, from, to)
      for (const e of raw) out.push({ ...e, sourceId: source.id, ...(cal.color ? { color: cal.color } : {}) })
    }
    return { events: out, status: { ...status, calendars: collections } }
  } catch (e) {
    return { events: [], status: { ...status, error: messageOf(e) } }
  }
}

/**
 * The merged calendar for [from, to). Sources are read CONCURRENTLY (different
 * servers, no reason to queue) while each source's own calendars are read in
 * sequence.
 */
export async function readCalendar(
  store: CalendarSourceStore,
  from: number,
  to: number,
  accessTokenFor?: AccessTokenFor,
): Promise<{ events: CalendarEventWithSource[]; sources: CalendarSourceStatus[] }> {
  const sources = await store.list()
  const results = await Promise.all(sources.map((s) => readSource(s, store, from, to, accessTokenFor)))
  const raw = results.flatMap((r) => r.events)
  // Expand recurrence and clip to the window, then re-attach source identity —
  // eventsInRange works on plain events, so carry the extras through by uid.
  // The server identity (href/etag) rides along too: it is what lets the
  // surface edit or delete the event later.
  const meta = new Map(raw.map((e) => [
    e.uid,
    { sourceId: e.sourceId, color: e.color, href: e.href, etag: e.etag, calendarUrl: e.calendarUrl },
  ]))
  const expanded = eventsInRange(raw, from, to).map((e) => {
    const m = meta.get(e.recurringUid ?? e.uid) ?? meta.get(e.uid)
    return {
      ...e,
      sourceId: m?.sourceId ?? '',
      ...(m?.color ? { color: m.color } : {}),
      ...(m?.href ? { href: m.href, etag: m.etag ?? null, calendarUrl: m.calendarUrl } : {}),
    }
  })
  return { events: expanded, sources: results.map((r) => r.status) }
}

/**
 * Verify credentials and report what would be connected, WITHOUT saving. The
 * connect dialog calls this first so a typo surfaces as "that failed, here's
 * why" rather than a saved account that silently never syncs.
 */
export async function testSource(input: {
  kind: 'caldav' | 'ics'
  url: string
  username?: string
  password?: string
}): Promise<{ ok: true; calendars: CalendarCollection[] } | { ok: false; error: string }> {
  try {
    if (input.kind === 'ics') {
      const events = await fetchIcsFeed(input.url)
      return { ok: true, calendars: [{ url: input.url, displayName: `${events.length} events` }] }
    }
    const calendars = await discoverCalendars({
      url: input.url,
      username: input.username ?? '',
      password: input.password ?? '',
    })
    if (calendars.length === 0) return { ok: false, error: 'Connected, but no calendars were found at that address.' }
    return { ok: true, calendars }
  } catch (e) {
    return { ok: false, error: messageOf(e) }
  }
}


/* ── writing an event ────────────────────────────────────────────────────── */

/**
 * Everywhere an event could be put.
 *
 * Only CalDAV sources contribute: an .ics feed is somebody else's URL, and the
 * Google/Microsoft paths were connected with read-only scopes, so offering
 * them would be offering a write that cannot happen.
 *
 * A source that cannot be reached is skipped rather than fatal. The person is
 * trying to put a meeting in a calendar; a broken second account should not
 * stop that, and it already shows its error in the calendar view.
 */
export async function writeTargets(store: CalendarSourceStore): Promise<WriteTarget[]> {
  const sources = await store.list()
  const out: WriteTarget[] = [LOCAL_TARGET]
  for (const source of sources) {
    if (source.kind !== 'caldav') continue
    try {
      const password = await store.getSecret(source.id)
      if (!password) continue
      const account = { url: source.url, username: source.username ?? '', password }
      const all = await discoverCalendars(account)
      const enabled = source.enabledCalendars?.length
        ? all.filter((c) => source.enabledCalendars!.includes(c.url))
        : all
      out.push(...targetsForSource(source, enabled))
    } catch {
      continue
    }
  }
  return out
}

/** Where a new event would go right now, and what else it could have gone to. */
export async function resolveWriteTarget(
  store: CalendarSourceStore,
  preferred?: string | null,
): Promise<TargetChoice> {
  return chooseWriteTarget(await writeTargets(store), preferred)
}

export interface EventInput {
  summary: string
  start: number
  end: number
  allDay?: boolean
  location?: string
  description?: string
  /** People to invite. The SERVER sends the invitations — see writeToCalDav. */
  attendees?: { email: string; name?: string }[]
}

/**
 * Puts an event on a CalDAV calendar, inviting anybody it names.
 *
 * The invitations are sent BY THE SERVER, not by this app. That is the whole
 * reason to write here rather than to the local file: iCloud already knows how
 * to send an invitation that Outlook and Gmail will render as one, how to
 * collect the replies, and how to tell everybody when the time changes. An app
 * that emailed its own .ics attachments would be reimplementing that badly and
 * would still not receive the RSVPs.
 *
 * The catch is that the server only does it for an event whose ORGANIZER is an
 * address it knows this account by — so the identity is fetched rather than
 * guessed from the username, which on iCloud is often not the address at all.
 * With attendees but no organizer we would write an event that quietly invites
 * nobody, so that case fails loudly instead.
 */
/** The stored credentials for one connected CalDAV source, or a said reason why not. */
async function accountFor(store: CalendarSourceStore, sourceId: string): Promise<CalDavAccount> {
  const source = await store.get(sourceId)
  if (!source) throw new Error('That calendar is no longer connected.')
  const password = await store.getSecret(source.id)
  if (!password) throw new Error('Password unavailable — reconnect this calendar.')
  return { url: source.url, username: source.username ?? '', password }
}

export async function writeToCalDav(
  store: CalendarSourceStore,
  target: WriteTarget,
  input: EventInput,
): Promise<{ uid: string; url: string; invited: string[] }> {
  if (!target.calendarUrl || !target.sourceId) throw new Error('That is not a server calendar.')
  const account = await accountFor(store, target.sourceId)

  const attendees = (input.attendees ?? []).filter((a) => a.email)
  let organizer: { email: string; name?: string } | undefined
  if (attendees.length > 0) {
    const identity = await discoverIdentity(account)
    const email = identity.addresses[0]
    if (!email) {
      throw new Error(
        'This account does not publish an email address, so the server cannot send invitations from it. The event was not created — add the people by hand, or schedule it without inviting anyone.',
      )
    }
    organizer = { email }
  }

  const draft: EventDraft = {
    uid: newUid(),
    summary: input.summary,
    start: input.start,
    end: input.end,
    ...(input.allDay ? { allDay: true } : {}),
    ...(input.location ? { location: input.location } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(organizer ? { organizer } : {}),
    ...(attendees.length ? { attendees: attendees.map((a) => ({ ...a, partstat: 'NEEDS-ACTION' as const })) } : {}),
  }
  const { url } = await putEvent(account, target.calendarUrl, draft)
  return { uid: draft.uid, url, invited: attendees.map((a) => a.email) }
}

/* ── editing and deleting an existing event ──────────────────────────────── */

/** The identity an edit/delete needs: which account, and the object's own URL. */
export interface CalDavEventRef {
  sourceId: string
  href: string
}

/**
 * Edits one event on its server, preserving whatever the edit form cannot see.
 *
 * The document is re-fetched first, always. The copy the surface read minutes
 * ago is not the copy on the server NOW — another client may have touched it —
 * so the rewrite is based on fresh bytes and the PUT is conditional on their
 * etag. A 412 means someone else got there in between: it surfaces as its own
 * message rather than being retried into an overwrite.
 *
 * Because attendees survive the rewrite and SEQUENCE is bumped, the server
 * sends the "this meeting moved" updates itself — same reason creation writes
 * here at all.
 */
/** GET the fresh copy, rewrite it, PUT it back conditionally. */
async function putRewritten(
  store: CalendarSourceStore,
  ref: CalDavEventRef,
  rewrite: (ics: string) => string,
): Promise<{ etag: string | null }> {
  const account = await accountFor(store, ref.sourceId)
  const current = await fetchEventRaw(account, ref.href)
  const res = await putRawIcs(account, ref.href, rewrite(current.ics), { etag: current.etag })
  return { etag: res.etag }
}

/**
 * Inviting people onto an EXISTING event needs an organizer the server knows,
 * exactly like creating one does ([[writeToCalDav]]). Only fetched when the
 * edit actually touches the invite list.
 */
async function organizerFor(store: CalendarSourceStore, sourceId: string): Promise<{ email: string }> {
  const account = await accountFor(store, sourceId)
  const identity = await discoverIdentity(account)
  const email = identity.addresses[0]
  if (!email) {
    throw new Error(
      'This account does not publish an email address, so the server cannot send invitations from it. The change was not saved.',
    )
  }
  return { email }
}

export async function updateOnCalDav(
  store: CalendarSourceStore,
  ref: CalDavEventRef,
  edit: EventEdit,
): Promise<{ etag: string | null }> {
  const withOrganizer: EventEdit = edit.attendees?.length
    ? { ...edit, organizer: await organizerFor(store, ref.sourceId) }
    : edit
  return putRewritten(store, ref, (ics) => rewriteEventIcs(ics, withOrganizer))
}

/** Edit ONE occurrence of a series (creates or updates its override VEVENT). */
export async function updateOccurrenceOnCalDav(
  store: CalendarSourceStore,
  ref: CalDavEventRef,
  occurrenceStart: number,
  edit: EventEdit,
): Promise<{ etag: string | null }> {
  return putRewritten(store, ref, (ics) => rewriteOccurrenceIcs(ics, occurrenceStart, edit))
}

/** Edit the whole series (text, and optionally its time of day). */
export async function updateSeriesOnCalDav(
  store: CalendarSourceStore,
  ref: CalDavEventRef,
  edit: SeriesEdit,
): Promise<{ etag: string | null }> {
  return putRewritten(store, ref, (ics) => rewriteSeriesIcs(ics, edit))
}

/** Delete ONE occurrence of a series — an EXDATE on the master. */
export async function deleteOccurrenceFromCalDav(
  store: CalendarSourceStore,
  ref: CalDavEventRef,
  occurrenceStart: number,
): Promise<{ etag: string | null }> {
  return putRewritten(store, ref, (ics) => addExdateIcs(ics, occurrenceStart))
}

/**
 * Deletes one event from its server.
 *
 * Conditional on the CURRENT etag (re-read, same reasoning as the edit). For a
 * meeting with attendees, the server turns this into the cancellation mails —
 * deleting locally-cached copies could never tell anybody.
 */
export async function deleteFromCalDav(store: CalendarSourceStore, ref: CalDavEventRef): Promise<void> {
  const account = await accountFor(store, ref.sourceId)
  let etag: string | null = null
  try {
    etag = (await fetchEventRaw(account, ref.href)).etag
  } catch (e) {
    // Already gone is the outcome the caller wanted.
    if (e instanceof CalDavError && (e.status === 404 || e.status === 410)) return
    throw e
  }
  await deleteEvent(account, ref.href, { etag })
}
