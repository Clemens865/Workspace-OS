# Screen Landscape → Workspace OS: analysis and plan

Status: plan with decisions (section 9). Phase 0 done on `feat/landscape-shell`;
progress is logged in [PROGRESS.md](PROGRESS.md). Updated 2 Oct 2026.
Sources: five read-only code analyses of this repo (shell, agents/runs, native
views/security, surface mapping, repo/tests) plus the approved prototype, copied to
[`prototype/`](prototype/) (open `prototype/index.html` through a local server; it
loads three.js from a CDN, which is fine for a design reference but not for the
app). The original design screens (11 PNGs, ~15 MB, kept out of git) live in
`~/Documents/Software-Projects/UI-Design-Concepts/worklive-screen-landscape/`.

## 1. The five findings that shape everything

1. **There is already a template for this.** The current shell arrived behind a
   setting (`newShell`, off by default), reached feature parity with the old layout,
   then became the default (PR #47). The switch is one line: `App.tsx:73`
   `{newShell ? <WorkspaceShell/> : <WorkspaceLayout/>}`. A third shell fits the
   same pattern.
2. **Live content cannot live in tilted screens.** The browser is a `<webview>`
   (separate compositor process; the code itself warns a transform smears it).
   Office (LibreOffice tiles on `<canvas>`), xterm and Monaco map clicks through
   `getBoundingClientRect`, so input breaks under scale/rotation. → Tilted screens
   show *snapshots*; real work happens on a flat, face-on, untransformed stage.
3. **The design was written for Worklive, not Workspace OS.** Its "already exists"
   claims (pause/resume, take control, handoffs, company memory, projects, two-run
   limit) are about the Worklive codebase. In Workspace OS they are partly or
   entirely missing.
4. **Workspace OS has no agent-level state.** Everything is per run, spread over
   several stores (`reviewStore`, `activityStore`, background `queue`, the separate
   `caseAgentRuns`, Codex questions only in a modal). Agent cards hardcode "Idle".
   Provider identity is implicit in `wos_model`. The screens need an honest,
   derived *agent presence* first.
5. **Security and build rules apply.** CSP (`security.ts:155-171`) blocks the
   prototype's CDN three.js and Google Fonts → bundle three via npm, fonts via
   `@fontsource`. WebGL2 already runs in production (Splash), so a bundled
   background is allowed. There is no CI; e2e runs locally with a native rebuild.

## 2. Branch, duplicate, or flag?

**Decided: landscape becomes the only shell. Built behind a setting while it
grows, on short-lived feature branches; the old shells are then removed from the
app and kept only as a backup in git.**

- **Fork/duplicate: no.** Packaging depends on the local LibreOffice volume and
  native modules, and releases already squash from the private history into the
  public repo. A third copy triples that, and the copy would drift from every mail,
  browser and office fix.
- **Long-lived branch: no.** Every surface change touches shell wiring, there is
  no CI to catch drift, and each e2e run costs a native rebuild. Past branches lived
  1–3 days.
- **Flag: yes.** As built in phase 0: a separate `landscapeShell: boolean`
  (default off) next to `newShell`, winning over it at the switch in `App.tsx`;
  Settings → Design offers Landscape · New · Classic; `npm run e2e:landscape` drives
  it. Not an enum, because the e2e suite writes `newShell` straight into
  localStorage; both flags go away in phase 7.

**Where to branch (decided):** `master` (0.2.0-beta.1) and `private-history`
hold identical files, so branches start from the latest `master`. They are created
**in the existing checkout** (`git switch -c`), not in a separate worktree, because
the git-ignored local files the app needs (`scripts/lok/` LibreOffice binaries,
`.workspace-os/`, `build/demo/`, `docs/pitch/`) exist only there.

**Old shells (decided): removed, kept as backup.** A "shell" is the app's outer
frame: navigation, layout and how the surfaces are arranged. Workspace OS has two
today, the older `WorkspaceLayout` ("classic") and the current `WorkspaceShell`.
Users never need them once landscape reaches parity, so:
1. While landscape is built, the setting switches between the shells (developer
   use; e2e runs both).
2. At parity (phase 7): tag the last commit with all shells
   (`backup/shells-before-landscape`) and push the tag to the private remote.
3. Remove both old shells and the setting in one commit. Restoring is a
   `git checkout` of the tag, nothing more.

## 3. Target architecture: two layers, one hand-off

```
┌──────────────────────────────────────────────────────────────┐
│ Landscape layer (spatial)                                    │
│  WebGL backdrop (three, bundled) · glass panes · 3D screens  │
│  Screens = DOM cards with snapshots. Never live surfaces.    │
├──────────────────────────────────────────────────────────────┤
│ Stage layer (flat, untransformed, face-on, scale 1)          │
│  The existing surfaces, still always-mounted:                │
│  Browser <webview>, LibreOffice canvas, xterm, Monaco,       │
│  Mail, Calendar, Files, Knowledge, Settings …                │
├──────────────────────────────────────────────────────────────┤
│ Chrome: glass dock · ⌘K CommandBar · QuickOpen · terminal    │
│ dock · toasts · Splash                                       │
└──────────────────────────────────────────────────────────────┘
```

**The focus hand-off.** A screen flies forward (CSS 3D, snapshot face). When it
lands at the stage rectangle with identity transform, the snapshot cross-fades to
the live surface mounted in the stage host. Leaving reverses it: capture a fresh
snapshot, swap it in, then animate away. This keeps the existing rule (WOS-011) of
never transforming a webview.

**What stays the same.** Surfaces stay mounted and hidden as today (they rely on
it for xterm/LOK re-fit). Navigation keeps the CustomEvent bus (`wos:open-rail`,
`wos:focus-agent`, …), ⌘K, ⌘P, ⌘J, the agent action registry
(`surfaceActions.ts`) and the preload API. The landscape shell is a new *composer*
over existing parts, like `WorkspaceShell` was.

**Visual layer rules.**
- One full-window WebGL canvas behind all DOM; three.js from npm.
- Render on demand, never "always on": see section 3a.
- Glass panes only over DOM, never over a `<webview>` rectangle.
- Glass = the approved Liquid Glass lens shader from the prototype (screen-space
  rounded-rect lens, round bezel profile, hairline light edge, cursor as the light,
  no shadows), not a physical 3D material.
- Quality setting: **Full** (lens glass + live landscape) · **Light** (lens glass,
  frozen landscape, lower resolution; automatic on battery) · **Off** (flat CSS,
  no WebGL). Reduced motion → Light without drift.
- New token scope (e.g. `.wl`) next to `tokens.css`, mounted *outside* `.wos`,
  because `tokens.css` forces `!important` styles on any class containing
  "title". Light-only at first, like `.wos`.

## 3a. Graphics cost and budget

**Is it something to consider? Yes.** Workspace OS today draws WebGL only in the
Splash; the landscape would be the app's first permanent GPU user, sitting behind
surfaces (webview, LibreOffice, xterm, Monaco) that already use the GPU.

What the prototype costs per drawn frame (estimate for a 14" MacBook, not yet
measured on hardware):

| Pass | Pixels | Notes |
|---|---|---|
| Landscape shader (noise, rays, lake) | ~2.3 M | the heaviest per pixel |
| Copy landscape to screen | ~4.8 M | cheap |
| Glass panes (3 texture reads each) | ~1.5 M | ~40 panes, a third of the screen |
| Bloom (2 blur passes at 1/3 size) + composite | ~5.3 M | now nearly unused |

Roughly 3–6 ms of GPU per frame (measured in phase 3 at 5.3 ms while
scrolling, before the fixes below; 2.7–2.9 ms after). At a constant 60 fps that keeps the GPU busy
20–35% of the time: noticeable battery drain on a laptop, similar to or above
video playback. The CPU side (reading ~4 corner positions per pane while things
move) is small.

**Plan: draw only when something changes.** Since the glass no longer animates by
itself, almost all of this can go away when nothing happens:
1. Idle (nothing moving, no pointer over glass): **0 fps**, the last frame stays.
2. Landscape cached in a texture; redrawn only on focus/tint/ripple changes. Its
   slow mist drift runs at ~10 fps in Full, frozen in Light.
3. Remove bloom and the half-float multisample buffer (highlights no longer go
   above white): saves 3 full-screen passes.
4. A flat stage surface open (browser, office, editor, mail): backdrop **stopped**,
   it is covered anyway. Window hidden or unfocused: stopped.
5. On battery (Electron `powerMonitor`): Light. Low-power GPUs or WebGL failure: Off.

**Budget (phase 3 exit test, measured with GPU timer queries on a real Mac):**
idle 0 fps; scrolling/hover ≤ 4 ms GPU per frame at 60 fps; any stage surface
open → 0 backdrop frames; no measurable change in battery drain while idle versus
the current shell.

## 4. Information architecture: the 12 rail surfaces in the new shell

| Today (rail) | Landscape shell | Notes |
|---|---|---|
| Home | **Overview** (dock) | Team screens + "needs you" line. HomeDashboard widgets can become a second band later. |
| Agents (Team/Feed/Fleet/Routines) | Overview screens + **Inbox** (dock) | Team → screens; Feed+Fleet+HITL → Inbox; Routines in Menu. Foundry → Create agent. |
| Cockpit | Menu → Cockpit (unchanged) | Stream ≈ History, Map ≈ Cases map. Keep as is at first. |
| — (Cases live in Cockpit/Home) | **Cases** (dock) + **project filter** (top bar) | Project = workspace folder; sub-projects = subfolders (section 5a). |
| Memory + Knowledge | **Library** (dock) | Memory scopes today: workspace / global ("personal"). No company scope yet. |
| Files, Mail, Calendar, Browser, docs | Menu + ⌘K/⌘P → flat **stage** | Must stay one action away. Later: open docs/mail as "work screens" in the landscape. |
| Connectors, Settings | Menu | Provider readiness (Claude/Codex) moves into Connections. |
| Chats (placeholder) | — | Design keeps chat separate from runs; build later. |
| Terminal dock (⌘J) | Unchanged | Agent chat in the focused screen can reuse the terminal session store. |

## 5. Data and domain gaps, prioritised

**P0, needed for honest screens (renderer-first, small main changes)**
1. `agentPresence` selector in a pure `*Model.ts` (with vitest): joins `reviewStore`
   runs + HITL, `activityStore`, background jobs, `caseAgentRuns` and Codex
   questions into one state per agent: Working · Live / Needs your answer /
   Ready for review / Error / Interrupted / Idle. "Paused" appears only once real
   pause/resume exists (P2, item 9).
2. Stable `agentName` on every run (dock, background, case runs); mirror case runs
   into `reviewStore` with a new `caseId`.
3. Route `codex:question` into the HITL model as a `question` kind with free-text
   answer; separate "blocked/error" from "needs answer".
4. Explicit provider per agent: add `wos_provider` frontmatter (fallback: derive
   from `wos_model`) for the teal/terracotta identity. Optional `wos_role`.

**P1, previews**
5. Pass run identity through `AGENT_ACTION_INVOKE`; add `owner` to `BrowserTab`.
6. `browser:thumbnail` IPC: throttled `capturePage()` (0.5–2 fps, visible screens
   only, plus on load-stop), JPEG/blob, always stamped "captured hh:mm" so a stale
   frame never reads as live. LibreOffice: reuse slide/tile thumbnails. Headless
   runs: activity trail / output tail as the "screen".

**P2, review flow and cases**
7. Inbox: unify HITL, Codex questions, pending review, errors. Accept = Keep;
   add **Revise** (resume conversation with feedback via `conversationId`).
8. Cases folio: add Sources (captured URL text), Conversation, run-linked History,
   artifact versions, export, shelf with search/filter. Make the host link runs to
   cases instead of relying on the prompt.

9. **Pause / resume (decided: build it).** Pause stops the agent's CLI process
   but keeps its session id and case; resume restarts it from that session
   (`claude --resume <id>`, Codex's equivalent) with a note of what changed.
   Needs: a `paused` run state in main, the session id stored per run, and a
   check that each provider's resume is reliable before the button ships.

**P3, new domain (only after the shell proves itself)**
10. Reviewed handoff (one accepted file → queued run for another agent).
11. Projects board, company memory scope, proposals, take control.

## 5a. Workspaces, sub-projects and where files go (decided)

A workspace is the folder being worked in. Today cases are already plain markdown
in `<workspace>/Cases/<id>.md`, but the files agents produce land wherever the agent
writes them, and a case only *references* them. Proposed structure:

```
<workspace>/
  .workspace-os/          app data (memory.db, agent-context.json, trash …)
  Cases/<id>.md           the case record (unchanged format)
  Work/<id>-<slug>/       new: every case gets its own folder
    sources/              captured pages, imports
    drafts/               work in progress, versioned
    outputs/              accepted results
  <Sub-project>/          a subfolder with its own .workspace-os/project.json
    Cases/  Work/ …       same structure, one level down
```

- Agents start with their working directory and `WOS_CASE_DIR` set to the case
  folder, so output lands there by default; `wos-case attach` moves stray files in.
- Sub-projects: any subfolder marked with `.workspace-os/project.json` (name,
  colour). The top-bar "All projects" filter switches between the workspace and its
  sub-projects; agents and cases carry the sub-project they belong to.
- Accepted results move from `drafts/` to `outputs/`, so the folder alone tells
  what was approved.

## 6. Porting the prototype code

The prototype is a design reference, not code to paste. Rewrite in React + TS,
following repo conventions (CSS Modules, pure `*Model.ts` + vitest, observable
stores read with `useSyncExternalStore`, files under ~500 lines):

| Prototype | Workspace OS module (proposed) |
|---|---|
| `arc()`, `flankLayout()`, `overviewLayout()` | `landscape/layoutModel.ts` (pure, tested) |
| scroll engine (`SC`, `makeRail`) | `landscape/useRail.ts` hook + `railModel.ts` |
| `place()`, sheets, focus | `LandscapeWorld.tsx`, `Screen.tsx`, `ScreenFace.tsx` |
| `bg.js` (shader, lake, ripples, motes) | `landscape/backdrop/` class + `useBackdrop` hook, three from npm |
| glass panes (corner markers) | `landscape/backdrop/glassPanes.ts` + `useGlassPane(ref, opts)` |
| dock, toggle pill, toasts | `LandscapeDock.tsx` etc. (reuse `moveDockGlow` idea) |
| data.js sample agents | replaced by `agentPresence` + agents IPC |

## 7. Phases, each with an exit test

| # | Phase | Size | Exit criterion |
|---|---|---|---|
| 0 ✅ | Setup: branch from `master` in the existing checkout, `landscapeShell` flag, `three` + Newsreader/Inter via npm, `.wl` tokens | S | App boots in all three shells; the setting switches; typecheck ratchet green. |
| 1 ✅ | **Shell skeleton**: landscape layer (static CSS backdrop), glass dock, Menu, flat stage hosting all existing surfaces | M | Every rail surface reachable in ≤2 actions; ⌘K/⌘P/⌘J/⌘B work; `WOS_E2E_SHELL=landscape` smoke + shell-layout variant pass. |
| 2 ✅ | **Agent presence + Team overview**: P0 data items, screens with honest status, carousel, focus → stage hand-off (LiveAgentZoom / terminal session) | M–L | Presence model unit-tested against real store fixtures; no hardcoded statuses; a blocked agent can be found, answered and left without getting lost (the design's own usability check). |
| 3 ✅ | **Visual layer**: bundled WebGL backdrop, Liquid Glass lens shader, render-on-demand and pause rules, quality tiers | M | Section 3a budget met on a real Mac; reduced motion respected. |
| 4 | **Previews**: tab ownership, browser thumbnails, doc thumbnails, terminal tails | M | Every non-idle screen shows a real or timestamped capture; nothing stale looks live. |
| 5 | **Inbox + Cases + files**: unified needs-you queue, Revise, case folders (5a), sub-projects, pause/resume | L | Review → accept/revise → case history works end to end; outputs land in the case folder; pause → resume continues the same session. |
| 6 | Optional new domain: handoff, projects, company memory | L | Only after phases 1–5 are used daily. |
| 7 | **Landscape only**: backup tag, remove old shells and the setting | S | Parity checklist passed, e2e green, perf budget met, tag pushed. |

Phases 1 and 2 already deliver a usable agent-first shell without any WebGL.
The visual layer comes after the structure is right, not before.

## 8. Main risks

- **GPU and battery**: the full glass look is the most expensive part. Mitigation:
  quality tiers, pause rules, measure in phase 3 before committing.
- **Honesty of states**: screens must not invent states (Paused, Live) that the
  runtime doesn't have. Mitigation: presence model is the single source.
- **Live surface in transforms**: any shortcut here breaks input or smears the
  browser. Mitigation: the snapshot ↔ stage hand-off is non-negotiable.
- **Three shells while building**: mitigation: short build period, shared
  surfaces, old shells removed at phase 7 (kept as a git tag).
- **No CI**: the e2e suite only runs locally. Mitigation: a landscape smoke test
  in every feature branch before merge.

## 9. Decisions (2 Oct 2026)

1. **Shell:** landscape becomes the only shell. Old shells are removed once it
   reaches parity and kept as a backup tag in git.
2. **Branch:** from the latest `master`, in the existing checkout (keeps the
   git-ignored local files).
3. **Fonts:** the prototype's Newsreader and Inter, bundled via npm.
4. **Projects:** the workspace is the folder; produced files go into a fixed
   structure per case; sub-projects are marked subfolders (section 5a).
5. **Pause/resume:** build it (P2, item 9).
6. **Graphics:** render on demand with quality tiers and a measured budget
   (section 3a).
