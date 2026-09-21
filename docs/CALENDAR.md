# Calendar — feature map and roadmap

What a full calendar is, what this one already does, and what is deliberately
not built yet. Kept honest: a feature is ✅ only when it has been seen working
against a real server or is pinned by tests that were watched failing first.

## Where events live

| | Read | Create | Edit / Delete / Drag |
|---|---|---|---|
| CalDAV (iCloud, Fastmail, Nextcloud) | ✅ | ✅ + server-sent invitations | ✅ (v0.1.53) |
| Local `.ics` (On this Mac) | ✅ | ✅ | ✅ (v0.1.53) |
| Subscribed `.ics` feed | ✅ | — read-only by nature | — |
| Google / Microsoft (OAuth) | ✅ (read-only scopes) | ⬜ needs write scopes + client id | ⬜ |

## Event lifecycle

- ✅ **Create** — New-event dialog; calendar picked inline when there are
  several, remembered once; attendees invited BY THE SERVER (fetched organizer,
  never guessed).
- ✅ **Details** — click an event: when, where, which calendar, notes; what
  cannot be done says WHY (feed, read-only account, repeats).
- ✅ **Edit** — surgical rewrite of the server's own bytes: attendees, alarms
  and unknown properties survive; SEQUENCE bumped so every attendee's client
  knows the copy supersedes theirs; conditional PUT (If-Match) so a concurrent
  edit elsewhere surfaces instead of being overwritten.
- ✅ **Delete** — two-step confirm; conditional; on a server this is what makes
  iCloud send the cancellations.
- ✅ **Drag-reschedule** — drop on another day: same time, same duration.
  Attendees are told (same SEQUENCE mechanics).
- ✅ **Recurring events** (v0.1.55) — EXDATE and RECURRENCE-ID overrides are
  honoured on read (a series rescheduled once in Apple Calendar used to show
  BOTH copies here); delete asks this-occurrence-or-series (EXDATE vs object
  DELETE); edit asks the same (override VEVENT vs series rewrite); dragging a
  series slice moves ONE occurrence. Series time edits keep the master's own
  TZID form — never converted to UTC, which would shift the series at every
  DST boundary.
- ⬜ **Multi-day timed events** — can be moved and deleted; the single-day edit
  form refuses them with the reason.
- ⬜ Duplicate event, cut/paste of events.

## Invitations & scheduling

- ✅ Send on create; update on edit/reschedule; cancel on delete — all done by
  the CalDAV server, which also collects RSVPs.
- ✅ Attendees + RSVP state shown in details (v0.1.55): ✓ accepted, ✕ declined,
  ~ tentative, · no answer yet; organizer named.
- ✅ Add/remove attendees on an EXISTING event (v0.1.55): the edit dialog's
  invite field replaces WHO is invited; people kept keep the RSVP they already
  gave, new people are invited by the server, removed ones are uninvited.
- ⬜ Respond to incoming invitations (accept/decline lives in Mail first).
- ⬜ Free/busy lookup, conflict warnings when creating.

## Views & navigation

- ✅ Week view (Mon-first), today marker, per-source colours, multi-day events
  on every day they cover.
- ✅ Day view (v0.1.54): hour grid, overlap columns, now-line, all-day strip,
  drag to a TIME (15-min snap), double-click a slot to create there.
- ✅ Month view (v0.1.54): whole weeks, chips + "+N more", click a day to dive
  into it, drag chips between days.
- ✅ Day / Week / Month switcher; ‹ › step by the view's own unit; switching
  views stays anchored on the same place in time.
- ⬜ Agenda list; mini-month jump navigation.
- ⬜ Search across events.

## Agent

- ✅ **Ask box** on the surface (v0.1.54): any instruction plus the visible
  range's events go to an agent; it can schedule with
  `wos-action run calendar.createEvent`; the view refreshes when the run ends.
- ✅ Agent-created events land in the person's CHOSEN calendar (v0.1.54) — the
  action routes through the same write-target path as the UI; with several
  calendars and no remembered choice it fails and says the person must answer.
- ⬜ Agent read-action for the calendar (today the visible range is put in the
  prompt, which is exactly what the person is looking at — a read action would
  let it range wider).

## Platform

- ✅ Per-source failure isolation (one broken account never blanks the week).
- ✅ Passwords in the keychain; conditional writes everywhere.
- ⬜ Google/Microsoft write scopes (blocked on the Google client id — same
  blocker as Drive/Gmail).
- ⬜ Notifications/reminders (VALARM) surfaced in the cockpit.

## The order the rest should land

1. Agent read-action for the calendar; agenda list; search as the data grows.
2. Creating NEW recurring events from the dialog (a repeat rule picker) —
   reading, editing and deleting series all work; authoring one still happens
   in another client.
3. Respond to incoming invitations (accept/decline — lands in Mail first).
