# Handoff

**Written 2026-08-18 · v0.1.49 · master clean, 0 unpushed · 2373 unit tests green · SSD EJECTED**

---

## Read this first: the typecheck was lying

`npm run typecheck` ran `tsc -p tsconfig.json`, and that config has `files: []`
with only project references — **it checked nothing and exited 0**. It passed on
a codebase with 78 type errors, and it passed on a handler calling a method that
does not exist (`mail:classify` → `readMessage`), which then shipped.

It now runs `scripts/typecheck.mjs`, which checks the real projects
(`tsconfig.node.json` + `src/renderer/tsconfig.json`) and **fails only on
regressions** against `scripts/typecheck-baseline.json`. Printing 75 known
errors on every run would be noise, and noise gets ignored exactly as
thoroughly as a green tick that means nothing.

```bash
npm run typecheck              # fails only on NEW errors
npm run typecheck -- --accept  # ratchet the baseline (should only go DOWN)
```

The 75 are real and worth chipping at — mostly test files with untyped `vi.fn`
mocks. **Do not run `--accept` to make a red run go green.**

## Second: the SSD

The LibreOffice engine lives on an external SSD, **ejected at the end of this
session** — both the disk image and the physical drive. The installed app
bundles its own engine (656 MB), so documents open and edit with no SSD
attached; `npm run ship`, `dist:mac`, and every `e2e:office` / `e2e:lok*` suite
need it back.

```bash
hdiutil attach "/Volumes/Extreme SSD/LOBuild.sparseimage"
ls /Volumes/LOBuild/core/instdir/LibreOffice.app/Contents   # sanity check
```

**Native ABI is on NODE.** `npm test` works as-is; `npm run rebuild:electron`
before any Playwright probe, then `npm run rebuild:node` after.

---

## What landed this session (v0.1.39 → v0.1.49)

| | |
|---|---|
| **Cases** | A description, a stage row, and an **Ask** box that hands the whole case to an agent with any instruction |
| **Calendar** | Events go to **iCloud**, and iCloud sends the invitations |
| **Cockpit** | The **Head-of** altitude runs on real cases — no longer mock |
| **Mail** | Mail is sorted by what it **is**; newsletters stop reaching the cockpit |
| **Fix** | A workspace-relative path resolved against `process.cwd()` — PDFs would not open |
| **Browser** | Google sign-in is refused BY POLICY; the browser now explains it instead of looking broken |
| **Drive** | Google Drive over the API, connected through the system browser — engine + IPC, no UI yet |

---

## Google sign-in, and what it means for platform integrations

Google refuses sign-in for browsers "in eine andere Anwendung eingebettet" and
ones "durch Software-Automatisierung ... gesteuert" — both describe this app and
the agent driving it. Their instruction to developers is to move to
browser-based OAuth.

A Chrome identity was built, measured working (header AND
`navigator.userAgentData`, via a CDP override) and then **removed** — a feature
that works until Google decides otherwise is not a feature. `brandList` is now
the one place the identity is defined, with tests pinning it honest.

**This does not block Workspace / SharePoint integrations.** Those need a
TOKEN, not a browser cookie, and the sanctioned flow — system browser, loopback,
PKCE — already existed here for mail and calendar. `src/main/handlers/drive.ts`
calls the same `runGoogleOAuthFlow` with Drive scopes.

### Drive: what is done, and the one thing blocking it

Done: the REST client (list/search/get/download/export/update), the account
store (token in the keychain, never on disk), and the IPC. Files are fetched
into `<workspace>/Drive` so the canvas, office engine and agent see ordinary
files.

**BLOCKED: no Google client id is configured, and none is shipped**, so no
Google OAuth path can run — including the existing mail one. Register a Desktop
app client at console.cloud.google.com, enable the Drive API, paste the id.
Until then the Drive code is unverified against a real account.

**`drive.file` cannot browse** — only files the app created, or ones from
Google's Picker, which needs a signed-in Google session in a browser. Browsing
needs `drive.readonly`, a sensitive scope whose refresh token expires ~weekly
until the app passes Google review. The scope is a parameter, not a constant.

No UI yet: nothing in Settings or the Files panel calls any of it.

---

## Mail: classification, rules, and the sweep

The cockpit was full of newsletters because "is this bulk?" was one bit off
`List-Unsubscribe`, which is wrong in both directions at once: GitHub sends that
header on every notification, and plenty of marketing mail carries neither
header and puts the link in the body.

Now: **personal / notification / newsletter**, from list headers, a body
unsubscribe link, a machine sender, and whether the subject reads like a
campaign. Triage gates on "a person wrote it". Three categories on purpose —
every extra one is another folder that is sometimes wrong.

- **Rules override everything** (`mail-rules.json` in userData). They ASSIGN a
  category rather than forbidding one; first match wins, so order is the
  person's. A rule with nothing to match on is refused.
- **Correct it where you read it** — the reader shows the verdict and why, with
  one button that writes a rule on the sender's *domain*.
- **The sweep proposes, never moves** — the Newsletters button in the mail
  toolbar. It refuses to touch notifications, and counts what the index has not
  looked at rather than quietly proposing less.
- The index stores the three **signals**, not the verdict: a verdict computed
  under old rules would be wrong the moment a rule is written.

### NOT verified — do this first

**No newsletter has been observed actually moving.** `createFolder` has no demo
branch and dials IMAP, so the demo mailbox cannot exercise filing at all. This
hole **predates this session** and the existing agentic-filing feature has it
too. Note that pressing Newsletters on the real account first reads up to 150
messages per press — with a large mailbox it takes a few presses before a
proposal appears at all. Two ways forward:

1. Click "File them" on the real account once — 30 seconds, and it settles it.
2. Give `DemoBackend` `createFolder` + `moveMessage` and branch the service to
   them. Worth doing regardless: it makes both filing features testable without
   credentials, which is the whole point of the demo mailbox.

**The banner and the reader verdict have never been rendered.** A Playwright
probe has no secure credential storage, so the panel never loads a folder. They
typecheck and mirror the existing proposal panel — but nobody has seen them.

---

## Cases

`<workspace>/Cases/<slug>.md`. New this session:

- **A description** — a title says what something is *called*, a status says
  where it *stands*; neither says what it was. Agents are told to write one.
- **Offers live on the case**, derived from its notes minus an `acted` list, so
  they survive a restart and appear for notes an *agent* wrote. They were React
  state, which is why a case could sit there asking for nothing.
- **An Ask box** — any instruction, carrying the whole case. The three fixed
  offers are shortcuts to it.
- **`system` notes** — the app's own bookkeeping ("Status → interview") is no
  longer read as a request. It was firing the prep offer on the *name of a
  stage*.
- Dates parse the way they are written here: `25.08.2026 at 14:00`, `um 14 Uhr`,
  am/pm. A day with no time gets 09:00 and says so.

**Your workspace has no cases.** `<workspace>/Cases/` does not exist —
the cockpit is empty because nothing has opened one, not because it is broken.

---

## Calendar

Events go to a connected CalDAV calendar and **the server sends the
invitations** — iCloud already renders properly in Outlook and Gmail, collects
RSVPs and handles reschedules.

- The organizer address is **fetched** from `calendar-user-address-set`, never
  guessed from the username. A guessed organizer is *accepted* and then invites
  nobody, which is indistinguishable from success. With attendees and no
  discoverable address, the write is refused.
- One writable calendar → used and remembered silently. Several → asked inline
  before anything is written. **Clemens has 8 enabled**, so he will be asked
  once.
- Read-only collections never appear; a remembered calendar that has gone asks
  again rather than silently writing elsewhere.

**Open:** nothing supplies attendee addresses yet. The plumbing carries them,
but a note saying "meeting with Anna Weber" has no address, and I deliberately
did not scrape addresses out of note text — sending an invitation is outward and
irreversible.

---

## Cockpit

**Head-of is real.** Cases laid out as a river through their own status
vocabulary, with **exactly one warm stage** — earned by an unanswered offer or
ten days of silence, never by a stage's name. Clicking a case flies down to
Team-lead with it open.

**CEO is still mock** and keeps its Preview pill. Decided: keep the role labels,
feed them real data. Order agreed for the rest:

1. **Stream** — the merged timeline (case notes, runs, mail, calendar, file
   changes). The only view that survives your absence, and it works today
   without needing cases to pile up.
2. **CEO / Everything** — all cases by area, stalled ones warm. Needs volume.
3. **Map** — case-centred; real edges exist (`links:graph`, transclusion). Last,
   and the highest risk of being decoration.

---

## The lesson this session kept teaching

Every bug found today was found by **looking at the artefact, not the screen**:

- The case card looked right; the *file* said `subject: status: drafted` — an
  empty frontmatter field was eating the next line, because `\s` matches a
  newline.
- The flow view looked right; ALPLA claimed to have "asked for something", and
  the note was the app's own `Status → interview`.
- Triage looked right; the classifier had one bit where it needed four.
- `typecheck` said ok; it was checking nothing.

Two probes passed against deliberately broken builds before I trusted them.
Keep doing that — see `wos-run-the-negative-case`.
