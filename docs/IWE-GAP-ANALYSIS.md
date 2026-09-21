# IWE Gap Analysis & Roadmap — Workspace OS vs. a Daily-Driver Work Environment

**Benchmark (PRD):** a manager goes 3 consecutive days without opening any external application.
**Reference frame:** mature IDE shells (VS Code / Antigravity) for *structure*; the product is an office/work environment, not a code IDE.
**Method:** codebase audit of `src/renderer/src/components/**`, `src/main/**`, `PRD.md`, `docs/PROGRESS.md` (2026-07-02).

Legend: **MUST** = blocks the 3-day benchmark · **SHOULD** = strong daily-driver value, not blocking · **SKIP** = wrong for the IWE persona.

---

## 1. Window / Menu Chrome vs IDE Reference

What exists (`src/main/index.ts`, lines 107–468): app menu + **File / Edit / Format / Insert / View / Agent / Window** — Format/Insert/View swap per office doc type via `menu:set-office-context`; Agent menu is dynamic (`menu:set-agent-menu`). Strong office verbs, weak *navigation* and *workspace* verbs.

| Gap | Status today | Verdict | Why |
|---|---|---|---|
| **Go menu** (go to file/slide/sheet/heading, back/forward) | Absent; only ⌘K search (`useKeyboardShortcuts.ts`) | **MUST** | Navigation is the #1 thing a 3-day resident does hundreds of times |
| **View → panel toggles** (sidebar ⌘B, terminal ⌘J) | Sidebar toggle is a TitleBar button only (`Layout/TitleBar.tsx`); terminal not collapsible | **MUST** | Keyboard-first panel control is the cheapest "feels like a real tool" win |
| **File → Open Recent / Save As / Export as PDF** | No recent workspaces (`workspace-root.ts` persists one root); no Save As/Export | **MUST** | Managers live in "reopen yesterday's folder" and "send as PDF" |
| **Help menu** (welcome, shortcuts, report issue) | Absent | **SHOULD** | Trust + discoverability; trivial cost |
| **Window → multiple windows** | Single instance enforced (`index.ts:32` `requestSingleInstanceLock`) | **SHOULD** | Two-monitor managers exist; defer behind split view |
| **Run/Debug-style menu** | Agent menu already covers it | **SKIP** | Agent menu *is* our Run menu — extend it, don't add another |
| **Selection menu** | Edit covers office selection | **SKIP** | IDE artifact; office Edit menu is the right shape |

### Proposed menu tree (delta only)

```
File:    New Document ▸ (md/docx/xlsx/pptx) · Open Folder ⌘O · Open Recent ▸ ·
         Save ⌘S · Save As… ⇧⌘S · Export as PDF… · Print ⌘P · Reveal in Finder ·
         Close Tab ⌘W · Close Folder ⇧⌘W
Edit:    (existing per-doc-type) + Find in Files ⇧⌘F
View:    Toggle Sidebar ⌘B · Toggle Terminal ⌘J · Toggle Agent Panel ⇧⌘A ·
         Appearance ▸ (Light/Dark/System) · Zoom ⌘+/−/0 · Split Editor Right ⌘\
Go:      Quick Open ⌘K · Go to Slide/Sheet/Heading ⌘G (doc-type aware) ·
         Next/Prev Tab ⇧⌘]/[ · Back/Forward (tab history) ⌃−/⌃⇧−
Insert:  (existing, office-context)      Format: (existing, office-context)
Agent:   (existing) + Rerun Last · Cancel All · Checkpoints ▸ (list/rollback) · Run History
Window:  (existing) + Open Tabs list · New Window (later)
Help:    Welcome · Keyboard Shortcuts · Documentation · Report Issue · About
```

---

## 2. Activity Bar — the IWE Equivalent

VS Code's activity bar = Explorer / Search / SCM / Run / Extensions. The IWE translation, mapped to what exists:

| Rail item | IDE analog | Exists today | Missing | Verdict |
|---|---|---|---|---|
| **Files** | Explorer | ✅ `FilePanel/FilePanel.tsx` (tree, star, recent, rename, trash, new-doc) | Virtualization for big trees | **MUST** (keep; virtualize later) |
| **Search** | Search view | 🟡 Backend done: SQLite FTS5 + extractors (`src/main/search/index-db.ts`, `indexer.ts`); UI is ⌘K palette only (`CommandBar/CommandBar.tsx`) | Dedicated results panel: grouped by file, snippet list, click-to-open-at-hit, filters (type/date) | **MUST** — the index is built and mostly invisible; this is paid-for value unshipped |
| **Agents / Runs** | Run & Debug | 🟡 One agent console (`AgentTerminal/`), no run list | Session list, run history, per-run status/cost, jump-to-run | **MUST** — agents are the product's differentiator; give them a home, not a strip |
| **Components / Assets** | Extensions (loosely) | 🟡 `Canvas/renderers/ComponentsPanel.tsx` exists but only inside Impress | Promote to rail: browse/insert components across doc types | **SHOULD** — differentiator, but Impress-scoped is fine short-term |
| **Tasks / Checkpoints** | Timeline/SCM | 🟡 Shadow-git backend (`src/main/checkpoint.ts`, `handlers/checkpoint.ts`: list/rollback/diff) — no renderer surface except per-run revert button | Checkpoint timeline: what changed, when, by which run; restore/diff | **MUST** — trust in agent edits is the adoption blocker |
| **Trash** | — | ✅ `Trash/TrashView.tsx` + `src/main/trash.ts` | Nothing major | keep |
| **Source Control** | SCM | ⬜ none | — | **SKIP** — managers don't do git; shadow-git checkpoints are our version story |

**Form factor:** a slim icon rail left of the FilePanel that swaps the sidebar's content (Files ⇄ Search ⇄ Runs ⇄ Checkpoints ⇄ Trash). Reuses the existing sidebar geometry (`usePanelSizes.ts`) — no docking framework needed.

---

## 3. Panel System

Today: fixed 3-pane — resizable sidebar (160–600px) | canvas | resizable bottom terminal (120px–70%), persisted in `usePanelSizes.ts`. No collapse for the terminal, no splits, no docking (`Layout/WorkspaceLayout.tsx`).

| Capability | Verdict | Why |
|---|---|---|
| Collapsible terminal + sidebar with keybindings (⌘J/⌘B) | **MUST** | Managers want a clean full-canvas writing mode; two booleans + CSS |
| Bottom panel **tabs**: Agent · Shell · Run Output (per-run log) · Doc Issues (later) | **MUST** | One strip hosting N sessions is the terminal-redesign substrate (§4) |
| **Split editor** (2-up side-by-side docs) | **SHOULD (M)** | Review workflows: contract vs redline, deck vs notes. `useTabManager.ts` needs a groups concept; LOK already handles multiple resident docs (multidoc cache exists) |
| Secondary right sidebar (doc outline / slide rail / agent context) | **SHOULD (S)** | `SlideRail.tsx` already exists inside the Impress renderer; generalize to outline-for-Writer, sheets-for-Calc |
| "Doc Issues" panel (Problems analog: broken links, missing fonts, overflow text, #REF! errors) | **SHOULD (M)** | Genuinely novel IWE value; needs LOK diagnostics plumbing first |
| Free docking / floating / drag-anywhere panels | **SKIP** | Enormous cost, near-zero manager value; fixed-slots + toggles covers 95% |
| Ports/Remote panels | **SKIP** | No analog in the IWE domain |

---

## 4. Terminal & Agent UI Deep-Dive

### 4.1 Current state (audited)

| Aspect | Agent console (`AgentTerminal/`) | Shell (`ShellTerminal.tsx`) |
|---|---|---|
| Rendering | React `<div>` per line; chunks concatenated into state (`useAgentSession.ts:67-71`) | xterm.js 5.3 + node-pty (real VT) |
| ANSI/VT | **None** — colors/spinners from claude CLI would render as garbage or get stripped | Full |
| Scrollback | **Unbounded array** (memory bloat; O(n) re-render per chunk) | xterm ringbuffer |
| Search / links / copy | None / none / browser-select | No search addon loaded; `WebLinksAddon` ✅; native copy |
| Sessions | **One** console, one `conversationId` (reset by `/clear`); main keeps LRU-50 conversations (`handlers/agent.ts:31`) and captures the claude session id for `--resume` | One PTY, no tabs |
| Persistence | Lost on app restart (both the transcript and the resume id) | Lost |
| Spawn | `claude -p --output-format stream-json --include-partial-messages` + `--resume`; safe mode = `--allowedTools Read,Glob,Grep,Write,Edit,Bash(wos-gen:*)`, full = `--permission-mode bypassPermissions` (`handlers/agent.ts:148-178`) | login shell via node-pty |
| Controls | cancelAll (SIGTERM), per-run **Revert** to pre-run checkpoint, artifact auto-open, /commands + skills | Ctrl-C works |
| Cost/turns | **Not shown** — stream-json `result` events carry usage/cost; we drop them | n/a |
| Diff preview | `checkpoint:diff` IPC exists (name-status) — **computed but never surfaced** | n/a |
| Interactive permission prompts | **Impossible in `-p` mode** — permissions are pre-set flags, so full mode runs `bypassPermissions` | n/a |

**Verdict:** the shell is terminal-grade; the agent console is a chat UI with terminal styling. The good news: everything hard (streaming, resume, checkpoints, artifacts) already exists in main — this is a renderer-layer rebuild, not an engine rebuild.

### 4.2 Recommended architecture: one xterm substrate, two session types

Render **agent sessions through xterm.js too** — claude CLI output *is* ANSI, and we already ship the stack. Keep the structured stream-json pipeline (it powers checkpoints, artifacts, cost); write the text deltas into xterm instead of React state.

```
TerminalPanel (bottom strip, tabbed)
├─ SessionTabs           one tab per session: [Agent: quarterly-report] [Agent: safe] [zsh] [+]
├─ TerminalView          ONE xterm instance per session (agent or shell)
│   ├─ addons: Fit, WebLinks, Search, Serialize   ← Search+Serialize are new
│   ├─ scrollback: 10_000 (agent) / 5_000 (shell)
│   └─ run markers: xterm registerMarker()+registerDecoration() per agent run
│        └─ RunDecoration (React portal): status dot · elapsed · cost/turns ·
│           "Files changed (3)" chip → DiffSheet · Revert · Rerun
├─ RunSidecar (optional right list inside panel): run history for this session
└─ TerminalInputBar      keep the current smart input (history, /commands, mode
                         toggle, context chips) — docked under the xterm view
```

Component/plumbing changes, concretely:

| Piece | Change | Size |
|---|---|---|
| `TerminalSession.tsx` | Replace line-map rendering with an xterm mount; keep `TerminalInput` as-is | M |
| `useAgentSession.ts` | Becomes `useAgentSessions` (plural): `Map<sessionId, {convoId, runs[], xtermRef}>`; chunks go `term.write(chunk)` — kills the unbounded-array + O(n) re-render problem in one move | M |
| `handlers/agent.ts` | Emit structured sidecar events: parse `result` usage/cost → new `agent:run-meta (runId, {costUsd, turns, durationMs})`; already have `agent:done` with checkpointId | S |
| Persistence | On app quit: Serialize-addon dump + `{conversationId, claudeSessionId}` per session → `userData/sessions.json`; on relaunch restore scrollback and offer "Resume conversation" (main already captures the resume id, `agent.ts:271`) | M |
| Search | Load `@xterm/addon-search` for both session types; ⌘F when panel focused | S |
| Kill/restart | Per-run cancel (exists as cancelAll — scope it) + "Rerun" from run decoration (prompt is in history) | S |
| DiffSheet | Surface existing `checkpoint:diff`; upgrade main to also return per-file unified diffs; render in Monaco diff editor; buttons: Revert all (exists) / Keep | M |
| Run history view | Persist `{prompt, cost, files changed, checkpointId, ts}` per run to disk; list in Agents/Runs rail item (§2) | M |

### 4.3 Verdicts

| Feature | Verdict | Why |
|---|---|---|
| xterm-render agent output (ANSI-correct, scrollback, copy, search, links) | **MUST** | "Terminal-exact with a nicer skin" is exactly this; also fixes the perf flaw |
| Multiple concurrent sessions + tabs | **MUST** | Main already supports 50 conversations; renderer is the bottleneck |
| Session persistence/restore (`--resume` across restarts) | **MUST** | A daily driver cannot amnesia every morning |
| Per-run cost/turn indicators | **MUST** | Trust + subscription awareness; data already in stream-json |
| Diff preview before/alongside revert | **MUST** | Blind revert is why users fear agent edits; IPC already exists |
| Run history (searchable, re-runnable) | **SHOULD** | High value, needs the rail item first |
| Interactive PTY mode (spawn full `claude` TUI in node-pty+xterm) | **SHOULD (spike)** | Free interactive permission prompts and plan mode; loses per-run checkpoint hooks — evaluate as an "advanced session" type, don't bet the panel on it |
| Per-file selective apply/revert of agent edits | **SHOULD** | After DiffSheet; shadow-git makes it feasible |
| Emulating a TUI in React (custom VT parser) | **SKIP** | That's what xterm is for |

---

## 5. Missing IWE Table-Stakes

| Item | Today | Verdict / Size | Notes |
|---|---|---|---|
| **Global search UI** | FTS5 index + extractors done; only ⌘K palette consumes it | **MUST / M** | §2 Search rail item; biggest unshipped asset |
| **Quick-open quality** | ⌘K substring match, 150ms debounce, no fuzzy, no MRU ranking (`CommandBar.tsx`) | **MUST / S** | Add fuzzy scoring + recents-first; also add command mode (`>` prefix) for menu verbs |
| **Tab/session restore** | Tabs lost on quit (`useTabManager.ts` in-memory) | **MUST / S** | Reopen yesterday's desk exactly |
| **Recent workspaces** | Only current root persisted (`workspace-root.json`) | **MUST / S** | File → Open Recent |
| **Workspace snapshots** (PRD MVP #10, unbuilt) | Shadow-git exists for agent runs only | **MUST / M** | Named "save my whole desk" snapshots = manager's version control; reuse `checkpoint.ts` |
| **Auto-update** | None (no electron-updater in package.json) | **MUST / M** | 3-day residency implies you ship fixes without asking users to reinstall |
| **Settings depth** | 3 settings + env status (`Settings/SettingsPanel.tsx`) | **SHOULD / M** | Add: default zoom, font, autosave interval, terminal scrollback, index exclusions, theme=system |
| **Keybinding customization** | Hardcoded (6 in-app + menu accelerators) | **SHOULD / M** | A JSON map + Help→Shortcuts page first; full remap UI later |
| **Themes** | 2 (light/dark) | **SHOULD / S** | Add follow-system; theme *marketplace* = **SKIP** |
| **Crash reporting** | None | **SHOULD / S** | Local-first: Electron crashReporter → disk + "share report?" dialog; no silent upload |
| **Onboarding** | Empty-canvas hint only (and it says ⌘P while the binding is ⌘K — fix) | **SHOULD / S** | One welcome tab: open folder, meet the agent, 5 shortcuts |
| **Telemetry opt-in** | None | **SKIP (defer)** | PRD sovereignty principle; crash reports cover the acute need |
| **Extension marketplace** | Skills system exists | **SKIP** | Skills + components *are* the extension story |
| **Git UI, debugger, language packs** | None | **SKIP** | Code-IDE features; Monaco defaults suffice for the persona |

---

## 6. Phased Roadmap (Performance → Features → Security → Testing → Hardening)

| Loop | Item | Size | Verdict |
|---|---|---|---|
| **Performance** | Agent output via xterm (kills unbounded array + per-chunk re-render) | M | MUST |
| | FileTree virtualization (large workspaces) | S | SHOULD |
| | Re-enable bounded incremental watch >8k files (indexer) | M | SHOULD |
| **Features** | Terminal panel: tabs, multi-session, search addon, cost chips, kill/rerun | L | MUST |
| | Session + tab restore, `--resume` across restarts | M | MUST |
| | Go/View menus + ⌘B/⌘J + fuzzy quick-open + command mode | M | MUST |
| | Search rail item (global content search UI) | M | MUST |
| | DiffSheet (surface checkpoint:diff) + Checkpoints rail item | M | MUST |
| | Recent workspaces; Save As / Export as PDF | S | MUST |
| | Workspace snapshots (PRD #10) | M | MUST |
| | Split editor (2-up) · outline sidebar · Doc Issues panel · components rail | M–L each | SHOULD |
| | Interactive-PTY agent session spike | S spike | SHOULD |
| **Security** | Replace full-mode `bypassPermissions` with a permission-prompt broker (needed once sessions persist) | M | MUST |
| | Keep: sandbox/CSP posture (`security.ts`) is already strong | — | — |
| **Testing** | Playwright e2e over WORKSPACE_TEST_ROOT: session restore, search, revert flows | M | MUST |
| **Hardening** | Auto-update (electron-updater + signed builds) | M | MUST |
| | Crash reporter (local) + onboarding welcome tab + Help menu | S | SHOULD |

### Recommended next 3 sprints

| Sprint | Theme | Cut |
|---|---|---|
| **1 — "A real terminal"** | Agent console becomes terminal-grade | xterm agent rendering + run markers/decorations · session tabs (agent×N + shell×N) · search addon both terminals · per-run cost/turns · scoped kill/rerun |
| **2 — "Get around like an IDE"** | Navigation & chrome | Go/View/Help menus · ⌘B/⌘J toggles · fuzzy quick-open + `>` command mode · Search rail panel · recent workspaces · fix ⌘P hint |
| **3 — "Never lose work, never fear the agent"** | Persistence & trust | Tab/session restore + `--resume` · DiffSheet + Checkpoints rail · workspace snapshots (PRD #10) · permission-prompt broker groundwork |

Auto-update lands in the following hardening pass, before any external beta.

---

*Sources: `src/main/index.ts` (menus, window, lifecycle) · `src/main/handlers/agent.ts` (spawn/stream/resume) · `src/main/checkpoint.ts` + `handlers/checkpoint.ts` (shadow-git, list/rollback/diff) · `src/main/search/*` (FTS5 pipeline) · `src/renderer/src/components/{Layout,FilePanel,CommandBar,AgentTerminal,Canvas,Settings}/**` · `PRD.md` v0.2 · `docs/PROGRESS.md`.*
