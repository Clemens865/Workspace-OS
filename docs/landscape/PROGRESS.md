# Screen Landscape shell: progress log

Living log for the landscape shell. Plan and decisions: [PLAN.md](PLAN.md).
Approved design reference: [prototype/](prototype/). Newest entries first.

Legend: ✅ done · 🟡 in progress · ⬜ not started

| Phase | Status |
|---|---|
| 0 Setup | ✅ 2 Oct 2026 |
| 1 Shell skeleton | ✅ 2 Oct 2026 |
| 2 Agent presence + Team overview | ⬜ |
| 3 Visual layer (WebGL, Liquid Glass) | ⬜ |
| 4 Previews | ⬜ |
| 5 Inbox + Cases + files, pause/resume | ⬜ |
| 6 Optional new domain | ⬜ |
| 7 Landscape only (backup tag, remove old shells) | ⬜ |

---

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

