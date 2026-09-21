import type { CalendarCollection } from './caldav-client'
import type { CalendarSource } from './account-store'

/**
 * Where a new event should go.
 *
 * The app can now write to more than one place — the local file it has always
 * owned, and any CalDAV calendar the user has connected. That turns "create an
 * event" into a question with a wrong answer available, so it has to be
 * decided deliberately rather than by whichever came first in a list.
 *
 * The rule is the one a person would expect. One place to write means no
 * question worth asking, so it is used and remembered. Several means the app
 * genuinely does not know which — a meeting in "Holidays" or in the wrong
 * account is a real mistake — so it asks once and remembers the answer.
 *
 * Read-only collections never appear. Offering one means telling somebody
 * their meeting is scheduled and then failing with a 403 they cannot act on.
 */

export interface WriteTarget {
  /** Stable across restarts: the preference is stored as this string. */
  id: string
  label: string
  kind: 'local' | 'caldav'
  /** Which connected account, for a CalDAV target. */
  sourceId?: string
  /** The collection to PUT into. */
  calendarUrl?: string
  /**
   * Whether writing here can invite people.
   *
   * Only a server can: it is the one that sends the invitation email. An event
   * in the local file is a private note to self, which is fine — but a meeting
   * WITH someone that nobody else is told about is a silent failure, so the
   * distinction is carried rather than assumed.
   */
  canInvite: boolean
}

/** The always-available fallback, so scheduling works before anything is connected. */
export const LOCAL_TARGET: WriteTarget = {
  id: 'local',
  label: 'On this Mac',
  kind: 'local',
  canInvite: false,
}

/** One account's writable calendars as targets. */
export function targetsForSource(
  source: Pick<CalendarSource, 'id' | 'displayName'>,
  calendars: CalendarCollection[],
): WriteTarget[] {
  return calendars
    .filter((c) => !c.readOnly)
    .map((c) => ({
      id: `${source.id}:${c.url}`,
      // Both names, because "Home" alone is ambiguous the moment there are two
      // accounts — and the whole point of asking is to remove the ambiguity.
      label: `${c.displayName} · ${source.displayName}`,
      kind: 'caldav' as const,
      sourceId: source.id,
      calendarUrl: c.url,
      canInvite: true,
    }))
}

export interface TargetChoice {
  /** Where to write, or null when the person has to say. */
  target: WriteTarget | null
  /** The candidates, for asking with. */
  options: WriteTarget[]
  /** True when the answer should be remembered without being asked for. */
  implied: boolean
}

/**
 * Decides where an event goes.
 *
 * `preferred` is what the person chose last time. It is honoured only if it
 * still exists: a calendar can be renamed, disconnected or turned read-only,
 * and silently falling back to a different one would put a meeting somewhere
 * nobody looks.
 */
export function chooseWriteTarget(targets: WriteTarget[], preferred?: string | null): TargetChoice {
  const options = targets.length > 0 ? targets : [LOCAL_TARGET]

  const saved = preferred ? options.find((t) => t.id === preferred) : undefined
  if (saved) return { target: saved, options, implied: false }

  /*
   * A real calendar beats the local file when it is the only server one.
   *
   * The local target always exists, so a naive "only one option" test would
   * never fire and the person would be asked a question with one real answer.
   * What matters is how many places there genuinely are to put a meeting.
   */
  const real = options.filter((t) => t.kind !== 'local')
  if (real.length === 1) return { target: real[0], options, implied: true }
  if (real.length === 0) return { target: LOCAL_TARGET, options, implied: true }

  return { target: null, options, implied: false }
}
