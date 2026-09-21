# Closing the Codex Gaps — Build Plan

*From the Codex Gap Review (3 September 2026, master at v0.1.97). Workspace OS
covers ten of Codex desktop's fourteen capabilities and is ahead on five things
Codex lacks. This plan closes the five gaps worth closing, in the order the
review ranked them, one shipped release per milestone.*

## Principles

- **One milestone, one branch, one release.** `npm run ship` after each; the
  installed app is the review surface. Nothing is "done" without a live-app
  probe that also runs the negative case.
- **The Living Feed and Stream are already the review queue.** Nothing new
  gets its own inbox. Routine results, notifications and connector trouble all
  land where the person already looks.
- **Hide the healthy.** A routine that found nothing writes one quiet Stream
  line. A connector that works is a pale row. Only what needs the person runs
  warm.
- **Unattended is a higher bar.** Anything that runs without the person
  watching runs in safe mode until per-run bridge authorization
  (docs/blueprints/agent-bridge-authorization.md, audit finding #2) ships.
  That blueprint is folded into M3 below rather than deferred again.

## Sequence

| # | Milestone | Release | Size | Depends on |
|---|-----------|---------|------|------------|
| M1 | Connectors page | v0.1.98 | 1 session | — |
| M2 | Background runner | v0.1.99 | 2 sessions | — |
| M3 | Automations (routines) + bridge authz | v0.1.100 | 2–3 sessions | M1, M2 |
| M4 | Needs-you notifications | v0.1.101 | 1 session | M3 (for routine results) |
| M5 | Image generation skill | v0.1.102 | 1 session | M1 (provider key) |
| M6 | Per-workspace agent sessions | v0.1.103 | 1 session | — |

M1 goes first because it is the smallest, it is the user's stated pain, and
M3 and M5 both need a trustworthy "what am I signed into" surface. M6 is last
because it is independent and touches stores every other milestone reads.

---

## M1 — Connectors page (v0.1.98)

**Goal.** One rail item that shows every service the workspace is signed into,
in three states, with sign-in and sign-out on the row. Login-once already
works; this makes it visible and adds re-auth.

**What the person sees.** A "Connectors" rail item. A roster, one row per
service: name, status dot (connected / needs sign-in again / off), how it
connects in honest words (token in keychain · OAuth via system browser ·
browser session), what it gives agents in plain words, the one action. Settings
keeps a link to the page; its two connector sections move here.

**Scope.**
1. `src/main/connections/registry.ts` — one shape over the four stores: MCP
   vault + connector state, Connected Accounts, mail accounts, calendar
   accounts, drive account. `list(): Connection[]` with
   `{ id, name, kind: 'token'|'oauth'|'browser'|'account', status, gives, lastCheckedAt, error? }`.
2. **Status that means something.** `status` is computed, not stored:
   - `token`: present in vault → connected; else off.
   - `oauth`: try a refresh on demand (cached 10 min); failure → needs sign-in.
   - `browser`: cookie presence AND a lightweight fetch of the domain through
     the `persist:wos-browser` session that does not land on a login page
     (per-service `signedInProbe` in the catalog; fallback to the cookie
     heuristic when none is declared).
   - `account`: token manager reports healthy; refresh error → needs sign-in.
3. IPC `connections:list`, `connections:signOut`, `connections:reconnect`
   (routes to the store's own flow), registered in `ipc-registry.ts` with
   validation.
4. Rail: `shellModel.ts` (`RailId` + `RAIL_ITEMS`), `Rail.tsx` (icon),
   `WorkspaceShell.tsx` (surface). New `components/Connectors/ConnectorsView.tsx`
   composing the existing `ConnectorsPanel` and `AccountsPanel` logic as rows.
5. Catalog growth in `src/main/mcp/connectors.ts`: Microsoft 365 (Graph, reuse
   the shipped mail client id), Asana and Linear as `remote-oauth` entries
   shaped like Sentry. Google Workspace stays "Set up" until a client id exists.
6. A warm connector also writes one Stream line ("Asana needs you to sign in
   again") so the person hears about it where they already look.

**Verification.** Unit: registry status mapping per kind (mocked stores),
including the negative (a refresh that throws → needs sign-in, never
connected). Live probe: rail item present in the new shell, rows render, a
seeded token connector shows connected, sign-out flips it to off, Settings
still opens. Secrets never render back (assert no token text in the DOM).

**Out of scope.** New OAuth providers beyond the catalog entries; a marketplace.

---

## M2 — Background runner (v0.1.99)

**Goal.** Runs that belong to the app, not to a window: launched by main,
streamed into the same review and activity stores, surviving window close, with
no 60-second timeout.

**What the person sees.** Nothing new yet. Existing runs behave as before.
A run started by the app (M3) appears in the Living Feed and Stream exactly
like one started from the dock.

**Scope.**
1. `src/main/runs/queue.ts` — a main-owned queue: `enqueue(job) → runId`,
   concurrency limit (2), persisted `userData/runs-queue.json` so a run that
   was in flight at quit is marked interrupted, not lost.
2. `src/main/runs/headless.ts` — `claude -p --output-format stream-json` with
   the same permission builder as `handlers/agent.ts`, stdin prompt, no
   shell, `timeoutMs` = idle timeout (no output for 15 min), not wall-clock.
3. Events fan into `agent-activity.ts` → renderer stores, so the cockpit's
   working cells, Home's activity card, Stream and the Review feed all show
   the run with zero UI changes. `reviewStore` gains `origin: 'dock'|'routine'`.
4. HITL for headless runs: safe mode only; a permission request the harness
   cannot answer ends the run as `pending` with the question, which the feed
   already renders as a needs-you card.

**Verification.** Unit: queue persistence, concurrency, interrupted marking.
Live probe: enqueue a trivial run via IPC, close the cockpit window, reopen,
the run's result is in the feed; a run with no output for the idle window ends
as error, not hangs.

**Out of scope.** Full-mode unattended runs (waits for M3's bridge authz).

---

## M3 — Automations: routines (v0.1.100)

**Goal.** Recurring agent tasks the app runs on its own schedule, whose results
land in the Living Feed and Stream. Ships with per-run bridge authorization so
routines can be trusted.

**What the person sees.** A "Routines" tab in Agents (not a new rail item —
routines are agents on a clock). Each routine: a name, a plain-language
schedule ("every weekday at 07:00", "every Monday", "every 6 hours"), the
agent it uses, on/off, last ran, next run. Three templates ship on, off by
default: **Morning sift** (mail triage into zones), **Weekly case report**
(one page per open case, into `Cases/reports/`), **Stale case check** (cases
untouched for 10 days → one warm Stream line). A routine that finds nothing
writes one quiet Stream line.

**Scope.**
1. `src/main/routines/store.ts` — `userData/routines.json`, schema
   `{ id, name, agent, prompt, schedule, enabled, lastRunAt, nextRunAt }`.
   Schedule is a small explicit grammar (`daily@HH:MM`, `weekly@DOW HH:MM`,
   `every:Nh`), not cron syntax; parsed and tested.
2. `src/main/routines/scheduler.ts` — app-owned timers (the agent's own cron
   stays denied). Computes next run, enqueues into M2's queue, catches up
   missed runs on launch (at most one per routine), skips while a run of the
   same routine is still going.
3. Bridge authorization (the deferred blueprint): per-run token exported as
   `WOS_AGENT_TOKEN`, grant table keyed by run, `actionBridge.handleRequest`
   intersects with the run's grants. Routines get the grants of their agent's
   declared capabilities and nothing else.
4. UI: `components/Agents/RoutinesTab.tsx`; creating a routine from a case
   ("Check this weekly") writes one with the case as context.
5. Results: `reviewStore` cards carry `origin: 'routine'` with the routine name;
   Stream sentences read "Morning sift ran: 3 need you, 12 filed."

**Verification.** Unit: schedule grammar, next-run math across DST, catch-up
rule, grant intersection (negative: a routine's run asking for an action
outside its grants is refused and logged). Live probe: a routine scheduled
one minute out fires, its card appears in the feed, its line in Stream; app
relaunch with a missed run catches up exactly once.

**Out of scope.** Cron syntax; routines that email people without review.

---

## M4 — Needs-you notifications (v0.1.101)

**Goal.** The person hears about a waiting approval, a warm case, or a
routine's needs-you result without watching the app. Local first.

**What the person sees.** A macOS notification, one per thing, throttled
(never more than one per source per 10 minutes). Clicking opens the app on the
approval or the case. A Settings toggle, on by default for approvals, off for
cases.

**Scope.** `src/main/notify.ts` on Electron's `Notification` (nothing uses it
today); sources: HITL requests, routine results with needs-you, cases entering
a waiting status, connectors needing sign-in. Deep link → `wos:focus-*` events
the renderer already dispatches.

**Verification.** Unit: throttle and source rules. Live probe: seeded HITL →
notification fires (assert via a test hook), click focuses the approval.

**Out of scope.** Mobile and remote control — needs accounts and a relay
(docs/blueprints/beta-readiness.md). Revisit when B1 is funded.

---

## M5 — Image generation skill (v0.1.102)

**Goal.** An agent can make an image for a deck or a document.

**What the person sees.** A provider row on the Connectors page (key in the
keychain). Agents gain `wos-image "a calm hero for the Q3 deck" --out out/hero.png`;
the file appears as a created asset in the cockpit and docgen places it.

**Scope.** `resources/image-gen/SKILL.md` + `wos-image` CLI shaped like
`wos-metric`; provider adapter in `src/main/images/` (one provider first, the
one already on the user's account); output confined to the workspace; safe
mode allows `Bash(wos-image:*)`.

**Verification.** Unit: CLI argument and path confinement (negative: a
`--out` outside the root is refused). Live: an agent run produces a PNG that
lands in the Stream and opens in the canvas.

---

## M6 — Per-workspace agent sessions (v0.1.103)

**Goal.** Agent tabs, their history and run cards belong to the workspace they
were made in, as Cases already do.

**Scope.** Key `AgentTerminal/sessionStore.ts` and `Review/reviewStore.ts`
by workspace root (`wos:sessions:<rootHash>`); migrate the current global blob
to the active root on first launch; `fs.onRootChanged` swaps the dock's tabs
and the feed. Global runs (no root) keep a "Everywhere" bucket.

**Verification.** Unit: migration and key derivation. Live: two workspaces,
one tab each; switching roots swaps the dock; nothing lost across relaunch.

---

## Deliberately not in this plan

- **Git worktrees, remote SSH.** The audience works on documents and cases;
  checkpoints already isolate agent edits.
- **Native computer use.** High risk; the browser drive covers the common
  cases. Revisit after bridge authz has lived for a while.
- **Cross-device control.** Waits on accounts and a relay (beta-readiness B1).

## Open decisions for the user

1. **Google client id.** Still missing; blocks every Google path (Gmail, Drive,
   Calendar, Workspace). 15 minutes in the Cloud console.
2. **Routines under Agents, or their own rail item?** Plan says Agents.
3. **Image provider.** The plan assumes the one already on the user's account.
4. **Do the Settings connector sections move, or stay as duplicates?** Plan
   says move, with a link left behind.
