# Screen Landscape shell: progress log

Living log for the landscape shell. Plan and decisions: [PLAN.md](PLAN.md).
Approved design reference: [prototype/](prototype/). Newest entries first.

Legend: ✅ done · 🟡 in progress · ⬜ not started

| Phase | Status |
|---|---|
| 0 Setup | ✅ 2 Oct 2026 |
| 1 Shell skeleton | ⬜ |
| 2 Agent presence + Team overview | ⬜ |
| 3 Visual layer (WebGL, Liquid Glass) | ⬜ |
| 4 Previews | ⬜ |
| 5 Inbox + Cases + files, pause/resume | ⬜ |
| 6 Optional new domain | ⬜ |
| 7 Landscape only (backup tag, remove old shells) | ⬜ |

---

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
  still covers the window when the test clicks (`_splash_… intercepts pointer
  events`). Needs the test to wait for the splash to finish.
- `npm run lint` cannot run: ESLint 10 is installed but the repo has no
  `eslint.config.*`.
- `npm install` needs `--legacy-peer-deps`: `@vitejs/plugin-react@4` does not
  accept the installed `vite@8`.

**Next: phase 1, shell skeleton.** Landscape layer with static backdrop, glass
dock, Menu, and the flat stage hosting every existing surface; exit test: every
rail surface reachable in ≤ 2 actions, ⌘K/⌘P/⌘J/⌘B work.
