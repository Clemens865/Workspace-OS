# Sessions, cases and the agent card

Status: built 2 Oct 2026 on `feat/sessions`. Follows [ADOPTION.md](ADOPTION.md).

## The idea

People do not use a terminal as a terminal here: every interaction is work done
with Claude or Codex. So the unit of work is a **session** (one conversation),
and the workspace's memory of work is a **case**. Sessions become cases by the
person's setting, and the app writes the case itself instead of trusting the
model to do it.

## Decisions (from the person, 2 Oct 2026)

1. **When a session becomes a case** is a setting (Settings → Agents → Keep
   sessions as cases): *Always* (on the first ask), *Suggested* (default: the
   app offers it once a session produced a file or ran 3 turns), *Manually*
   ("Keep as a case").
2. **What the case holds**: the asks and the agent's own outcome line per turn
   (labelled with the agent's name), and the files it produced. Never the full
   transcript; that stays local (the session store) and in the provider's own
   session store.
3. **Work in front, team behind**: the landscape's front row is work (the 10
   most recent cases and sessions), the back row is the team. "All work" opens
   the dense list (Cases → Shelf for cases, Sessions for sessions that are not
   cases).
4. **Delete**: sessions (their conversation and resume key), cases (file and
   work folder to the workspace trash, their sessions with them) and agents
   (their sessions and cases stay).
5. **The agent card is where you work with the agent**: its current session on
   the left (ask, see the steps, the files, keep it as a case), its sessions,
   what needs you now, About and Delete on the right.

## How it works

- `lib/sessions/sessionModel.ts` (pure, tested): titles, the suggestion rule,
  outcome lines, turn notes, the work-row ordering.
- `lib/sessions/sessionStore.ts`: one store and engine for every place a
  session is worked in (agent card, work card, Sessions list, the terminal's
  agent tabs). Persisted per workspace in localStorage. The provider
  conversation key is `session-<id>`, so every turn resumes the same Claude or
  Codex session. A session in a case works in the case's folder and is told it
  is the case.
- Landscape: `workPresence.ts` turns work into screens (same faces and live
  previews as agents, keyed by the latest run); `WorkFocus`, `SessionPane`,
  `SessionsList`; `AgentFocus` rebuilt around sessions.
- Main: `cases:delete` (to the workspace trash).

## Later

- Picture-in-picture windows inside cards (per-tab browser captures, Quick
  Look thumbnails of files).
- Several agents working one case at the same time.
