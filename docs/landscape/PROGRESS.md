# Screen Landscape shell: progress log

Living log for the landscape shell. Plan and decisions: [PLAN.md](PLAN.md).
**Status: implemented (phases 0–5 and 7) and tested; phase 6 deferred by the plan. Adoption (ADOPTION.md) done.**
Approved design reference: [prototype/](prototype/). Newest entries first.

Legend: ✅ done · 🟡 in progress · ⬜ not started

| Phase | Status |
|---|---|
| 0 Setup | ✅ 2 Oct 2026 |
| 1 Shell skeleton | ✅ 2 Oct 2026 |
| 2 Agent presence + Team overview | ✅ 2 Oct 2026 |
| 3 Visual layer (WebGL, Liquid Glass) | ✅ 2 Oct 2026 |
| 4 Previews | ✅ 2 Oct 2026 |
| 5 Inbox + Cases + files, pause/resume | ✅ 2 Oct 2026 |
| 6 Optional new domain | ⏸ deferred by the plan (after daily use) |
| 7 Landscape only (backup tag, remove old shells) | ✅ 2 Oct 2026 |

---

## 2 Oct 2026: adoption, everything in the landscape design ✅

Goal and plan: [ADOPTION.md](ADOPTION.md). Branch `feat/landscape-adoption`.

**A, one design everywhere**
- A1: the stage's three variable generations remapped to landscape values
  (`.wl .wos` in landscape-tokens.css): mist, paper, ink, Inter, hairlines.
- A2: the stage topbar carries the dock's items (Inbox with badge, Cases,
  Library, Menu); paper pill tabs; the current surface is named.
- A3: every surface restyled (Files, viewers, Browser, ⌘K/⌘P, terminal
  chrome, Mail, Calendar, Knowledge, Memory, Connectors, Settings, Agents,
  Review, Cockpit, Home, office chrome and dialogs, Monaco theme). Native
  prompt/confirm in the file tree → styled dialog; dead `Canvas/TabBar`
  removed. Document affordances keep their blue.

**B, old functions in their new homes**
- B1 Today (Team | Today; Menu → Home): hero with Not now, Next, Mail,
  While you were away, files, pages, desk assistant; recent workspaces and
  Open folder in the project menu (also with no folder open).
- B2 Inbox: mail waiting for a reply; Waiting | History (the Stream).
- B3 Cases: hand to an agent, offers from notes, Lives in, New case,
  Shelf · Map · Board, Data tab, thumbnails; AgentFocus shows turns/cost.
- B4 Library = Files · Notes · Memory (dock + stage topbar).
- B5 Browser: tabs know their agent (each agent's screen shows its own
  tab; the tab bar names it); downloads list in the address bar. Hidden
  guests are parked (sized) instead of display:none; only agent-owned
  background tabs keep painting.
- B6 Toasts; Menu → Routines and Create an agent.

**Fixed on the way (found by the new tests)**
- Search, links and the knowledge graph answered from every workspace
  ever opened (one shared index): now scoped in SQL, before the limit, and
  through symlinks. Cases search went from failing to passing.
- Glass panes ignored scroll clipping (cards behind the dock).
- Created files were only seen by views mounted before they appeared.
- Asking for the stage's current rail did not bring the stage forward.
- Files said "Reading this folder…" forever with no folder open.
- Inbox/work/today/library e2e now save and restore the user's
  localStorage (they used to reset the user's run feed).

**Regression check** (real app; before = `master` v0.2.0 built and run the
same day, after = this branch)

| Suite | master (v0.2.0) | branch |
|---|---|---|
| landscape | 99/99 (6 suites) | 169/169 (10 suites: shells 9, stage 36, presence 18, inbox 26, work 27, adoption 14, today 15, library 11, browser-own 6, perf 7) |
| browser layout, views-and-dock, history, address-sync, tab-groups, share-with-claude, double-load | pass (views-and-dock: splash) | pass (views-and-dock 24/24, now dismisses the splash) |
| browser phase2 | failing | 7/7 |
| browser phase3 | 4 failing | 2 failing |
| cases | 10 passed, 6 failed | 11 passed, 5 failed |
| created-assets | 5 passed, 4 failed | same |
| smoke | 3 failing (classic panels) | same |
| review, files-browser | fail (classic "Review" button; splash) | same |
| office A-ribbon | 8/8 | 8/8 |
| office B-writer, D-calc | timeout | same |
| office C-export | ENOENT on a /tmp fixture | same |
| office C-tail | 3/1 | 3/1 (print check is timing-flaky: 2/2 then 3/1) |

No suite is worse than on master; three are better.

**Verified**: `npm test` 257 files, 3025 passed; typecheck clean.

## 2 Oct 2026: phase 7, the landscape is the only shell ✅

**Backup.** Tag `backup/shells-before-landscape` (local, at `5f5db72`) holds
all three shells. Restore: `git checkout backup/shells-before-landscape`.
Not pushed yet: `git push archive backup/shells-before-landscape` puts it on
the private remote.

**Changed**
- `App.tsx` renders `LandscapeShell` directly; `WorkspaceShell` is only its
  flat stage now.
- Removed `components/Layout` (WorkspaceLayout, TitleBar), `ReviewRail` and
  `lib/tabSession`, used by nothing else. (`AgentTerminal`, also only mounted
  by the classic layout, stays for now: it belongs to the fleet session
  subsystem and has its own tests; removing it is a separate clean-up.)
- Settings: `newShell` / `landscapeShell` → `startOn` ("Open on: Landscape |
  Stage"). Opened on the stage, the rail is shown (the familiar workspace);
  reached from the landscape it stays tucked away (⌘B toggles).
- Test hook `app:start-on` (`WOS_START_ON=stage`, env-gated like
  `WORKSPACE_TEST_ROOT`): 102 e2e files that drive the stage set it; the
  office harness passes it inside `launch()`.

**Regression check** (real app, before = the backup tag, after = this branch)

| Suite | Before | After |
|---|---|---|
| landscape (6 suites) | — | 99/99 |
| browser/layout | 20/20 | 20/20 |
| review, files-browser, views-and-dock, browser-tabs, double-load, history, address-sync, tab-groups, share-with-claude | pass | pass |
| office A-ribbon, C-export, C-tail | — | pass |
| smoke | 3 failing (classic panels) | same 3 |
| cases | 6 failing (splash) | same 6 |
| office B-writer | 4 fail + "Track changes" timeout | "Track changes" timeout only |
| office D-calc | opening `D-calc.xlsx` times out | same |
| browser phase2 | find matches=0 | same |
| browser phase3 | 4 failing | same 4 |

No suite got worse; every remaining failure is on the backup tag too.

**Verified**: `npm test` 250 files, 2990 passed; typecheck clean;
`npm run e2e:landscape` 99/99 (scrolling 2.76 ms GPU per frame).

**Phase 6** (reviewed handoff, projects board, company memory) stays
deferred, as the plan says: "only after phases 1–5 are used daily".

## 2 Oct 2026: phase 5, cases, case folders, sub-projects, pause/resume ✅

**Pause / resume** (P2 item 9, the user's decision: build it)
- Background jobs (`main/runs/queue.ts`, + 4 tests): `paused` status; pause
  stops the process but keeps the provider session (`sessionId`, now captured
  from the run); resume re-queues and the launcher continues the session
  (`resumeId`); a job paused before its session existed restarts fresh; paused
  jobs survive a restart and can be cancelled. IPC `runs:pause` / `runs:resume`.
- Dock runs (`Landscape/pauseResume.ts`): pause = `agent.cancel` (main keeps the
  conversation mapping), then the run is marked `paused` after the dock's own
  exit handling; resume = `agent.run` on the same conversation with
  `resumeOnly`, so main refuses rather than silently starting over.
- `RunStatus` and the presence model gained `paused` (only ever set by Pause).
  The Inbox lists paused runs (Resume / Stop); screens show a paused face.
- **Verified live against Claude** (scratch probe, not in the suite: it costs
  tokens): pausing a real counting run (exit 143) and resuming with
  `--resume` worked, but the model restarted from "One". A provider session
  keeps only finished turns, so the text of the interrupted turn is lost to it.
  Fix: `pausedResumePrompt(tail)` hands the last words back ("the task is NOT
  finished… this is exactly how far you got"); the app has them (output tail /
  job tail). Re-run: paused at "Forty-One", resumed at "Forty-Two" through
  "Sixty". (+ 3 tests)

**Cases** (`CasesView` + tests): shelf with search, the open case with
Overview / Files / Notes / History, status from the case's own flow, notes
written to the case file. Dock Cases opens it in the landscape.

**Case folders** (§5a; `main/cases-work.ts` + 5 tests)
- `cases:work-folder` creates `Work/<case-id>/{sources,drafts,outputs}` (global
  cases under `~/Workspace-OS/Work`); case runs get the folder and are told to
  write drafts and sources there; "Case folder" opens it in Files.
- `cases:promote`: Accept on a draft moves it to `outputs/`, updates the case's
  artifact path and notes it.
- Fixed on the way: agent runs never had `WOS_WORKSPACE` (only shells did), so
  the `wos-case` CLI could not find the workspace inside a run.

**Sub-projects** (§5a; `main/projects.ts` + 6 tests, `ProjectSwitcher` + tests)
- A subfolder marked `.workspace-os/project.json`. "All projects ▾" in the
  header lists the workspace and its sub-projects (depth ≤ 2) and creates new
  ones (`Cases/`, `Work/`, marker). Choosing one opens it as the workspace,
  so runs, cases and memory are its own; the parent stays in the list.
  Listing and creating only under the open workspace or its ancestors.

**Verified**: `npm test` 251 files, 3000 passed; typecheck clean;
`npm run e2e:landscape` shells 6, stage 31, presence 18, inbox 16, work 18,
perf 7 (scrolling 3.02 ms); `e2e:shell-layout` 20/20.

## 2 Oct 2026: phase 4 (previews) ✅ and the Inbox (phase 5, part 1)

**Previews, always with their own time**
- Run identity now travels with agent actions: `actionBridge` passes the
  granted run id to the renderer executor (`AGENT_ACTION_INVOKE` payload
  `runId`, + test); `useAgentActions` records which run last drove the browser
  (`lib/browserDriver.ts`). Tabs have no owner; "the run that drove it last"
  is what the runtime can honestly say.
- New `browser:thumbnail` IPC (`browserControl.thumbnail`): `capturePage` with
  `stayHidden`/`stayAwake`, resized to ≤ 640 px, JPEG data URL, never written
  to disk, 2.5 s timeout. The browser guest stays painted under the landscape
  (`visibility: visible` on the webview inside the hidden stage; still covered
  and unclickable).
- An agent navigating no longer pulls the stage over the landscape; you watch
  it on the agent's screen (links you open still show the browser).
- `previewStore.ts` (+ tests): the last 1200 chars of each run's output.
- Working screens show the page their run drives (refreshed every 2 s while
  visible, "captured 10:24:31") or the last lines written ("just now");
  finished screens show their first result (image, or a text's opening lines).
  Office files show name and type: generating their thumbnails costs a full
  LibreOffice conversion per change.

**Inbox** (`inboxModel.ts` + 8 tests, `InboxView`)
- One item per thing waiting: PTY approvals and Codex requests (first), recent
  failures (latest per agent, 24 h, dismissable; interrupted jobs named as
  such), every finished run awaiting review.
- Cards fan in on the left; the chosen item opens on the right: Allow once /
  for the session / Deny; Mark accepted, Revert, **Revise** (a background run
  for the same agent with the original task, its files and your feedback; the
  result comes back to the Inbox); Start again, Dismiss. Text results are
  readable in place. ↑ ↓ move through items.
- Dock Inbox opens it in the landscape, with a badge counting what waits.

**Verified**
- `npm test`: 246 files, 2974 passed. Typecheck: no new errors.
- `npm run e2e:landscape`: shells 6/6, stage 31/31, presence 18/18, inbox 16/16
  (throwaway workspace via `WORKSPACE_TEST_ROOT`), perf 7/7 (scrolling 2.86 ms).
  Revise and Start again are checked for arming but not pressed: they start a
  real agent run.
- `npm run e2e:shell-layout` (current shell): 20/20.

## 2 Oct 2026: phase 3, the visual layer ✅

**Built** (`Landscape/backdrop/`)
- `shaders.ts`: the approved GLSL, verbatim (mist landscape with lake, ripples
  and screen reflections; Liquid Glass lens; motes). Bloom removed.
- `glassPanes.ts`: glass behind DOM elements, bent to their four projected
  corners (CSS 3D matched exactly).
- `scheduler.ts` (+ 11 tests): draw only when something changes. Idle → no
  frame and the loop stops; mist drift at 10 fps in Full only while someone
  is around (20 s); a hover lift redraws only the glass; a pointer move only
  re-composites (cursor light); nothing at all while the stage covers it or
  the window is hidden.
- `Backdrop.ts`, `gpuTimer.ts` (EXT_disjoint_timer_query_webgl2),
  `useBackdrop.ts` (quality, input, context loss → Off, `useGlass`).
- Glass on screens, name pills, case tabs, dock, header buttons and Menu
  items; ripples on choosing a screen; the mist recedes and takes the provider
  tint for a focused agent; breathes on view changes.
- Setting `landscapeQuality`: Auto (Full on power, Light on battery or with
  reduced motion) · Full · Light · Off. Settings → Design shows it while the
  landscape is on.

**Measured on this Mac** (`e2e/landscape/perf.mjs`, real GPU, timer queries)
- Scrolling the team: **2.7–2.9 ms GPU per frame** (max 4.3–4.8 ms); budget 4 ms.
- Idle: **0 frames** in 3 s. Stage open (with input): **0 backdrop frames**.
- Off: no WebGL. Reduced motion: Light.

**Fixed while measuring**
- First run: 5.3 ms while scrolling. The landscape texture was 1.24 device px
  per CSS px; at 0.75 (Full) / 0.6 (Light) it costs a third, invisible in the
  soft mist.
- First run: 88 frames "idle". The presence model refreshes every 30 s with
  new objects and the world took that as movement; it now wakes the backdrop
  only when placements change.

**Verified**: `npm test` 244 files, 2961 passed; typecheck clean;
`npm run e2e:landscape` shells 6/6, stage 31/31, presence 18/18, perf 7/7.

## 2 Oct 2026: phase 2, agent presence and the team overview ✅

**Built**
- `agentPresence.ts` (+ 25 tests): one honest state per roster agent, joined by
  name and run id across the review feed (runs + PTY approvals), the activity
  trail, background jobs and Codex requests. Precedence: needs your answer →
  working → the latest settled run (review / error / interrupted / idle). An
  interrupted background job shows as Interrupted even though the feed mirror
  folds it into "error". "Paused" is never produced (it waits for phase 5).
  Agent files named "Elias — Application Tailor" show as Elias, role
  Application Tailor.
- `useAgentPresence`: live roster (`agents.list`, re-read on
  `wos:agents-changed` and workspace switch), stores, jobs, Codex requests, a
  30 s clock for "8 min ago".
- `layoutModel.ts` (+ 14 tests): the prototype's arc, overview, flank, focus and
  away layouts, generalised to any team size; a small team's single row stands
  nearer the middle.
- `carousel.ts` (+ 9 tests): wheel (notched vs trackpad), drag with flick,
  arrow keys, snap; frame-rate independent easing; reduced motion jumps.
- `LandscapeWorld`, `AgentScreen`, `AgentFocus`: the screens in 3D, the
  focused agent with its task, question, recent steps and results, and actions
  through the existing paths: Allow once / for the session / Deny
  (`respondHitl`), Keep / Revert (`resolveRun`, checkpoint rollback), Stop
  (`runs.cancel` / `agent.cancel`), Start a session (`launchAgent`, opens the
  dock on the stage), results open on the stage (new `wos:open-file` event in
  WorkspaceShell), Add agent (Foundry on the Agents surface).
- ← → and horizontal swipes turn the ring while focused, digits open front
  screens, Esc steps back.

**Verified**
- `npm test`: 243 files, 2950 passed, 2 skipped. Typecheck: no new errors.
- `npm run e2e:landscape`: shells 6/6, stage 31/31, presence 18/18. The
  presence test drives the first real roster agent through working → needs
  your answer → Allow once (the decision reaches the asking session) → working
  → ready for review → Keep (recorded as kept) → idle, checks the header count
  and the front-row move, turns the ring, Esc, and the wheel. It saves and
  restores the user's own review history.
- Design check on the real roster (7 Claude Code agents): screenshots via
  `node e2e/landscape/shot.mjs <dir>`.

## 2 Oct 2026: phase 1, shell skeleton ✅

**Design.** The landscape does not rebuild the 15 surfaces. It hosts the
current shell as its flat **stage**: `WorkspaceShell` gained an optional
`stage` prop (`hidden`, `onLandscape`, `onSurface`). Hosted, its rail starts
hidden (⌘B shows it), a Landscape button sits first in the top bar, and every
change of surface or tab is reported so the landscape steps aside. While the
landscape shows, only the rail and the surface area are hidden
(`visibility: hidden`, layout kept for xterm/LibreOffice re-fit); the modals are
their siblings, so ⌘K, ⌘P and Settings open over the landscape. The landscape
fades over the stage; the stage itself is never transformed (WOS-011).

**Built**
- `Landscape/landscapeModel.ts` (+ tests): dock (Overview · Inbox · Cases ·
  Library · Menu) and Menu groups; a parity check that the Menu reaches every
  real rail surface.
- `LandscapeShell`: views overview / menu / stage; events that bring the stage
  forward even when its rail does not change (browser tab opened, browser
  navigate, reveal path, backlinks, focus/launch agent, agent artifact, ⌘J).
- `LandscapeDock` with the gliding pill, `LandscapeMenu` (Work, Agents,
  Knowledge, Workspace).
- Until their landscape views exist, the dock's Inbox, Cases and Library open
  Agents, Cockpit and Knowledge on the stage.

**Verified**
- `npm test`: 240 files, 2905 passed, 2 skipped. Typecheck: no new errors.
- `npm run e2e:landscape`: shells 6/6, stage 31/31 (Menu → each of the 11
  surfaces opens it on the stage and the Landscape button returns; the dock
  stand-ins; ⌘K and ⌘P over the landscape; ⌘J brings the stage with the
  terminal; ⌘B shows the rail).
- `e2e/browser/layout.mjs` (current shell, regression): 20/20 after teaching it
  to dismiss the splash (it failed on `master` for that reason alone).

**Learned**
- The startup Splash waits for Enter or its button; every e2e that reloads has
  to dismiss it, or clicks land on its canvas.

## 2 Oct 2026: phase 0, setup ✅

Branch `feat/landscape-shell`, from `master` (0.2.0-beta.1, `f5bb04d`), created in
this checkout so the git-ignored local files (LibreOffice in `scripts/lok/`,
`.workspace-os/`, demos) stay available.

**Built**
- `landscapeShell` setting (default off) in `hooks/useSettings.ts`; it wins over
  `newShell` at the switch in `App.tsx`. Chosen over the planned enum because the
  e2e suite writes `newShell` into localStorage directly (see PLAN.md §2).
- `LandscapeShell` is lazy-loaded: its fonts, tokens and code ship as a separate
  chunk (`LandscapeShell-*.js/.css`), so the current shells load nothing extra.
- Phase 0 scaffold in `components/Landscape/`: static CSS mist, header, dock
  (Overview active, Menu → Settings, others disabled until their phase), and
  "Back to the current shell".
- `.wl` token scope in `styles/landscape-tokens.css`, mounted outside `.wos`.
- Settings → Design: Landscape · New · Classic.
- npm: `three@^0.170.0`, `@types/three`, `@fontsource/newsreader`,
  `@fontsource/inter` (bundled, so the CSP needs no change).
- e2e: `npm run e2e:landscape` (`e2e/landscape/shells.mjs`).

**Verified**
- `npm run typecheck`: clean against the baseline (70 known errors, baseline 75;
  none new).
- `npm test`: 239 files, 2900 passed, 2 skipped.
- `npm run build`: OK; landscape chunk emitted separately.
- `npm run e2e:landscape`: 6/6 (landscape mounts, `.wl` scope applies, Newsreader
  and Inter load, Menu opens Settings with the switch, "Back" lands in
  WorkspaceShell, classic boots).

**Found, not caused by this work**
- `npm run e2e:shell-layout` fails on unchanged `master` too: the startup Splash
  still covers the window when the test clicks. Fixed in phase 1.
- `npm run lint` cannot run: ESLint 10 is installed but the repo has no
  `eslint.config.*`.
- `npm install` needs `--legacy-peer-deps`: `@vitejs/plugin-react@4` does not
  accept the installed `vite@8`.

