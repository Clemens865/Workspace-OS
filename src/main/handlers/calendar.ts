import { IpcMain, app } from 'electron'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError } from '../ipc-validator'
import { CalendarSourceStore, type CalendarSourceKind } from '../calendar/account-store'
import { safeSecretStore } from '../mail/safe-secret-store'
import {
  readCalendar,
  testSource,
  resolveWriteTarget,
  writeToCalDav,
  updateOnCalDav,
  updateOccurrenceOnCalDav,
  updateSeriesOnCalDav,
  deleteFromCalDav,
  deleteOccurrenceFromCalDav,
  type AccessTokenFor,
} from '../calendar/calendar-service'
import { isOAuthKind } from '../calendar/account-store'
import { runGoogleOAuthFlow, runMicrosoftOAuthFlow } from '../mail/oauth/oauth-flow'
import { refreshAccessToken as refreshGoogle, EMAIL_SCOPE } from '../mail/oauth/google-oauth'
import { refreshAccessToken as refreshMicrosoft } from '../mail/oauth/microsoft-oauth'
import { resolveGoogleClientId, resolveMicrosoftClientId } from '../mail/oauth/client-config'
import { GOOGLE_CALENDAR_SCOPE, MS_CALENDAR_SCOPE } from '../calendar/cloud-providers'
import { listGoogleCalendars, listGraphCalendars } from '../calendar/cloud-providers'
import { addLocal, readLocal, removeLocal, updateLocal } from '../calendar/local-calendar'
import { getWorkspaceRoot } from '../workspace-root'

/** Source id for events this app owns, so the UI can tell them apart. */
const LOCAL_SOURCE_ID = 'workspace-os-local'

/**
 * The agent's calendar, over `wos-action run calendar.createEvent`.
 *
 * Routes through the SAME write-target choice as the UI's New-event dialog —
 * the capability catalog promises agents "whichever calendar the person chose",
 * and this is what makes that sentence true. The one thing an agent never does
 * is answer the which-calendar question itself: with several calendars and no
 * remembered choice the call fails and says so, because a meeting in the wrong
 * calendar is one nobody finds.
 */
export async function runCalendarAction(
  actionId: string,
  args: unknown,
): Promise<{ ok: true; result?: unknown } | { ok: false; error: string }> {
  if (actionId !== 'calendar.createEvent') {
    return { ok: false, error: `unknown calendar action: ${actionId}` }
  }
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
  const summary = typeof a.summary === 'string' ? a.summary.trim() : ''
  if (!summary) return { ok: false, error: 'calendar.createEvent needs a summary' }
  const start = Number(a.start)
  if (!Number.isFinite(start)) {
    return { ok: false, error: 'calendar.createEvent needs a start time in epoch milliseconds' }
  }
  const end = Number(a.end)
  try {
    const store = getStore()
    const choice = await resolveWriteTarget(store, await store.getDefaultTarget())
    if (!choice.target) {
      return {
        ok: false,
        error:
          'there is more than one calendar and the person has not chosen one yet — ask them to create one event from the Calendar surface first (that answer is remembered), or to say which calendar this should go in',
      }
    }
    if (choice.implied) await store.setDefaultTarget(choice.target.id)

    const input = {
      summary,
      start,
      end: Number.isFinite(end) ? end : start,
      allDay: a.allDay === true,
      location: typeof a.location === 'string' ? a.location : undefined,
      description: typeof a.description === 'string' ? a.description : undefined,
    }

    if (choice.target.kind === 'caldav') {
      const written = await writeToCalDav(store, choice.target, input)
      return {
        ok: true,
        result: { uid: written.uid, start: input.start, end: input.end, calendar: choice.target.label },
      }
    }
    const root = getWorkspaceRoot()
    if (!root) return { ok: false, error: 'no workspace folder is open' }
    const ev = addLocal(root, input)
    return { ok: true, result: { uid: ev.uid, start: ev.start, end: ev.end, calendar: choice.target.label } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'could not create the event' }
  }
}

/**
 * Calendar IPC — connect a CalDAV account or .ics feed, list sources, read a
 * window of merged events.
 *
 * Validation notes: a URL from the renderer becomes an outbound request, so the
 * scheme is restricted to http(s)/webcal. Without that, `file://` would turn the
 * connect dialog into a local-file reader, which is exactly the shape of bug this
 * boundary exists to stop.
 */

/** Node fetch adapter matching the OAuth modules' FetchFn shape. */
const nodeFetch = ((url: string, init?: RequestInit) => fetch(url, init)) as never

/**
 * Access tokens are minted per request from the stored refresh token and never
 * written to disk. They are cached in memory only for their lifetime, so a burst
 * of calendar reads costs one refresh rather than one per calendar.
 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>()

const accessTokenFor: AccessTokenFor = async (source, refreshToken) => {
  const hit = tokenCache.get(source.id)
  if (hit && Date.now() < hit.expiresAt - 60_000) return hit.token
  const clientId = source.kind === 'google'
    ? resolveGoogleClientId(app.getPath('userData'))
    : resolveMicrosoftClientId(app.getPath('userData'))
  if (!clientId) throw new Error('This build has no OAuth client id configured for that provider.')
  const res = source.kind === 'google'
    ? await refreshGoogle(clientId, refreshToken, nodeFetch)
    : await refreshMicrosoft(clientId, refreshToken, nodeFetch)
  if (!res.ok) throw new Error('Could not refresh the sign-in — reconnect this calendar.')
  tokenCache.set(source.id, { token: res.value.accessToken, expiresAt: res.value.expiresAt })
  return res.value.accessToken
}

let store: CalendarSourceStore | null = null
function getStore(): CalendarSourceStore {
  if (!store) store = new CalendarSourceStore(app.getPath('userData'), safeSecretStore)
  return store
}

/** The calendar source store, for the Connectors page (list + remove; never a secret). */
export function calendarSourceStore(): CalendarSourceStore {
  return getStore()
}

/**
 * Can this cloud calendar still get an access token? For the Connectors page.
 * `unconfigured` when the provider has no client id; `skip` for CalDAV/ICS.
 */
export async function probeCalendarSource(sourceId: string): Promise<'ok' | 'fail' | 'unconfigured' | 'skip'> {
  const source = await getStore().get(sourceId)
  if (!source || !isOAuthKind(source.kind)) return 'skip'
  const clientId = source.kind === 'google'
    ? resolveGoogleClientId(app.getPath('userData'))
    : resolveMicrosoftClientId(app.getPath('userData'))
  if (!clientId) return 'unconfigured'
  const refresh = await getStore().getSecret(sourceId)
  if (!refresh) return 'fail'
  try {
    await accessTokenFor(source, refresh)
    return 'ok'
  } catch {
    return 'fail'
  }
}

/** An http(s) or webcal URL. Anything else is rejected, not coerced. */
function assertFeedUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new IpcValidationError('A calendar address is required')
  const raw = value.trim()
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new IpcValidationError('That does not look like a web address')
  }
  if (!['http:', 'https:', 'webcal:'].includes(parsed.protocol)) {
    throw new IpcValidationError('Only http(s) and webcal addresses are supported')
  }
  return raw
}

function assertKind(value: unknown): CalendarSourceKind {
  if (value !== 'caldav' && value !== 'ics') throw new IpcValidationError('Unsupported calendar type')
  return value
}

function assertString(value: unknown, label: string, max = 500): string {
  if (typeof value !== 'string') throw new IpcValidationError(`${label} must be text`)
  const s = value.trim()
  if (s.length > max) throw new IpcValidationError(`${label} is too long`)
  return s
}

function assertRange(from: unknown, to: unknown): { from: number; to: number } {
  if (typeof from !== 'number' || typeof to !== 'number' || !Number.isFinite(from) || !Number.isFinite(to)) {
    throw new IpcValidationError('A time range is required')
  }
  if (to <= from) throw new IpcValidationError('The range must end after it starts')
  // Two years is far more than any view needs; the cap stops a bad caller from
  // asking a server for a decade and stalling the surface.
  const MAX = 730 * 86_400_000
  if (to - from > MAX) throw new IpcValidationError('That range is too wide')
  return { from, to }
}

export function registerCalendarHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, 'calendar:sources', async () => getStore().list())

  // Verify BEFORE saving, so a typo reports itself instead of becoming an
  // account that silently never syncs.
  ipcHandle(ipcMain, 'calendar:test', async (_e, input: unknown) => {
    const i = (input ?? {}) as Record<string, unknown>
    const kind = assertKind(i.kind)
    return testSource({
      kind,
      url: assertFeedUrl(i.url),
      ...(kind === 'caldav'
        ? { username: assertString(i.username, 'Username'), password: assertString(i.password, 'Password', 1000) }
        : {}),
    })
  })

  ipcHandle(ipcMain, 'calendar:add', async (_e, input: unknown) => {
    const i = (input ?? {}) as Record<string, unknown>
    const kind = assertKind(i.kind)
    const enabled = Array.isArray(i.enabledCalendars)
      ? i.enabledCalendars.filter((c): c is string => typeof c === 'string').slice(0, 100)
      : undefined
    return getStore().add({
      kind,
      url: assertFeedUrl(i.url),
      displayName: assertString(i.displayName ?? '', 'Name', 200),
      ...(kind === 'caldav'
        ? { username: assertString(i.username, 'Username'), password: assertString(i.password, 'Password', 1000) }
        : {}),
      ...(enabled ? { enabledCalendars: enabled } : {}),
    })
  })

  ipcHandle(ipcMain, 'calendar:update', async (_e, id: unknown, patch: unknown) => {
    const p = (patch ?? {}) as Record<string, unknown>
    const out: Record<string, unknown> = {}
    if (p.displayName !== undefined) out.displayName = assertString(p.displayName, 'Name', 200)
    if (Array.isArray(p.enabledCalendars)) {
      out.enabledCalendars = p.enabledCalendars.filter((c): c is string => typeof c === 'string').slice(0, 100)
    }
    return getStore().update(assertString(id, 'Id', 100), out)
  })

  ipcHandle(ipcMain, 'calendar:remove', async (_e, id: unknown) => {
    await getStore().remove(assertString(id, 'Id', 100))
    return { ok: true }
  })

  // The read the surface lives on. Returns per-source status alongside events so
  // one broken account degrades to a warning instead of an empty calendar.
  ipcHandle(ipcMain, 'calendar:events', async (_e, from: unknown, to: unknown) => {
    const range = assertRange(from, to)
    const view = await readCalendar(getStore(), range.from, range.to, accessTokenFor)
    // Events this app owns, merged in beside the read-only feeds. They are the
    // only ones anything here can create, so they must appear in the same week.
    const root = getWorkspaceRoot()
    if (!root) return view
    const local = readLocal(root)
      .filter((e) => e.end > range.from && e.start < range.to)
      .map((e) => ({ ...e, sourceId: LOCAL_SOURCE_ID }))
    if (local.length === 0) return view
    return { ...view, events: [...view.events, ...local].sort((a, b) => a.start - b.start) }
  })

  /**
   * Create an event — the first thing in this app that can WRITE to a calendar.
   *
   * It lands in the local `.ics`, never in a subscribed feed: those belong to
   * whoever publishes them, and writing to Google or CalDAV needs auth scopes
   * and conflict handling we have not built. A local file also means the event
   * can be dragged into any other calendar app, so nothing is trapped here.
   */
  /**
   * Where a new event would go, and what else it could go to.
   *
   * The UI asks this BEFORE offering to schedule, so the question — when there
   * is one — is put while the person is still deciding, rather than after they
   * have been told the meeting is booked.
   */
  ipcHandle(ipcMain, 'calendar:write-targets', async () => {
    const store = getStore()
    return resolveWriteTarget(store, await store.getDefaultTarget())
  })

  ipcHandle(ipcMain, 'calendar:set-default-target', async (_e, id: unknown) => {
    await getStore().setDefaultTarget(typeof id === 'string' && id ? id : null)
    return { ok: true }
  })

  /**
   * Create an event.
   *
   * It goes to the calendar the person chose — a connected CalDAV calendar
   * when there is one, the local `.ics` otherwise. Which is decided here and
   * not by the caller, so every route to "put this in the calendar" lands in
   * the same place.
   *
   * Attendees are passed to the server, which sends the invitations. Asking
   * for attendees on a local write is refused rather than quietly dropped: a
   * meeting that silently invites nobody is the failure this is meant to end.
   */
  ipcHandle(ipcMain, 'calendar:create-event', async (_e, input: unknown) => {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
    const summary = typeof o.summary === 'string' ? o.summary.trim() : ''
    if (!summary) throw new IpcValidationError('An event needs a title.')
    const start = Number(o.start)
    if (!Number.isFinite(start)) throw new IpcValidationError('An event needs a start time.')
    const end = Number(o.end)
    const attendees = Array.isArray(o.attendees)
      ? o.attendees
          .filter((a): a is { email: string; name?: string } =>
            Boolean(a && typeof a === 'object' && typeof (a as { email?: unknown }).email === 'string'),
          )
          .slice(0, 50)
      : []

    const store = getStore()
    const wanted = typeof o.target === 'string' && o.target ? o.target : await store.getDefaultTarget()
    const choice = await resolveWriteTarget(store, wanted)
    if (!choice.target) {
      throw new IpcValidationError('There is more than one calendar — say which one this should go in.')
    }
    // An implied choice is remembered, so the question is never asked twice for
    // an answer that was never in doubt.
    if (choice.implied || typeof o.target === 'string') {
      await store.setDefaultTarget(choice.target.id)
    }

    const common = {
      summary,
      start,
      end: Number.isFinite(end) ? end : start,
      allDay: o.allDay === true,
      location: typeof o.location === 'string' ? o.location : undefined,
      description: typeof o.description === 'string' ? o.description : undefined,
    }

    if (choice.target.kind === 'caldav') {
      const written = await writeToCalDav(store, choice.target, { ...common, attendees })
      return {
        uid: written.uid,
        summary,
        start: common.start,
        end: common.end,
        allDay: common.allDay,
        calendar: choice.target.label,
        invited: written.invited,
      }
    }

    if (attendees.length > 0) {
      throw new IpcValidationError(
        'Invitations need a connected calendar account — a local event cannot send them. Connect one in Settings, or schedule this without inviting anyone.',
      )
    }
    const root = getWorkspaceRoot()
    if (!root) throw new IpcValidationError('No workspace folder is open.')
    return { ...addLocal(root, common), calendar: choice.target.label, invited: [] as string[] }
  })

  /**
   * An event's identity for edit/delete: local events go by uid; server events
   * go by their own URL, which came FROM the server at read time. The href is
   * re-validated as http(s) here because it becomes an authenticated outbound
   * request — same boundary rule as assertFeedUrl.
   */
  const parseEventRef = (input: unknown): { local: { uid: string } } | { caldav: { sourceId: string; href: string } } => {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
    const sourceId = typeof o.sourceId === 'string' ? o.sourceId : ''
    if (!sourceId || sourceId === LOCAL_SOURCE_ID) {
      const uid = typeof o.uid === 'string' ? o.uid.trim() : ''
      if (!uid) throw new IpcValidationError('Which event?')
      return { local: { uid } }
    }
    const href = typeof o.href === 'string' ? o.href.trim() : ''
    let parsed: URL
    try {
      parsed = new URL(href)
    } catch {
      throw new IpcValidationError('That event cannot be edited from here — it has no server address.')
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new IpcValidationError('Bad event address.')
    return { caldav: { sourceId, href } }
  }

  const parseEdit = (
    input: unknown,
  ): { summary: string; start: number; end: number; allDay: boolean; location?: string; description?: string; attendees?: { email: string; name?: string }[] } => {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
    const summary = typeof o.summary === 'string' ? o.summary.trim() : ''
    if (!summary) throw new IpcValidationError('An event needs a title.')
    const start = Number(o.start)
    const end = Number(o.end)
    if (!Number.isFinite(start) || !Number.isFinite(end)) throw new IpcValidationError('An event needs a start and an end.')
    // Attendees: absent = leave alone; an array (even empty) = replace the set.
    const attendees = Array.isArray(o.attendees)
      ? o.attendees
          .filter((a): a is { email: string; name?: string } =>
            Boolean(a && typeof a === 'object' && typeof (a as { email?: unknown }).email === 'string'),
          )
          .slice(0, 50)
      : undefined
    return {
      summary,
      start,
      end,
      allDay: o.allDay === true,
      ...(typeof o.location === 'string' && o.location.trim() ? { location: o.location.trim() } : {}),
      ...(typeof o.description === 'string' && o.description.trim() ? { description: o.description.trim() } : {}),
      ...(attendees !== undefined ? { attendees } : {}),
    }
  }

  /** Which slice of a recurring event an edit/delete means. */
  const parseScope = (input: unknown): { kind: 'single' } | { kind: 'series' } | { kind: 'occurrence'; occurrence: number } => {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
    if (o.scope === 'series') return { kind: 'series' }
    if (o.scope === 'occurrence') {
      const occurrence = Number(o.occurrence)
      if (!Number.isFinite(occurrence)) throw new IpcValidationError('Which occurrence?')
      return { kind: 'occurrence', occurrence }
    }
    return { kind: 'single' }
  }

  /**
   * Edit an event where it lives. On a server, attendees and alarms survive
   * (the rewrite is surgical) and SEQUENCE is bumped, so the server tells
   * everyone the meeting moved.
   */
  ipcHandle(ipcMain, 'calendar:update-event', async (_e, ref: unknown, changes: unknown) => {
    const where = parseEventRef(ref)
    const edit = parseEdit(changes)
    const scope = parseScope(ref)
    if ('local' in where) {
      if (scope.kind !== 'single') {
        throw new IpcValidationError('Occurrence and series edits need a server calendar.')
      }
      if (edit.attendees?.length) {
        throw new IpcValidationError('Invitations need a connected calendar account — a local event cannot send them.')
      }
      const root = getWorkspaceRoot()
      if (!root) throw new IpcValidationError('No workspace folder is open.')
      const updated = updateLocal(root, where.local.uid, edit)
      if (!updated) throw new IpcValidationError('That event is not in the local calendar any more.')
      return { ok: true as const }
    }
    if (scope.kind === 'occurrence') {
      await updateOccurrenceOnCalDav(getStore(), where.caldav, scope.occurrence, edit)
    } else if (scope.kind === 'series') {
      // The series keeps its own days; the edit contributes wall-clock time
      // of day + duration (from the occurrence the person was looking at).
      const s = new Date(edit.start)
      await updateSeriesOnCalDav(getStore(), where.caldav, {
        summary: edit.summary,
        ...(edit.location ? { location: edit.location } : {}),
        ...(edit.description ? { description: edit.description } : {}),
        ...(edit.allDay ? {} : { time: { hour: s.getHours(), minute: s.getMinutes(), durationMs: edit.end - edit.start } }),
      })
    } else {
      await updateOnCalDav(getStore(), where.caldav, edit)
    }
    return { ok: true as const }
  })

  /** Delete an event where it lives. On a server this is what sends cancellations. */
  ipcHandle(ipcMain, 'calendar:remove-event', async (_e, ref: unknown) => {
    // The original shape was a bare uid for the local calendar; still honoured.
    const where = parseEventRef(typeof ref === 'string' ? { uid: ref } : ref)
    const scope = parseScope(ref)
    if ('local' in where) {
      if (scope.kind === 'occurrence') throw new IpcValidationError('Occurrence deletes need a server calendar.')
      const root = getWorkspaceRoot()
      if (!root) throw new IpcValidationError('No workspace folder is open.')
      return { ok: removeLocal(root, where.local.uid) }
    }
    if (scope.kind === 'occurrence') {
      await deleteOccurrenceFromCalDav(getStore(), where.caldav, scope.occurrence)
    } else {
      await deleteFromCalDav(getStore(), where.caldav)
    }
    return { ok: true as const }
  })

  /**
   * Connect a Google or Microsoft calendar: run the same PKCE loopback flow mail
   * uses, then store the REFRESH token in the keychain slot and list what the
   * account can see. Read-only scopes — this increment only displays calendars.
   *
   * A provider that returns no refresh token is rejected rather than saved: the
   * account would show a calendar once and then silently go stale.
   */
  ipcHandle(ipcMain, 'calendar:connect-oauth', async (_e, provider: unknown, displayName: unknown) => {
    if (provider !== 'google' && provider !== 'microsoft') throw new IpcValidationError('Unknown provider')
    const userData = app.getPath('userData')
    const clientId = provider === 'google' ? resolveGoogleClientId(userData) : resolveMicrosoftClientId(userData)
    if (!clientId) {
      return { ok: false as const, error: 'This build has no OAuth client id for that provider yet.' }
    }
    const flow = provider === 'google'
      ? await runGoogleOAuthFlow({ clientId, fetchFn: nodeFetch, scopes: [GOOGLE_CALENDAR_SCOPE, EMAIL_SCOPE] })
      : await runMicrosoftOAuthFlow({ clientId, fetchFn: nodeFetch, scopes: [MS_CALENDAR_SCOPE, 'offline_access'] })
    if (!flow.ok) return { ok: false as const, error: 'Sign-in was not completed.' }
    const refreshToken = flow.value.tokens.refreshToken
    if (!refreshToken) {
      return { ok: false as const, error: 'That sign-in returned no refresh token, so it could not be saved.' }
    }
    const token = flow.value.tokens.accessToken
    const calendars = provider === 'google' ? await listGoogleCalendars(token) : await listGraphCalendars(token)
    const source = await getStore().add({
      kind: provider,
      url: provider === 'google' ? 'https://www.googleapis.com/calendar/v3' : 'https://graph.microsoft.com/v1.0',
      displayName: assertString(displayName ?? '', 'Name', 200) || (provider === 'google' ? 'Google Calendar' : 'Outlook Calendar'),
      password: refreshToken,
      enabledCalendars: calendars.map((c) => c.url),
    })
    return { ok: true as const, source, calendars }
  })
}
