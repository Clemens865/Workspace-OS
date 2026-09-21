# Beta readiness — accounts, report collection, team collaboration

*Added to the pipeline 2026-08-22 at the founder's direction. Nothing here is
committed to a build order; B0 is pre-beta, B1 is explicitly gated on funding
or first customers. The governing constraint for all three: the sovereignty
principle stays intact — **identity and telemetry-by-consent may live in a
cloud; documents never do.***

---

## B0.1 — Accounts & onboarding (Supabase)

**What it is for:** gating the beta (invites/allowlist), knowing who our users
are, attributing reports, and later carrying licensing/tiers. It is an
**identity layer, not a data layer** — no document, no file name, no workspace
content ever reaches it. That sentence belongs in the consent screen, because
it is the product's whole pitch.

**Shape:**
- Supabase Auth, **email magic-link** (no passwords to manage, right for the
  persona), free tier is ample for a beta cohort.
- A `beta_allowlist` table + invite codes; sign-in refused with a friendly
  waitlist message otherwise.
- Session = refresh token stored in the **existing vault (`safeStorage`)** —
  the same keychain path mail credentials use.

**The founder's constraint — "I must not log in on every rebuild" — is already
solved by the architecture:** the session lives in the keychain keyed by
userData, and `userData` (`~/Library/Application Support/…`) **survives
rebuild + reinstall**. Installing a new build over /Applications does not touch
it. Log in once per machine, not per build. Belt-and-braces for development:
a `WOS_DEV_NO_AUTH=1` env bypass compiled out of release builds.

**Explicitly not doing:** blocking any local functionality behind the login.
Offline after first sign-in must keep working (grace period on token refresh);
an office suite that stops opening documents because a auth server hiccuped
would betray the product in one interaction.

## B0.2 — Bug & feature reports reaching the team

**Today:** the in-app reporter analyzes read-only and appends to local
markdown. Right mechanism, wrong terminus for a beta — reports die on the
user's disk.

**Shape (reuses B0.1's infrastructure):**
- On submit, the report — the same structured text the reporter already shows
  the user, **which is the consent screen**: what you see is exactly what is
  sent — goes to a Supabase `reports` table (RLS: users insert their own,
  only the team reads). Attached automatically: app version, platform,
  surface, anonymized context. Stripped always: workspace paths, file
  contents, anything the analyzer quoted from user documents.
- A Supabase **edge function mirrors each report into a GitHub issue** in the
  private repo, labeled `beta-report`, so triage happens where development
  already lives (the repo, `gh`, the agent). Supabase is the inbox of record;
  GitHub is the workbench.
- Offline or pre-auth: reports queue locally and send on next launch — the
  local markdown stays as the journal, so nothing regresses.

**Interim, zero-infra fallback** (if beta starts before B0.1 lands): an
"Export report" button that writes the redacted report file and opens a
pre-filled mail compose — the app ships a mail client; use it.

## B1 — Team collaboration (post-funding, by design)

The demand is real and it maps exactly onto the **Team tier** in the pitch.
The trap is equally real: real-time CRDT co-editing is explicitly rejected in
every prior roadmap (it is Miro's/Google's moat and contradicts local-first).
What fits this architecture instead:

- **Converge state, not data** (the surviving ContextHub verdict): what syncs
  between teammates is the *thread layer* — *cases* (append-friendly markdown
  + note streams), knowledge links, review/approval cards — not live document
  buffers. Documents travel as versioned artifacts attached to cases.
- **Sync, not sessions:** a self-hosted or managed sync backend (Supabase
  Postgres for the thread layer; object storage for artifacts) with the
  existing concurrency model doing what it already does — watcher-driven
  reload prompts, trash-before-overwrite, nothing silent.
- The **shadow-git checkpoint machinery is a head start**: the workspace
  already snapshots cheaply; a sync target is closer than it looks.
- Chat (the Teams/Slack/Matrix pipeline item) and collaboration should be
  designed together — a Matrix homeserver can carry both messages and small
  teams' presence, and it keeps the sovereignty story (self-hostable).

**Gate:** first funding or first paying customers. Until then this section is
a design position, not a work item.

---

## Order and effort

| # | Item | Effort | When |
|---|---|---|---|
| B0.1 | Supabase auth + allowlist + vault-stored session | S–M | Before first beta invite |
| B0.2 | Reports → Supabase → GitHub-issue mirror | S (after B0.1) | With B0.1 |
| B0.2i | Export-report mail fallback | XS | Anytime, if beta outruns B0.1 |
| B1 | Team thread-layer sync + chat | L | Post-funding |

*Cross-references: tiers in `docs/pitch/WORKSPACE-OS-PITCH.md` §7 · security
posture in `SECURITY.md` · the reporter in `src/renderer/src/components/
BugReport/` · ContextHub verdict in `docs/CONTEXTHUB-CONCEPT.md`.*
