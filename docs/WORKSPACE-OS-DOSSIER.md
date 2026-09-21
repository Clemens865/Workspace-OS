# Workspace OS — Concept to Delivery

**A complete source document: the idea, the architecture, the engineering decisions, and the state of the build.**

Version 1.0 · 2026-08-01 · Written against commit `82c1733` on `master`
Every number in this document was measured from the repository, not recalled.

---

## 0. How to use this document

This is a **source document for generating a presentation**. It is deliberately
denser than any deck should be — an AI reading it should *select* from it, not
transcribe it.

**Instructions for the generating model:**

- §12 contains a **ready-made slide outline** in three lengths (10, 20, 40 slides)
  and three audience framings. Start there, then pull the substance from §1–§11.
- Every factual claim here is verified. **Do not add numbers that are not in this
  document** — the credibility of this project rests on its numbers being real.
- §9 is an *honest* status scorecard including what does not work. Keep that
  honesty in the deck. A slide that admits a gap earns the audience's trust for
  the nine slides that claim a win.
- Where a section is marked **[QUOTABLE]**, the sentence is written to be used
  verbatim on a slide.
- Where a section is marked **[SPEAKER NOTE]**, it is context for the presenter,
  not for the slide surface.

---

## 1. The concept

### 1.1 The one-line version

**[QUOTABLE]**
> **Workspace OS is the world's first IWE — an Integrated Workspace Environment.
> One window that holds every document, every channel, and an AI that can touch
> all of it.**

### 1.2 The analogy that explains it in five seconds

Developers have the IDE. Before the IDE, a programmer used a text editor, a
separate compiler, a separate debugger, a separate version-control tool, and a
terminal — and the productivity leap of the last thirty years came substantially
from **integrating them into one environment with shared context**.

Knowledge workers never got that. A manager in 2026 still runs Outlook, Teams,
Excel, Word, PowerPoint, a browser, and a separate AI tab — seven applications
that know nothing about each other.

**[QUOTABLE]**
> **The IDE did for code what nothing has yet done for business work.
> Workspace OS is the IDE for the manager.**

### 1.3 The problem statement

A manager's day is a constant context switch. Each switch costs: reload state,
lose the thread, re-establish where you were. Research puts context-switching
loss at **20–40% of productive time**.

The individual tools are good. **The fragmentation is the problem.**

And the fragmentation has become *more* expensive, not less, because of AI. The
AI tab is the eighth application — and it is the one that most needs context and
has the least. Every prompt starts with the user manually re-explaining their own
work: pasting the spreadsheet, describing the deck, summarizing the thread. The
assistant with the most potential leverage is the one furthest from the material.

### 1.4 The benchmark

**[QUOTABLE]**
> **If a manager can go three consecutive days without opening any external
> application, we have achieved the goal.**

This is deliberately a *behavioural* test, not a feature checklist. It cannot be
gamed by shipping a feature list. It is the single number that decides whether
the product is real. **[SPEAKER NOTE]** We are not there yet — §9 says exactly
how far.

### 1.5 The six principles

These are load-bearing. Every architectural decision in §5 traces to one of them.

| # | Principle | What it rules out |
|---|---|---|
| 1 | **Documents are the center, not code.** | An IDE with a .docx viewer bolted on. Word/Excel/PowerPoint/PDF are primary; code editing is secondary. |
| 2 | **The AI can touch anything.** | A read-only assistant. The agent has the same read/write access to a budget spreadsheet as to a strategy memo or a contract. |
| 3 | **Zero app switching.** | "Most" tools in one window. Not most — *all*. |
| 4 | **Sovereignty by default.** | Cloud round-trips, telemetry, proprietary engines. Data stays local. |
| 5 | **Subscription, not API.** | Per-token billing. It runs on the user's existing Claude subscription — zero marginal cost per document. |
| 6 | **Give managers the developer's sense of power.** | Dumbing down. The layout, the terminal, the agent control — all of it, aimed at business work. |

**[SPEAKER NOTE]** Principle 5 is a commercial weapon that is easy to
under-explain. Competitors that call an API per document have a cost floor that
scales with usage. This architecture spawns the user's own already-paid-for CLI
subscription. The marginal cost of the 1000th generated deck is zero.

### 1.6 Who it is for

**Primary:** managers, directors, VPs, executives — anyone who lives in the
office suite daily.

| Persona | Daily tools | Core pain |
|---|---|---|
| Manager | Word, Excel, email, Teams, PDF | Six apps open, constant switching, AI has no context |
| Director | PowerPoint, reports, email chains, contracts | High meeting-prep time, no cross-document intelligence |
| Executive | Briefings, email, budgets, strategy docs | Time is the constraint — every switch costs |
| Operations lead | Excel, process docs, checklists | Manually copying data between apps all day |
| Legal / Finance | PDFs, contracts, Excel models | No AI that can be trusted with proprietary local documents |

**Explicitly not the v1 target:** developers and data scientists. They can use it,
but every UX tie-break favours the office persona.

---

## 2. The two things that make it defensible

**[SPEAKER NOTE]** This is the most important section of the deck. Everything in
the product is either one of these two things, or it is a commodity that exists
to serve them. The honest framing is: *website builders, deck generators,
whiteboards, and connectors are all commodity and mostly free. We win only where
capability is routed through something nobody else owns.*

### 2.1 Live transclusion — one number lives in one place

Today, a revenue figure exists in a spreadsheet, is *copied* into a Word report,
and is *copied again* into a board deck. Three copies, three chances to be stale,
and no way to know which is right. Every knowledge worker alive has shipped a
deck with last quarter's number in it.

In Workspace OS, the number lives in **one** place and **flows**:

- A **Metric** is a named value with a source.
- A **Link** binds that metric to an *anchor* inside a real office file.
- Three anchor kinds are implemented, one per app, at true OOXML fidelity:

| Anchor | Implementation | Round-trips as |
|---|---|---|
| `xlsx-cell` | A real Calc cell (sheet + A1 reference) | A normal spreadsheet cell |
| `docx-cc` | A Word **content control** (`w:sdt`) tagged `wos-metric-<linkId>` | A normal Word content control |
| `pptx-shape` | An Impress text shape whose name round-trips as `<p:cNvPr name>` | A normal PowerPoint shape |

Two design properties matter more than the mechanism:

1. **Fidelity floor.** The file always contains a real literal value. Open it in
   Microsoft Office, on a machine that has never heard of Workspace OS, and it is
   a completely normal, correct document.
2. **Fail-safe.** The link is a *sidecar*. Delete the link, delete the metric,
   delete Workspace OS itself — the file is untouched and keeps its last correct
   value. Liveness can never corrupt a document.

**[QUOTABLE]**
> **The number lives in one place. Everything else is a view of it. And if the
> liveness layer vanishes tomorrow, every file you own is still a perfect,
> ordinary Office file.**

**The escalation above metrics — Collections.** A `LiveRange` is a raw
rectangular grid. A **Collection** interprets that grid as *typed records*: row 0
is the field schema, each subsequent row is one record. A collection renders into
a real office file as a **field-mapped repeated block** — a link chooses which
fields become columns, in which order, under which display headers — and stays in
sync. This is the records-to-layout leap: not "this cell mirrors that cell" but
"this table is a *view* of that dataset."

### 2.2 The reviewable agent — an agent you can actually let near your work

The reason knowledge workers do not delegate to AI agents is not capability. It
is that an agent with write access to your documents and no way back is
unacceptable — and correctly so.

The answer is not to restrict the agent. It is to make everything it does
**observable and reversible**:

- **Checkpoint before every run.** A *shadow git repository* — `GIT_DIR` inside
  `.workspace-os`, work-tree set to the workspace itself. The user's folder never
  gets a `.git`, it never collides with their own version control, and the whole
  tree is snapshotted cheaply before the agent touches anything.
- **One-click revert**, including removal of files the agent *created*.
- **Rollback is itself undoable** — reverting takes an automatic safety
  checkpoint first, so undo has an undo.
- **Secrets are never snapshotted.**
- **The Living Feed** renders each run as a Keep/Revert card showing the actual
  diff of what changed, plus the cost and turn count of the run.
- **Human-in-the-loop approval cards** gate live actions mid-run.

**[QUOTABLE]**
> **You can give it real power because you can always take it back.**

**[SPEAKER NOTE]** This is the most-tested subsystem in the repository —
`src/main/checkpoint.ts` carries 9 tests including *rollback-is-itself-undoable*
and *secrets-are-never-snapshotted*. That is a deliberate signal: the safety net
is the thing you cannot afford to have a bug in.

### 2.3 Why the combination is the moat

**[QUOTABLE]**
> **No incumbent owns a high-fidelity local office engine, an agent, and a
> liveness layer at the same time.**

- Microsoft owns the engine but its agent is a cloud service and it has no
  liveness primitive across file types.
- The AI companies own the agent but not the documents.
- The document startups own neither the engine nor a reversible agent.

**The governing rule for every roadmap item:** if a feature does not compound
either liveness or the reviewable agent, it is a commodity — skip it, or embed
it, but never build it from scratch.

---

## 3. What it is today

One Electron window with eleven surfaces reachable from a left rail:

| Surface | What it does |
|---|---|
| **Home** | Entry point — recent work, active agents, what changed |
| **Cockpit** | Calm status field: hide-the-healthy, agents as presence cells, plain-language lines, altitude by role (CEO / Head-of / Agent) |
| **Files** | Workspace tree, document-first icons, quick open, tabs, split view |
| **Canvas** | The work surface — Word, Excel, PowerPoint, PDF, images, media, Monaco, whiteboard |
| **Mail** | Native IMAP read + SMTP send, multi-provider, agent-drafted replies as review cards |
| **Calendar** | CalDAV + ICS, with Google and Microsoft Graph as additive connectors |
| **Chats** | Conversation surface |
| **Browser** | Full in-app tabbed browser the agent can also drive |
| **Agents** | Team roster, the Foundry, fleet lanes, the Living Feed |
| **Knowledge** | Full-text index, wikilinks, backlinks, related-notes |
| **Memory** | What the workspace has learned — correctable, with provenance |
| **Settings** | Accounts, connectors, vault, brand kit, agent mode |

### 3.1 The office engine — the hard part

Native editing of `.docx`, `.xlsx`, and `.pptx`, with no Docker, no server, and
no cloud:

- A **bundled headless LibreOffice** engine, driven through **LibreOfficeKit**.
- A purpose-built **C++ sidecar**, `wos-lok-host`, speaking a framed stdio
  protocol to the Electron main process: `J` = JSON control, `T` = a tile
  (`[id][w][h][BGRA]`), `C` = an engine callback, `B` = a *batched* tile frame
  carrying N tiles in one round-trip.
- Tiles are painted into **our own canvas** — the app is not iframing someone
  else's editor. That is what makes the drag handles, the design canvas, the
  component system, and slide thumbnails possible at all.
- **53 StarBasic macros** (`Wos*`) form a model-API bridge for every operation
  the `.uno:` dispatcher cannot do headlessly — charts, tables, content controls,
  shape geometry, conditional formatting, data validation, notes, page setup.
- **Multi-document** resident cache with LRU eviction, a crash-recovery watchdog,
  and save-coalescing.

**[SPEAKER NOTE]** Getting headless LibreOffice to initialise and render on macOS
required porting the Cairo headless backend so LOKit does not crash on Aqua. This
is the single deepest piece of engineering in the project and the reason the
whole product is possible without Docker.

### 3.2 The agent

- Runs the user's **Claude subscription** via the `claude` CLI — no API key, no
  per-token cost.
- **28 workspace actions** the agent can call over a Unix-socket bridge
  (`wos-action`), spanning browser control, document operations, file and
  knowledge search, mail, and memory.
- **Custom agents** as `.claude/agents/*.md` with injected personas.
- **The Foundry** — a meta-agent. Describe a specialty in plain language and
  Claude *authors* the specialist: name, description, persona, a validated subset
  of capabilities, home surface, and safe/full mode. It returns a **proposal**;
  the user approves before anything is written to disk.
- **Browser control** — the agent drives the real in-app browser: navigate,
  screenshot, extract, deep-read, click, type, scroll, manage tabs.
- **Parallel multi-tab research** — a lead agent fans out to subagents, one tab
  each, reading concurrently, then merges.

### 3.3 The rest, in brief

- **PDF** — view, highlight, note, ink annotation written as *real* PDF
  annotations via pdf-lib; page operations; AcroForm filling; signature stamps.
- **Search & knowledge** — SQLite FTS5 index over document *content* (docx, pdf,
  xlsx included), incremental via file watcher, with wikilinks and backlinks.
- **Memory** — two SQLite stores (workspace-local and personal). Provenance is
  mandatory; there is no fabricated confidence score; duplicate observations
  reinforce rather than accumulate; every memory is visible and correctable.
- **Secret vault** — Electron `safeStorage`, ciphertext-only on disk at `0600`,
  names-only listing, refuses to store at all if secure storage is unavailable.
- **MCP connectors** — secrets injected at spawn as environment variables, never
  in argv, prompts, logs, or transcripts.
- **Design canvas & components** — interactive shape editing plus a Framer-style
  component system with variants that works across all three office apps.
- **Trash & undo** — every destructive operation copies the prior version to
  `.workspace-os/trash` first.

---

## 4. Architecture

### 4.1 The layer diagram

```
┌───────────────────────────────────────────────────────────────────┐
│                     Workspace OS  (Electron)                      │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  RENDERER  —  React 18 + TypeScript                         │  │
│  │  sandboxed · contextIsolation · no node integration         │  │
│  │                                                             │  │
│  │  Rail │ Canvas (tile painter) │ Feed │ Cockpit │ Terminal   │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                    ▲                                              │
│         preload contextBridge — the ONLY renderer↔main path       │
│         221 validated IPC channels across 32 capability groups    │
│                    ▼                                              │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  MAIN PROCESS  —  owns every privileged capability          │  │
│  │                                                             │  │
│  │  workspace root (the security boundary)  │  IPC validator   │  │
│  │  checkpoint (shadow git)  │  trash  │  vault (safeStorage)  │  │
│  │  metrics · ranges · collections · links  (liveness)         │  │
│  │  search index (FTS5) │ memory (FTS5) │ mail │ calendar      │  │
│  │  agent spawn + permissions │ action bridge (unix socket)    │  │
│  └─────────────────────────────────────────────────────────────┘  │
│           ▼                    ▼                     ▼            │
│  ┌────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │ wos-lok-host   │  │  claude CLI      │  │  browser guests  │   │
│  │ (C++ sidecar)  │  │  (subscription)  │  │  (partitioned)   │   │
│  │       ▼        │  │        ▼         │  └──────────────────┘   │
│  │ LibreOfficeKit │  │  wos-action ────────┐                      │
│  │ (bundled, headless)                     │ back into main       │
│  └────────────────┘  └──────────────────┘  └──────────────────┘   │
└───────────────────────────────────────────────────────────────────┘
                              ▼
        Local disk only.  No server. No cloud. No telemetry.
```

### 4.2 The security model

Four boundaries, each doing one job:

1. **The renderer is untrusted.** `contextIsolation` on, `sandbox` on,
   `nodeIntegration` off. It cannot touch the file system directly.
2. **The preload bridge is the only door.** Every capability the renderer has is
   an explicitly exposed, validated channel.
3. **The workspace root is the file-system boundary, and the main process owns
   it.** The renderer can only *request* a change through the folder dialog — the
   root can never live in renderer-controlled storage. Path checks are **lexical
   resolve plus `realpath` symlink comparison**, because a lexical check alone
   misses a symlink inside the workspace pointing out of it.
4. **The session is hardened centrally.** CSP enforced via *response headers*
   rather than only a meta tag (a compromised renderer could strip the tag), a
   deny-by-default permission handler, navigation away from the app blocked, new
   windows denied, and `<webview>` embedding forbidden.

**[SPEAKER NOTE]** The in-app browser runs in its own persisted session
partition with a pinned desktop-Chrome user agent. Electron's default UA
advertises itself as an embedded browser, which makes real sites (LinkedIn,
Google, banks) serve a hardened challenge flow that invalidates the session
immediately after login. This is the kind of detail that decides whether
"log in once, the agent inherits the session" actually works.

### 4.3 The concurrency model

The premise "the AI can touch anything" means the agent and the user can act on
the same file simultaneously. That is designed, not left implicit:

| Scenario | Behaviour |
|---|---|
| Agent edits a file the user has open | Watcher detects it; a non-destructive banner offers **Reload / Keep mine**. Never a silent overwrite. |
| User is editing while the agent queues an edit | The agent waits for the editor's save callback to settle, then operates on the saved version. Deferred, not racing. |
| Two writes collide | Last-writer-wins **only after** the prior version is copied to trash. Nothing is unrecoverable. |
| External change (Dropbox, another app) | Treated identically to an agent change. |

**[QUOTABLE]**
> **No write is ever destructive-without-recovery, and no overwrite is ever
> silent while the file is open.**

---

## 5. The engineering decisions that shaped it

**[SPEAKER NOTE]** This section is gold for a technical audience and should be
compressed to one or two slides for a business audience. The pattern worth
drawing out: *every one of these was decided by building the thing and measuring
it, not by arguing about it.*

### 5.1 The pivot that saved the product

The PRD was written around **OnlyOffice Document Server running as a Docker
sidecar**, iframed into the canvas. It even listed the production-engine question
as an open decision, because "install Docker Desktop" is a non-starter for a CEO.

That was superseded. The product now runs a **bundled headless LibreOffice driven
via LibreOfficeKit**, rendering into our own canvas. OnlyOffice and Docker were
removed entirely.

| | Before (planned) | After (shipped) |
|---|---|---|
| Engine | OnlyOffice Document Server | Headless LibreOffice + LOKit |
| Delivery | Docker sidecar | Bundled inside the app |
| Rendering | Third-party iframe | Our own canvas, our own tiles |
| Install story | "First install Docker" | Drag to Applications |
| Ceiling | Whatever the iframe exposes | Full model API via 53 macros |

**[QUOTABLE]**
> **We stopped iframing someone else's editor and started painting the pixels
> ourselves. Everything interesting in the product became possible that week.**

### 5.2 Decision register

| Decision | Choice | Why |
|---|---|---|
| **Document engine** | Bundled headless LibreOffice + LOKit | No Docker, no server, no cloud. Ships inside the app. Full model API access. |
| **Rendering** | Our own canvas painting engine tiles | An iframe cannot give us drag handles, a design canvas, components, or thumbnails. |
| **Operations the dispatcher can't do** | StarBasic macro bridge, seeded post-init, run via `runMacro` | `.uno:` dispatch is limited headlessly. `WosActiveDoc()` resolves the right document across tabs. |
| **Agent bridge** | Spawn the `claude` CLI | Zero marginal cost, no API key, runs on the user's existing subscription. |
| **Agent write safety** | Shadow git checkpoint before every run | The subprocess writes to disk directly, bypassing the IPC trash layer. A shadow repo snapshots the whole tree cheaply, is invisible in the user's folder, and never collides with their own git. |
| **Workspace-root ownership** | Main process owns it; renderer can only request changes | The root is the security boundary for all file access — it must not live in renderer-controlled storage. |
| **Path traversal guard** | Lexical resolve **plus** `realpath` comparison | Lexical checks alone miss symlinks inside the workspace pointing outside it. |
| **Config storage** | Global (`~/.config/workspace-os/`) **and** per-workspace (`.workspace-os/`) | Global for preferences and keybindings; per-workspace for snapshots, tags, layout, memory. |
| **File indexing** | SQLite FTS5, background-indexed, incremental via watcher | Persists across restarts, handles 10k+ documents, reindexes only what changed. |
| **Memory storage** | **Two** databases, not a scope column | A workspace must be copyable, shareable and deletable without dragging personal memory along — or taking it with it. |
| **Memory provenance** | Mandatory — `remember()` throws without a source | An agent confidently repeating an unattributable claim is worse than one that knows nothing. |
| **Memory confidence score** | Deliberately **not** implemented | A fabricated 0–1 number is worse than no number. Ranking uses real signals only: lexical relevance, reinforcement count, recency. |
| **`memory.forget` for agents** | Deliberately **not** exposed | An agent that can silently erase what you taught it is a worse failure than one that cannot forget. Deleting stays a human action. |
| **Liveness link storage** | Sidecar JSON, never inside the file | Deleting a link, or the metric behind it, must never touch the document. |
| **Agent-facing CLIs** | Route through the `wos-action` socket bridge, not standalone binaries | A bundled CJS CLI cannot resolve native bindings (`better-sqlite3`). Found by running it, not by reasoning about it. |
| **Secret injection** | Decrypted in main only, injected as `childEnv` at spawn | Never in argv, prompts, logs, or transcripts. |
| **In-app browser UA** | Pinned real desktop-Chrome UA, version derived from the shipped Chromium | The default Electron UA triggers hardened login challenges that invalidate the session right after sign-in. |

### 5.3 Two decisions that were reversed — and why that matters

**[SPEAKER NOTE]** Include one of these if the audience is technical or
investor-side. A team that can show a *reverted* decision with a clean reason is
demonstrating engineering judgment, not just velocity.

1. **A rendering-performance layer** (tile cache + viewport virtualization +
   progressive zoom) was built, merged, and then **reverted**. It passed its
   macro audit — but the audit could not see that it broke the initial render of
   a real `.pptx`. It goes back only with real render verification attached.
2. **A standalone `wos-memory` CLI** was built and **deleted** once it was proven
   that a bundled CJS CLI cannot resolve a native SQLite binding. Memory now
   rides the already-validated agent bridge instead.

**[QUOTABLE]**
> **Two features were built, merged, and then deleted — because "it passes" and
> "it works" turned out to be different sentences.**

---

## 6. How correctness is established

**[SPEAKER NOTE]** This section is what separates this project from a demo. It
deserves a slide of its own in any technical or investor deck.

### 6.1 The hard rule

**[QUOTABLE]**
> **Office work is only "done" when a test drives the real engine and asserts the
> document actually changed. Not `ok: true`. Not a passing unit test. Not a
> zero exit code.**

This rule was not adopted for elegance. It was **paid for in real bugs** that
every weaker check passed:

- A dead module that was never loaded, because the macro's alias keyword was
  wrong — the dispatcher returned success and did nothing.
- Charts that inserted successfully and were **empty**.
- Bookmark names silently truncated by the engine.
- A `.uno:` command name that was subtly wrong — dispatched cleanly, did nothing
  at all. The UI would have looked perfect and been inert.

**[QUOTABLE]**
> **A misnamed command dispatches silently. The menu looks right, the click
> feels right, and nothing happens. That is why every command in this product
> was verified against the real engine before any UI was built on top of it.**

### 6.2 The layers of verification

| Layer | Scale | What it catches |
|---|---|---|
| **Unit tests** (Vitest) | **1,449 tests across 127 files — green** | Logic, geometry, parsing, state machines, security guards |
| **Real-engine e2e** | **45 office scripts** (69 e2e scripts total) | Everything the engine actually does or silently refuses to do |
| **Macro seed validator** | Runs as `pretest`, before every test run | A malformed StarBasic module would otherwise fail silently at runtime |
| **Packaged-app e2e** | `lok-packaged.mjs` | That the *shipped bundle* works, not just the dev tree |

The e2e suite is lettered and specific: ribbon, Writer, export, Calc, existing
`.xlsx`, charts, Impress, dialogs, transclusion (four kinds), docx tables, pptx
tables, find/replace, Word layout, conditional formatting, data validation,
Impress charts, notes, stability, canvas-pptx, frame-slide, shape move,
drag profiling, Calc `.uno:` verification, navigation, persistence, selection,
responsiveness, terminal, many-file stress, and a full user journey.

### 6.3 Honest current numbers

```
Unit tests      1,449 passed / 1,449   (127 files)     GREEN
E2E scripts     69 total, 45 office-specific
Known flake     1 — a timing-dependent lokHost sidecar-exit test.
                Failed once, passed on immediate re-run. Not yet fixed.
```

**[SPEAKER NOTE]** Report the flake. It cost nothing to disclose and it is the
difference between a number an audience believes and a number they discount.

---

## 7. Delivery

### 7.1 What ships

A signed-in-place macOS application bundle installed at
`/Applications/Workspace OS.app` — **1.3 GB**, of which **656 MB is the
bundled LibreOffice engine**.

Build artifacts produced by `npm run dist:mac`:

| Artifact | Size | Status |
|---|---|---|
| `.app` bundle | 1.3 GB installed | Works |
| `.zip` | ~438 MB | Works — this is the distributable |
| `.dmg` | ~452 MB | Intermittently fails on a transient `hdiutil resize` error |

Windows (NSIS) and Linux (AppImage) targets are configured but not yet built.

### 7.2 The standalone proof

**[QUOTABLE]**
> **We unmounted the development engine volume entirely — then created a
> spreadsheet and rendered a real tile from inside the installed app.**

The claim "no dependencies" is easy to assert and easy to get wrong. It was
tested destructively: the `/Volumes/LOBuild` engine volume was force-unmounted,
and the packaged application was driven against its *own* bundled `wos-lok-host`
and its *own* bundled LibreOffice:

```
engine ready (bundled)
created a spreadsheet: true
doc size: 26593x13005
rendered a real tile: true
```

**An important asymmetry, worth stating precisely:**

- **The shipped app needs nothing.** No Docker, no LibreOffice install, no
  Python, no server, no cloud account, no network.
- **Building it needs the engine volume mounted**, because `extraResources`
  copies LibreOffice *from* that volume *into* the bundle. Packaging fails
  outright without it.

### 7.3 What the bundle carries

Beyond the engine: the `wos-lok-host` sidecar, the document-generation and
component toolkits, the `wos-metric` / `wos-collection` / `wos-mcp-token` /
`wos-action` CLIs, and the document templates.

**[SPEAKER NOTE]** Template-based creation is a small decision with an outsized
effect: new documents are created by **copying a real template file** rather than
synthesising one from nothing. A file produced by the engine from scratch and a
file copied from a known-good master behave very differently when PowerPoint
opens them.

### 7.4 Distribution posture

- Auto-update wired via `electron-updater`, publishing to GitHub releases.
- Not notarized and not code-signed for public distribution yet — this is a
  known gap between "installs on our machines" and "installs on a customer's
  machine without a Gatekeeper warning".

---

## 8. The build, in numbers

**[SPEAKER NOTE]** These are measured, not estimated. If the deck shows a
"velocity" slide, this is the data for it.

### 8.1 Scale

| | |
|---|---|
| **Main process** | 245 files · 42,186 lines |
| **Renderer** | 227 files · 34,208 lines |
| **Preload bridge** | 1 file · 667 lines |
| **E2E harnesses** | 71 files · 9,628 lines |
| **Total application code** | ~77,000 lines of TypeScript |
| **Unit test files** | 133 |
| **IPC channels** | 221 across 32 capability groups |
| **StarBasic engine macros** | 53 |
| **Agent-callable workspace actions** | 28 |
| **Product surfaces** | 11 |

The 32 groups: accounts · agent · agents · brand · browser · calendar · canvas ·
checkpoint · collection · components · context · fs · links · lok · mail · mcp ·
memory · metric · office · pdf · range · search · secret · shell · skills ·
snapshot · system · terminal · transclusion · trash · window · workspace.

The largest are a fair proxy for where the depth is: `mail` (21), `browser` (17)
and `agent` (17).

### 8.2 Timeline

**394 commits and 101 merged feature branches between 2026-06-20 and
2026-08-01 — six weeks.**

| Week | Commits | What landed |
|---|---|---|
| W25 | 20 | Foundation, headless engine proof |
| W26 | 31 | Native office core, engine hardening |
| W27 | 33 | Components, design canvas |
| W28 | 58 | Live transclusion (metrics, ranges, links) |
| W29 | 48 | Agent platform: MCP, vault, fleet |
| W30 | 143 | Mail, calendar, PDF, Calc depth, memory |
| W31 | 61 | Cockpit, Foundry, packaging, branding |

**[QUOTABLE]**
> **Six weeks. 77,000 lines. 1,449 tests. One person and an agent.**

---

## 9. Honest status

**[SPEAKER NOTE]** Do not soften this section in the deck. The credibility gained
from one honest gap slide is worth more than three more feature slides.

### 9.1 MVP v0.1 scorecard — 11 of 11 complete

| # | MVP requirement | Status |
|---|---|---|
| 1 | Layout shell — panels, resizable, persisted | Done |
| 2 | Word (`.docx`) opens and edits natively | Done — via LOKit, not OnlyOffice |
| 3 | Excel (`.xlsx`) opens and edits natively | Done — formula bar, sheet management |
| 4 | PowerPoint (`.pptx`) opens and edits natively | Done — thumbnails, present mode, design tools |
| 5 | PDF viewer with highlight and annotation | Done — real PDF annotations, forms, signing, page ops |
| 6 | Image and video viewer | Done |
| 7 | Agent terminal with current file in context | Done |
| 8 | File panel — tree, icons, recent, right-click, search | Done |
| 9 | Command bar — file open and search | Done |
| 10 | Workspace snapshots | Done |
| 11 | Trash and undo for agent actions | Done — trash plus shadow-git checkpoints |

Beyond MVP and also shipped: mail, calendar, in-app browser with agent control,
knowledge index, workspace memory, MCP connectors, secret vault, the Foundry,
the cockpit, the component system, and live transclusion.

### 9.2 Against the actual benchmark — three days without another app

**Not yet.** The honest gap analysis:

| Need | Status |
|---|---|
| Documents | **Covered** — native, high fidelity, all three apps |
| PDF | **Covered** — annotate, fill, sign, page ops |
| Email | **Covered** — native IMAP/SMTP, multi-provider |
| Calendar | **Built, unproven** — never tested against a real CalDAV server |
| Web | **Covered** — full in-app browser |
| AI | **Covered** — and deeper than any external tab, because it has context |
| **Chat — Teams / Slack** | **Missing.** This is the remaining hard gate. |

**[QUOTABLE]**
> **Six of seven daily channels are in one window. The seventh — team chat — is
> what stands between us and the benchmark.**

### 9.3 What is verified, and what is merely built

This distinction is tracked deliberately, because conflating them is how a
project lies to itself.

**Verified against the real engine or a real service:**
office editing across all three apps, transclusion in all four forms, charts,
tables, find/replace, layout, conditional formatting, data validation, notes,
stability under load, many-file stress, packaged-app operation, SMTP send.

**Built and unit-tested, but never click-tested by a human:**

| Feature | The specific check still owed |
|---|---|
| Workspace memory | Tell an agent something durable, start a **fresh** run, confirm it knows |
| Calc context menu + format painter | Right-click a cell and a header; use the painter across a range |
| PDF annotation round-trip | Annotate, export, open in Preview — vertical offset is the likeliest bug, given the coordinate-origin flip |
| Calendar | A real CalDAV account (iCloud needs an app-specific password and probably the principal→home discovery walk) |
| Google / Microsoft calendar | Needs an OAuth **client id** per provider — none configured yet |
| Impress drag ghost | Observe it during a real drag |

### 9.4 Known defects and debt

| Item | Impact | Note |
|---|---|---|
| **`@vitejs/plugin-react` vs Vite 8 peer conflict** | **High** | Every `npm install` needs `--legacy-peer-deps` and risks a silent prune. It once deleted `better-sqlite3` and shipped an app that died before it could log anything. |
| **Main-process early imports have no `try/catch`** | **High** | A missing dependency kills the app with zero diagnostics — no window, no log, no crash dump. Directly amplified the bug above. |
| **`npm run lint` cannot run** | Medium | `eslint: command not found`. |
| Reverted rendering-perf layer | Medium | Must return with real render verification attached. |
| ~300 ms Impress drop latency | Medium | Profiled as content-bound engine tile cost — ~65 ms per tile on a real deck versus ~3.9 ms synthetic. Not a code-path bug. |
| DMG packaging | Low | Transient `hdiutil resize` failure; the `.zip` builds reliably. |
| Not notarized or signed | Low now, blocking later | Required before any external distribution. |
| One flaky test | Low | Timing-dependent lokHost sidecar-exit assertion. |

### 9.5 One claim that is currently overstated

Written material about the project has described *"permissions decided per
session by the person in front of it."* That is **not accurate today** — agent
mode is a single **global** Settings toggle. A per-run Safe/Full control next to
the composer is roughly an hour of work and would make the claim true; it has not
been built. It is listed here so it is corrected rather than repeated.

**[SPEAKER NOTE]** Conversely, two claims in that same material *understated* the
product: the run diff **is** shown ("The changes this run made"), and cost and
turn count **are** shown per run. Both were verified in the code.

---

## 10. Where it goes next

### 10.1 The committed pipeline, in order

| # | Item | Why it is next |
|---|---|---|
| 1 | **App builder** — an Apps rail surface where you describe an internal tool and an agent scaffolds it as a real workspace folder | Turns the workspace from a place you *use* tools into a place you *make* them. Increment 1 is a registry, a harness, and static self-contained HTML preview (the proven path). Increment 2 adds a per-app dev server — process lifecycle, ports, sandboxing. |
| 2 | **Vault access for built apps** | The vault is already solid; the only gap is letting an app request a named secret under explicit approval. |
| 3 | **Teams / Slack** | The last gate on the three-day benchmark. |
| 4 | **Pivot tables** | The most-cited remaining Excel gap. |
| 5 | **Cross-app comments and review** | Extends the reviewable-agent surface into human-to-human review. |
| 6 | **Live canvas ↔ slide sync** | Compounds liveness into the design surface. |
| 7 | **Component → collection binding** | Compounds liveness into the component system. |
| 8 | **Liveness merge-tags in email** | A live number inside an outgoing email — liveness reaching the last surface. |

### 10.2 Deferred deliberately

- **Semantic memory retrieval.** Retrieval is lexical only today, so "revenue
  forecast" will not match "sales projection". An `embedding` column is reserved
  so this is an additive migration — but it needs an embedding-model decision
  nobody has made, and a wrong choice here is expensive to unwind.
- **Memory consolidation.** Memories accumulate rather than merging into
  higher-level facts.
- **Real-time multiplayer co-editing**, cloud storage integration, a plugin
  marketplace, and mobile — all explicitly out of scope for v1.

### 10.3 The rule that governs the roadmap

**[QUOTABLE]**
> **If a feature does not compound liveness or the reviewable agent, it is a
> commodity. Skip it, or embed it — never build it from scratch.**

---

## 11. Risks, honestly stated

| Risk | Severity | Mitigation / current position |
|---|---|---|
| **Single-platform.** macOS only today; Windows and Linux targets configured but unbuilt. | High | The engine work is the portable part; the packaging is not. Windows is a real project, not a flag. |
| **Bundle size.** 1.3 GB installed, because the 656 MB office engine ships inside. | Medium | The trade was deliberate: 1.3 GB and it works offline forever, versus a small installer that says "first install Docker." |
| **Engine coupling.** The product's ceiling is LibreOffice's fidelity. | Medium | Mitigated by owning the rendering layer and the macro bridge — we can go around the engine's UI limitations, but not its file-format limitations. |
| **Build-time dependency on a local engine volume.** | Medium | `dist:mac` copies LibreOffice from a mounted volume. Fine for one machine, unacceptable for CI. Needs to become a fetched, versioned artifact. |
| **Not signed or notarized.** | Medium | Blocks any distribution beyond our own machines. Known, scoped, not started. |
| **Dependency fragility.** The Vite peer conflict makes every install a small gamble. | High | Documented, reproduced, and the single most valuable half-day of cleanup available. |
| **Solo bus factor.** | High | Partly offset by the test suite and by the decision register — the *reasons* are written down, not just the code. |
| **Incumbent response.** Microsoft could add liveness to Office. | Medium | They would still not have a local agent with reversible writes; and their incentive is cloud, not sovereignty. The sovereignty position is the part that is structurally hard for them to copy. |

**[SPEAKER NOTE]** If the audience is investors, the honest one-liner is: *the
technical risk is largely retired — the engine works, the agent works, the
liveness layer works. The remaining risk is distribution and platform breadth,
which is money and time, not invention.*

---

## 12. Slide outlines

Three lengths. Pick one, then draw content from §1–§11.

### 12.1 Ten slides — the executive / investor version

| # | Slide | Core content | Source |
|---|---|---|---|
| 1 | **Title** | Workspace OS — the IDE for the manager | §1.1 |
| 2 | **The problem** | Seven apps, no shared context; 20–40% lost to switching; AI is the eighth app and the most starved of context | §1.3 |
| 3 | **The idea** | One window. Every document, every channel, an AI that can touch all of it. The three-day benchmark. | §1.2, §1.4 |
| 4 | **Demo moment** | Live transclusion — change the number once, watch it move through Excel, Word and PowerPoint | §2.1 |
| 5 | **Why it is safe** | Checkpoint before every run, one-click revert, undo has an undo, secrets never snapshotted | §2.2 |
| 6 | **Why nobody else can do this** | The three-way combination: local engine + agent + liveness | §2.3 |
| 7 | **It is real** | 77k lines, 1,449 tests green, 45 real-engine e2e suites, MVP 11/11 | §8.1, §9.1 |
| 8 | **It ships** | Drag to Applications. No Docker, no server, no cloud — proven by unmounting the engine volume | §7.2 |
| 9 | **What is missing** | Teams/Slack is the last gate; platform breadth; signing | §9.2, §11 |
| 10 | **Ask / next** | The pipeline and what the next six weeks buy | §10.1 |

### 12.2 Twenty slides — the full product story

Add to the above, in this order:

11. **The six principles** (§1.5) — one slide, the table
12. **The personas** (§1.6)
13. **The pivot** (§5.1) — OnlyOffice+Docker → LOKit, with the before/after table
14. **The engine** (§3.1) — sidecar, tile protocol, 53 macros, our own canvas
15. **The agent** (§3.2) — subscription not API, 28 actions, the Foundry
16. **The eleven surfaces** (§3) — the product-tour slide
17. **Architecture** (§4.1) — the layer diagram
18. **Security & sovereignty** (§4.2) — four boundaries, all local, no telemetry
19. **How we know it works** (§6) — the hard rule and the bugs that bought it
20. **Six weeks** (§8.2) — the velocity chart

### 12.3 Forty slides — the technical deep-dive

Expand §2, §4, §5 and §6 into sections of their own:

- **Liveness (5 slides):** the stale-number problem · metrics and links · the
  three anchor kinds · fidelity floor and fail-safe · collections and the
  records→layout leap
- **The reviewable agent (5):** why delegation fails today · shadow git ·
  the Living Feed · HITL approval · fleet lanes
- **The engine (6):** why headless LibreOffice · the Cairo port · the sidecar
  protocol and its four frame types · tiles into our own canvas · the macro
  bridge · multi-doc cache and the watchdog
- **Architecture (5):** layer diagram · the preload boundary · workspace root
  as the security boundary · path traversal and the symlink trap · the
  concurrency model
- **Data & storage (4):** two memory stores and why · FTS5 and the contentless
  trap · the vault · sidecar link storage
- **Verification (4):** the hard rule · the four bugs that bought it · the test
  pyramid · the packaged-app test
- **Decisions (4):** the register · the two reversals · what we deliberately
  did not build · the roadmap rule
- Plus the twenty-slide narrative as the spine.

### 12.4 Three framings of the same material

| Audience | Lead with | Land on |
|---|---|---|
| **Investor** | The 20–40% number and the seven-app screenshot | Technical risk is retired; what remains is distribution |
| **Enterprise buyer** | Sovereignty — nothing leaves the machine, no telemetry, no cloud dependency | The reversible agent: you can give AI real power because you can take it back |
| **Engineer** | The pivot away from iframing someone else's editor | The verification discipline and the four silent bugs it caught |

### 12.5 Design direction for the deck

- **Tone:** calm, specific, understated. The material is strong enough that
  overstatement actively hurts it.
- **Every claim gets a number or a mechanism.** No adjectives doing the work of
  evidence.
- **One idea per slide.** The two moat slides (§2.1, §2.2) are the only ones that
  deserve to be dense.
- **Include the gap slide.** It is the slide that makes the other nine believable.
- **Brand:** deep indigo-to-violet field, warm amber accent, geometric squircle
  mark. Assets: `build/icon.icns` and `resources/brand/workspace-os-icon.svg`.

---

## 13. Fact sheet — every number in one place

**Verified 2026-08-01 against commit `82c1733`.**

```
CONCEPT
  Category            IWE — Integrated Workspace Environment (first of its kind)
  Benchmark           3 consecutive days without opening an external app
  Context-switch cost 20–40% of productive time (industry research)
  Principles          6
  Target personas     5

SCALE
  Main process        245 files / 42,186 lines
  Renderer            227 files / 34,208 lines
  Preload             1 file / 667 lines
  E2E harnesses       71 files / 9,628 lines
  Total app code      ~77,000 lines TypeScript
  IPC channels        221 across 32 groups
  Engine macros       53 StarBasic subs
  Agent actions       28
  Product surfaces    11

VERIFICATION
  Unit tests          1,449 passed / 1,449   (127 files)   GREEN
  Unit test files     133
  E2E scripts         69 total, 45 office-specific
  Known flake         1 (lokHost sidecar-exit, timing-dependent)

DELIVERY
  Installed bundle    1.3 GB  (656 MB is the bundled LibreOffice engine)
  Distributable zip   ~438 MB
  DMG                 ~452 MB (intermittent hdiutil failure)
  Platforms           macOS shipping; Windows/Linux configured, unbuilt
  Runtime deps        NONE — proven by unmounting the engine volume
  Standalone proof    engine ready · created a spreadsheet · rendered a real tile

VELOCITY
  Commits             394
  Merged branches     101
  Window              2026-06-20 → 2026-08-01  (6 weeks)
  Peak week           143 commits (W30)

STATUS
  MVP v0.1            11 / 11 complete
  Benchmark channels  6 of 7 covered — team chat is the gap
  Overstated claims   1, corrected in §9.5
```

---

## 14. Source map

For anyone extending this document, the claims above trace to:

| Claim area | Where it lives |
|---|---|
| Concept, principles, personas, MVP scope | `PRD.md` |
| Engine, sidecar, tile protocol | `src/main/office/lokHost.ts`, `scripts/lok/wos-lok-host.cpp` |
| Macro bridge | `src/main/office/lokMacros.ts` |
| Liveness | `src/main/transclusions.ts`, `metrics.ts`, `ranges.ts`, `collections.ts` |
| Reviewable agent | `src/main/checkpoint.ts`, `src/renderer/src/components/Review/` |
| Agent platform | `src/main/agent/` (foundry, actionBridge, capabilityCatalog) |
| Security | `src/main/security.ts`, `ipc-validator.ts`, `workspace-root.ts` |
| Memory | `src/main/memory/` |
| Vault | `src/main/secrets/vault.ts` |
| Packaging | `package.json` → `build` |
| Progress history | `docs/PROGRESS.md` |
| Strategic roadmap | `docs/blueprints/expansion-roadmap.md` |
