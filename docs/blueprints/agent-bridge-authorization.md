# Per-Agent Authorization for the wos-action Bridge

*Security-audit findings #2 (High) and #7 (Low), deferred from the 2026-08-30
audit as design work rather than a patch. This is the same capability-
enforcement layer the Workspace Apps blueprint names as its #1 must-ship — do
it once, for both.*

## The gap

`actionBridge.handleRequest` (src/main/agent/actionBridge.ts) gates an incoming
action only by `ctx.allActionIds.includes(id)` — and `allActionIds` is the
**entire global registry** (every surface action the app registers). Nothing
intersects it with the *running agent's granted capabilities*. The capability
catalog (src/main/agent/capabilityCatalog.ts) treats `toolMode`/`actions` as
**advisory** and says so; `WOS_AGENT_SOCK` is exported unconditionally and both
safe and full modes grant `Bash(wos-action:*)`.

**Consequence (finding #2, High):** any agent can invoke *every* registered
action. A safe-mode research agent reading untrusted web content can be
prompt-injected into `wos-action run browser.navigate/type/click` — steering
state-changing clicks on the user's logged-in Gmail / Connected-Accounts
session — or `memory.remember`, which persistently poisons every future run.
None of that was in its grant.

**Consequence (finding #7, Low):** `cases.*` and `calendar.*` are reachable by
any agent too; `calendar.createEvent` is a create-only remote CalDAV write,
which already stretches the bridge's "every registered action is
non-destructive" claim.

Not a today-patch: exploiting it needs an agent to be prompt-injected while
holding *some* grant, and closing it properly is a subsystem — per-run identity
threaded through the socket, a real grant table, enforcement at the chokepoint.

## The fix (one layer, serves the Apps feature too)

1. **Per-run identity + grant set.** When `agent.ts` spawns a run, mint the
   socket/token for THAT run and record its granted capability set (derived from
   the selected persona's `wos_capabilities` and safe/full mode). The env var
   becomes per-run, not global.
2. **Enforce at `handleRequest`.** Reject any `actionId` whose surface/capability
   is not in this run's grant — i.e. intersect `allActionIds` with
   `CAPABILITY_CATALOG[grantedCaps].actions`, not the whole registry. Unknown or
   ungranted → refused, logged, same shape as today's deny-unknown-id.
3. **Constrain the highest-impact verbs even when granted.** `research` already
   includes `browser.click/navigate`; gate navigation/form-submit on a logged-in
   first-party session behind human confirmation (reuse the Review/approval
   cards). Keep **send** permanently absent (already the rule).
4. **Provenance-tag agent-written shared state** (`cases.note`,
   `memory.remember`) as untrusted-source, so the user's main agent treats it as
   data-not-instructions — the residual the Apps blueprint already accepts.

## Why it waits for / merges with Apps

The Apps blueprint's Tier-2 cartridges need exactly this — a per-actor grant
enforced at the bridge — before any app can be given a capability. Building it
as a standalone security fix now and again for Apps later would be two
implementations of one thing. Sequence it as the first Apps-enablement task; it
retires audit #2 and #7 as a side effect.

## Interim posture (until built)

- **send is already absent** from the app/agent verb set — the worst
  irreversible action can't be reached.
- The exposure requires a prompt-injected agent holding a grant; the browser
  drive is the sharpest edge (logged-in sessions). Users running research
  agents over untrusted pages are the ones at risk.
- Everything the bridge exposes is read/create, not delete/send — bounded blast
  radius, which is why this is High-not-Critical and safe to schedule rather
  than hotfix.

## Built (2026-09-03, with Routines — v0.1.100)

Steps 1 and 2 above are in: `src/main/agent/grants.ts` mints a per-run token
(`WOS_AGENT_TOKEN`, set by `agent/launchRun.ts`, forwarded by `wos-action`)
with a grant, and `actionBridge.handleRequest` refuses any `run` whose token
is missing, revoked, or outside the grant — before cases/calendar/renderer
are touched. A grant is a set of action-id PREFIXES derived from the
capability's surface (`research` → `browser.*`, `cases` → `cases.*`, …),
because the catalog's action names are guidance and do not match the live
registry; `memory.search` is baseline for every identified run,
`memory.remember` needs `knowledge`. A plain dock run with no persona keeps
the legacy full grant; forged specialists and routines are held to theirs.
Live-verified: a routine with no capability running `wos-action run
cases.list` gets `not granted`; the same prompt with `cases` lists the case.

Still open: step 3 (human confirmation for navigation/form-submit on a
logged-in first-party session) and step 4 (provenance-tagging agent-written
shared state).
