# Goal: everything in the landscape design

Status: A1–A3 and B1–B5 done, B6 built, C (regression + ship) next. 2 Oct 2026.
Branch `feat/landscape-adoption` (from `master` at v0.2.0).
Follows [PLAN.md](PLAN.md) (the shell) and [PROGRESS.md](PROGRESS.md); the log of
this goal is the "Adoption" section at the top of PROGRESS.md.

**Goal.** Every surface of Workspace OS looks like it belongs to the Screen
Landscape, and every function of the old Home, Files, Browser, Cockpit and the
other "applications" is reachable from the new design. Nothing the user could do
before is lost. Each step is tested in the real app before the next starts.

## 1. What the analysis found

Sources: four read-only code analyses (design language; Home + Cockpit; Files +
documents; Browser + remaining surfaces) and screenshots of every view in v0.2.0.

1. **Two designs in one app.** The landscape views (Overview, Inbox, Cases,
   Menu) use `.wl`: mist, Newsreader headings, ink pills, translucent paper,
   no shadows, no blue. Everything opened from the Menu lands on the *stage*,
   which still wears the previous design (`.wos`: grey `#f5f5f7`, Hanken
   Grotesk, blue `#0071e3` buttons, shadowed cards), with its own topbar.
2. **The stage already sits inside `.wl`** (`div.wl > div.wos`), so every
   `--wl-*` value is reachable from the old surfaces. They read ~15 shared
   variables (`--color-border` 292 uses, `--color-text` 243, `--wos-hair` 187,
   `--wos-ink` 176 …). Remapping those inside the stage re-skins most of the
   app at once. Blockers: the `!important` rule on every class containing
   "title" (`tokens.css:113`), hard-coded `background/font` on the stage root
   (`WorkspaceShell.module.css:4-13, 204-210`), ~60 hard-coded colours in the
   office chrome (LokRenderer, MetricsPanel), Monaco's stock theme.
3. **Home was never moved.** PLAN.md §4 promised Home's widgets as "a second
   band later". Missing in the landscape: calendar (next 48 h), mail, "While you
   were away", recent/created files, open and visited pages, the hero "one loud
   thing" with snooze, the desk assistant, recent workspaces + Open folder.
4. **Cockpit is still only on the stage.** Missing in the landscape: Stream
   (history by day), Map, Landed results, case actions (New case, scope, hand
   to an agent, schedule, Data tab), cost/turns per run, mail-needs-reply.
5. **Files.** The landscape shows case files as raw paths; no thumbnails,
   search, recent/starred, trash or context menu. Every file open drops onto the
   old stage. FileTree uses native `prompt/confirm`. `Canvas/TabBar.*` is dead.
6. **Browser.** The whole chrome (tabs, groups, omnibox, history/bookmarks,
   find, zoom, assistant panel) is old design. Tabs have no `owner`, so only the
   single latest agent-driven page can be previewed. There is no downloads UI.
7. **Duplicates.** Approvals exist four times (Feed, Cockpit, Inbox, Focus);
   team roster twice; cases twice; Connectors twice (surface + Settings).
   ⌘K, ⌘P and the terminal dock are mounted in the old shell and show the old
   design even over the landscape. There is no toast layer.

**Constraints that do not move:** never transform an ancestor of a webview,
LibreOffice canvas, xterm or Monaco (WOS-011, click mapping via
`getBoundingClientRect`); no glass, `filter` or `backdrop-filter` over those
rectangles; the backdrop is paused while the stage shows, so the stage uses
plain translucent CSS, not WebGL glass; keep `isolation:isolate` on `.surface`
and the `application/x-wos-path` drag type.

## 2. The idea

**One world, two distances.** The landscape is where you look *at* your work;
the stage is where you *do* it. Both get the same materials (mist, paper, ink,
Newsreader, pills) so moving between them feels like stepping closer, not
switching apps. The stage gets the landscape's navigation (the dock items in
its topbar), so there is one way to move around.

Functions move into the landscape only where they are about *overview*
(today, history, what landed, what needs you). Tools you work *in* (browser,
documents, mail, calendar, files, terminal) stay on the stage, restyled, one
click from the landscape.

| Old | New home | How |
|---|---|---|
| Home widgets | **Overview, "Today" band** below the team | Greeting + hero line in the header; band of cards: Next (calendar), Mail, While you were away, Files, Pages; "Ask your workspace" composer = desk assistant. Recent workspaces + Open folder in the project menu. |
| Cockpit Stream | **Inbox → History** tab | Day-grouped history with the "last looked here" mark. |
| Cockpit Landed | **Inbox → History** (results kept) | |
| Cockpit Map, Head-of river | **Cases → Map / Board** tabs | Reuse MapView / river data in `.wl` style. |
| Cockpit case actions | **Cases** | New case, scope, hand to agent, schedule, Data tab, file thumbnails. |
| Cost / turns | **AgentFocus** | From `reviewStore.costUsd`. |
| Mail needs reply | **Inbox** | New `mail` kind in `inboxModel`. |
| Files | **Library → Files** + restyled stage Files | Library becomes Files · Knowledge · Memory; the landscape tab shows recent, starred, created and search with thumbnails; folders and editing open the stage. |
| Browser | Restyled stage browser | + tab `owner` → every agent screen shows *its* tab; downloads list. |
| Mail, Calendar, Knowledge, Memory, Agents, Connectors, Settings | Restyled stage surfaces | Same functions, new materials. Routines + Create agent reachable from Overview. |
| ⌘K, ⌘P, terminal dock, Splash | Restyled | One look over landscape and stage. |
| Toasts | New small toast layer | Replaces scattered inline confirmations. |

Nothing is removed in this goal. Retiring duplicates (Cockpit, Agents/Feed,
HomeDashboard) is listed at the end as a **separate decision** once the new
homes are proven.

## 3. Phases, each with an exit test

All exit tests run against the real app (`out/main` via Playwright), read real
state, and are seen to fail without the change (memory: run the negative case).
Screenshots of every touched view go into the review before a phase closes.

| # | Phase | Exit test |
|---|---|---|
| A1 | **Materials on the stage.** `.wl .wos` remaps `--wos-*` and `--color-*` to landscape values (mist bg, paper cards, ink accent, Inter, no shadows); narrow the `title` rule so it no longer forces weight/colour; stage root and body take mist. | `e2e/landscape/adoption-materials.mjs`: computed styles of stage root, a Files row, a Mail button, a Browser tab, an office ribbon button read landscape values (font Inter, accent = ink, bg mist); no `rgb(0, 113, 227)` left on any visible element of 11 surfaces. Office A-ribbon + layout 20/20 still pass. |
| A2 | **Stage chrome = landscape chrome.** Topbar: the dock's items (Overview · Inbox · Cases · Library · Menu) as pills replace the lone "Landscape" button; tabs become paper pills; ⌘K pill, Terminal, Fill in landscape style. Shared `ui/landscape` primitives (Pill button, Panel, SectionLabel, EmptyState) extracted from the duplicated view CSS. | stage.mjs extended: each topbar item leads to the right landscape view; tabs open/close; ⌘K/⌘P/⌘J/⌘B unchanged (31/31 + new checks). |
| A3 | **Per-surface polish.** Serif surface headings, ink primary pills, hairline rows, landscape empty states on Files, Browser chrome, Mail, Calendar, Knowledge, Memory, Agents, Connectors, Settings, Trash, CanvasToolbar; office chrome hard-coded colours → tokens; Monaco `wl` theme; ⌘K, ⌘P, terminal dock, Splash; FileTree native prompt/confirm → styled dialogs; delete `Canvas/TabBar.*`. | Screenshot review of every surface; adoption-materials.mjs extended to headings (Newsreader) and dialogs; existing suites (files-browser, browser-tabs, review, views-and-dock, office A/C) unchanged. |
| B1 | **Today band (Home → Overview).** Header greeting + hero line (case/meeting/agent-led, snooze); band: Next, Mail, While you were away, Files, Pages; "Ask your workspace" composer running the desk assistant; recent workspaces + Open folder in the project menu. Pure `todayModel.ts` from `homeModel`/`deskModel` (tested). | `e2e/landscape/today.mjs` with a seeded throwaway workspace: a case note, a finished run, a created file and a calendar fixture appear in the right cards; hero picks the waiting case; snooze hides it; the composer starts a run that lands in Inbox; Menu → Home opens the Overview. |
| B2 | **Inbox gains mail and History.** `mail` kind from `mailReviewStore`; History tab (Stream + Landed) with day groups and the last-looked mark. | inbox.mjs extended: a seeded mail-review item shows and opens Mail; History lists the seeded run/note by day; last-looked mark moves. |
| B3 | **Cases gains Cockpit's tools.** New case, scope, hand to agent, schedule to calendar, Data tab, Map and Board tabs, file thumbnails (`FileThumb`). Cost/turns in AgentFocus. | work.mjs extended: create case → appears on shelf and disk; hand to agent arms a run; Map shows the case; thumbnails render for docx/png; AgentFocus shows cost for a seeded run. |
| B4 | **Library = Files · Knowledge · Memory.** Landscape Files tab: recent, starred, created, search (search index), thumbnails, open → stage, reveal → stage Files; Knowledge and Memory tabs with "Open full". | `e2e/landscape/library.mjs`: seeded files appear with thumbnails; search finds one; open lands on the stage tab; Knowledge/Memory tabs list seeded items. |
| B5 | **Browser ownership + downloads.** `owner` on `BrowserTab` (set by agent actions), previews per run; downloads list in the browser chrome. | presence.mjs extended: two runs driving two tabs show two different previews; a download from a local test server appears in the list. |
| B6 | **Toasts + agent tools.** Small toast layer (landscape style) for keep/deny/revert/accept; Routines and Create agent reachable from Overview. | inbox.mjs: an action raises a toast that fades; Overview "Create agent" opens the Foundry. |
| C | **Regression + ship.** Full unit suite, typecheck, all landscape e2e, the regression table from PROGRESS.md (no suite worse than at v0.2.0), perf.mjs budget (≤ 4 ms scrolling, 0 idle frames), screenshots of every view; update PROGRESS.md; merge; ship. | Everything above green; release installed and launched. |

## 4. Later, as a separate decision

- Retire duplicates once their new homes are used: Cockpit surface,
  Agents/Feed + Fleet (→ Inbox + Overview), HomeDashboard (→ Today band),
  Settings' Connectors panel (→ Connectors).
- Dark mode for `.wl` (the old design had one; the landscape is light only).
- Documents and mail as "work screens" in the landscape (PLAN.md §4).
