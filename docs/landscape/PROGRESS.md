# Screen Landscape shell: progress log

Living log for the landscape shell. Plan and decisions: [PLAN.md](PLAN.md).
Approved design reference: [prototype/](prototype/). Newest entries first.

Legend: ✅ done · 🟡 in progress · ⬜ not started

| Phase | Status |
|---|---|
| 0 Setup | ✅ 2 Oct 2026 |
| 1 Shell skeleton | ✅ 2 Oct 2026 |
| 2 Agent presence + Team overview | ✅ 2 Oct 2026 |
| 3 Visual layer (WebGL, Liquid Glass) | ✅ 2 Oct 2026 |
| 4 Previews | ⬜ |
| 5 Inbox + Cases + files, pause/resume | ⬜ |
| 6 Optional new domain | ⬜ |
| 7 Landscape only (backup tag, remove old shells) | ⬜ |

---

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

