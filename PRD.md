# PRD: Workspace OS - Worlds first IWS (Integrated Workspace Environment)

**Product Name:** Workspace OS  
**Version:** 0.2 — Draft  
**Date:** 2026-06-18  
**Status:** In Progress

---

## 1. Problem Statement

A manager's day is a constant context switch: Outlook for email, Teams for messages, Excel for budgets, Word for reports, PowerPoint for decks, a browser for research, and a separate AI tab for help. Each switch has a cost — reload state, lose your train of thought, re-establish where you were. Studies put context-switching loss at 20–40% of productive time.

The tools themselves are fine. The fragmentation is the problem.

**Workspace OS** is the workspace that ends fragmentation. One window, every file type, every communication channel, a first-class AI that can work across all of it — without switching apps, without switching tabs, without losing context.

> **The only workspace you will ever need.**

**The benchmark:** If a manager can go 3 consecutive days without opening any external application, we have achieved our goal.

---

## 2. Core Principles

1. **Documents are the center, not code.** Word, Excel, PowerPoint, PDF — these are primary. Code editing is secondary.
2. **The AI can touch anything.** The agent has the same read/write access to a budget spreadsheet as it does to a strategy document or a PDF contract.
3. **Zero app switching.** Every tool a manager needs lives in one window. Not "most" tools — all of them.
4. **Sovereignty by default.** All data stays local. No telemetry. Open source document engines. No cloud dependency.
5. **Subscription, not API.** Zero additional cost beyond the user's existing Claude Code subscription.
6. **Give managers the developer's sense of power.** The layout, the terminal, the slash commands, the agent control — all of it. The difference is what's being managed: business work, not code.

---

## 3. Target Users

**Primary:** Managers, directors, VPs, CEOs — anyone who lives in the office suite daily.

| Persona | Daily Tools | Core Pain |
|---|---|---|
| **Manager** | Word, Excel, email, Teams, PDF | 6 apps open, constant switching, AI has no context |
| **Director** | PowerPoint, reports, email chains, contracts | Prep time for meetings is high, no cross-doc intelligence |
| **Executive** | Briefings, email, budgets, strategy docs | Time is the constraint — every switch costs |
| **Operations Lead** | Excel, process docs, email, checklists | Manually copying data between apps all day |
| **Legal / Finance** | PDFs, Word contracts, Excel models | No AI that understands proprietary local documents |

**Not the primary target (v1):** Developers, engineers, data scientists. They can use it, but UX decisions favor the office persona.

---

## 4. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      Workspace OS (Electron)                  │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │                     React Frontend                        │ │
│  │  ┌────────────┐  ┌──────────────────────┐  ┌──────────┐ │ │
│  │  │  File &    │  │       Canvas          │  │  Agent   │ │ │
│  │  │  Nav       │  │  OnlyOffice Writer /  │  │  Panel   │ │ │
│  │  │  Panel     │  │  Calc / Impress /     │  │  (AI     │ │ │
│  │  │  (left)    │  │  PDF.js / Media /     │  │  Chat +  │ │ │
│  │  │            │  │  Monaco (code)        │  │  Actions)│ │ │
│  │  └────────────┘  └──────────────────────┘  └──────────┘ │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │     Command Bar  (/ commands, global search, AI)      │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  └──────────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │                  Electron Main Process                     │ │
│  │  File System │ IPC Bridge │ File Watcher                   │ │
│  │  OnlyOffice Local Server │ Claude CLI Process Manager      │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**Tech Stack:**
- **Shell:** Electron 33 (Node.js + Chromium)
- **Frontend:** React 18 + TypeScript + Vite (electron-vite)
- **Document Editing:** OnlyOffice Document Engine (AGPL) — local server process, iframed
- **Code/Markdown:** Monaco Editor (secondary use)
- **PDF:** PDF.js + annotation layer
- **Images/Video/Audio:** Chromium native rendering
- **Spreadsheet fallback:** FortuneSheet (MIT) for lightweight CSV/table views
- **AI Agent:** Claude Code CLI (spawn process, subscription bridge)
- **Local Search Index:** SQLite FTS5

---

## 5. Layout

### Default Layout

```
┌──────────────────────────────────────────────────────────────┐
│  Workspace OS    [Search / Command Bar]     [notifications]  │
├────────────────┬─────────────────────────────────────────────┤
│                │                                             │
│  File &        │              Canvas                         │
│  Navigation    │   (active document or split view)           │
│  Panel         │                                             │
│  (left)        │   Primary renderer: OnlyOffice /            │
│                │   PDF.js / image / video / Monaco           │
│                │                                             │
│  ─────────── │                                             │
│  Smart         │                                             │
│  Folders       │                                             │
│  Recent        │                                             │
│  Starred       │                                             │
│                │                                             │
├────────────────┴─────────────────────────────────────────────┤
│          Agent Terminal (always visible, bottom panel)        │
│  > /summarize   > /brief   > /compare   > /draft   > /agent  │
└──────────────────────────────────────────────────────────────┘
```

**Core layout philosophy:**
The experience a developer has in their IDE — total awareness, total control, everything reachable — translated to business work. The terminal is not a bash shell; it is the **agent command center**. Always visible. Always ready. This is where managers run agents, launch skills, monitor tasks, and give instructions — the same way a developer runs builds, tests, and deploys from their terminal.

- **Agent Terminal** — always visible at the bottom, always on. Slash commands, agent management, live status of running tasks.
- **File Panel** — always visible left. Reorganizable but never hidden by default.
- **Canvas** — main work surface, center.
- **Agent Chat Panel** — optional right panel for longer back-and-forth with AI; the terminal handles quick commands.
- All panels are **resizable, collapsible, and detachable** into separate OS windows.
- Language is "documents", "folders", "projects" — business vocabulary, not developer jargon.

---

## 6. Features

### 6.1 File & Navigation Panel

**Core:**
- Tree view of local file system (configurable root)
- Expand/collapse folders with single click
- Right-click: New Document, New Folder, Rename, Delete, Duplicate, Reveal in Finder/Explorer
- Drag-and-drop to move/copy files
- Fuzzy file search, instant results

**Office-specific:**
- **Document type icons** — large, readable icons for `.docx`, `.xlsx`, `.pptx`, `.pdf` — not code file icons
- **Rich hover preview** — hover any file to see a thumbnail (first page of doc, first slide of PPT, spreadsheet preview) without opening
- **Recent files section** — pinned at top of panel, configurable count
- **Starred files** — manually star files for quick access
- **Project / Client folders** — first-class organizational concept (not just generic folders)

**Unique features:**
- **Smart Folders** — virtual folders auto-populated by rules:
  - "Modified today"
  - "All files tagged #urgent"
  - "All contracts (PDFs > 5 pages)"
  - "Files shared in last meeting"
- **File tagging** — right-click any file to tag it (#urgent, #review, #done, #Q3). Filter tree by tag.
- **File health badges** — inline indicators: files with open TODOs, files the agent touched, files with unread agent comments
- **Batch AI actions** — select multiple files → "Summarize all", "Extract all action items", "Compare these two"
- **Drag to Agent** — drop any file into the Agent Panel to add it to AI context
- **New from Template** — right-click → choose from document templates (meeting notes, project brief, budget sheet, etc.)
- **Activity heatmap** — subtle color coding of files by recency of edit

### 6.2 Canvas

The canvas is the main work surface. It routes each file type to the right renderer.

**File type routing:**
| File Type | Renderer | Edit? |
|---|---|---|
| `.docx`, `.odt`, `.doc` | OnlyOffice Writer | Yes |
| `.xlsx`, `.ods`, `.xls` | OnlyOffice Calc | Yes |
| `.pptx`, `.odp`, `.ppt` | OnlyOffice Impress | Yes |
| `.pdf` | PDF.js + annotation layer | Annotate only |
| `.png`, `.jpg`, `.gif`, `.svg`, `.webp` | Image viewer (zoom/pan) | No |
| `.mp4`, `.mov`, `.webm` | Video player | No |
| `.mp3`, `.wav`, `.flac` | Audio player with waveform | No |
| `.csv` | Table view (sort, filter, formula) | Yes |
| `.md`, `.txt` | Clean rich text editor | Yes |
| `.ts`, `.js`, `.py`, etc. | Monaco Editor | Yes |
| Unknown | Hex viewer | No |

**Canvas features:**
- **Tab bar** — open files as tabs, drag to reorder, pin tabs, middle-click to close
- **Split view** — open 2 or 4 files side by side (horizontal/vertical)
- **Presentation mode** — full-screen `.pptx` presentation with slide controls
- **Reading mode** — distraction-free view for long documents (no UI chrome)
- **Document outline** — sidebar showing headings / slide list / sheet names
- **Annotations** — highlight + comment on PDFs and images, saved locally
- **Whiteboard tab** — Excalidraw-embedded freeform canvas for diagrams and visual thinking
- **Focus mode** — hide all panels, only canvas visible

### 6.3 Agent Terminal

The agent terminal is the power interface of Workspace OS — always visible at the bottom. It gives managers the same sense of control and overview that a developer gets from their terminal. The difference: instead of running builds and deploys, it runs AI agents, business workflows, and document operations.

This is not a bash shell. It is a purpose-built command environment for managing AI and work.

**Core behavior:**
- Always visible at the bottom of the layout (resizable height, never hidden)
- Accepts slash commands, natural language, and file drops
- Streams live output from running agents and skills
- Shows agent status, task progress, and completion inline
- Multi-tab: run multiple agent sessions simultaneously and switch between them
- Session persistence: sessions survive app restarts

**Slash commands (built-in skills):**
| Command | What it does |
|---|---|
| `/summarize` | Summarize current document or a dropped file |
| `/brief [folder]` | Meeting or topic briefing from a folder of docs |
| `/compare [file1] [file2]` | Side-by-side comparison of two documents |
| `/extract-todos` | Pull all action items from current or dropped files |
| `/draft [type]` | Draft an email, report, or document from context |
| `/translate [lang]` | Translate current document |
| `/agent [task]` | Spawn a background agent to work on a longer task |
| `/status` | Show all running agents and their progress |
| `/snapshot [name]` | Save current workspace state as a named snapshot |
| `/search [query]` | Full-text search across all workspace files |

**File interaction:**
- Drag any file from the file panel into the terminal to add it as context
- Drag external files in to import them into the workspace
- Rich text selection (click-drag, double-click word, triple-click line) — no character-by-character deletion
- Command history with fuzzy search (Ctrl+R)

**Agent management:**
- Running agents appear as live status lines
- `/status` shows all active agents, current step, and estimated completion
- Cancel any agent with `/stop [agent-id]`
- Agent output streams in real time
- Completed tasks show a summary + list of files created or modified

---

### 6.4 Agent Panel

A persistent chat panel (right side, collapsible) for longer back-and-forth conversations with AI. Complements the terminal — the terminal is for quick commands and agent management, the panel is for deeper collaborative work on a document.

For this audience, together they replace the need to ever open a browser AI tab.

**Core:**
- Persistent chat interface with Claude (via subscription, no API cost)
- Agent sees currently open file automatically — no copy-paste needed
- Agent can open, edit, create, and delete files with user approval

**Office-specific AI actions:**
- **Document actions on current file:**
  - "Summarize this document in 5 bullets"
  - "Find all action items and deadlines"
  - "Rewrite the executive summary"
  - "Format this table consistently"
  - "Translate this to German"
  - "Create a slide deck from this report"
- **Cross-document intelligence:**
  - "Compare Q1 and Q2 budget sheets — what changed?"
  - "Extract every commitment I made across this week's meeting notes"
  - "Summarize all contracts in this folder by key risk clauses"
  - "Which of these proposals is strongest? Brief me."
- **Meeting prep:**
  - "Prepare a briefing for my 3pm call — relevant docs are in /Projects/ClientX"
  - "What open items from last week's meeting notes haven't been addressed?"
- **Draft & generate:**
  - "Draft a follow-up email based on the decisions in this meeting note"
  - "Create a project brief template from this example"
  - "Build a budget spreadsheet for a 10-person team based on this breakdown"

**Agent Panel UX:**
- Files can be dragged from the file panel directly into the chat as context
- Agent proposes file changes as diffs — user approves/rejects before write
- Agent session history is searchable
- Slash commands: `/summarize`, `/translate`, `/extract-todos`, `/compare`, `/draft`, `/brief`
- Agent can be invoked from anywhere via global keyboard shortcut (Cmd+Shift+A)

### 6.4 Command Bar

A global command bar (Cmd+Space or Cmd+P within app) replacing the need to navigate menus:

- **File open:** Type any filename, fuzzy match, open instantly
- **Full-text search:** Search across all file content including `.docx`, `.pdf`, `.xlsx` (local SQLite index)
- **AI shortcut:** Type a question → routes to Agent Panel with current context
- **Slash commands:** `/new-doc`, `/new-sheet`, `/new-slide`, `/snapshot`, `/tag`
- Filter by: file type, tag, folder, date

### 6.5 Workspace Snapshots

Save and restore complete workspace states — what's open, panel layout, pinned context.

- Name snapshots: "Q3 Board Prep", "Client X Deep Dive", "Weekly Review"
- Switch between snapshots instantly — like switching between contexts
- Snapshot includes: open tabs, panel sizes, pinned files in agent context, agent terminal sessions
- Great for managers who context-switch between multiple projects/clients

### 6.6 Communication Integration (Roadmap)

The v1 target is files and AI. The path to "zero app switching for 3 days" requires:

**v0.3 — Email:**
- Embedded email client (IMAP/SMTP)
- AI reads email context, can draft replies based on related documents
- Attach files directly from workspace with drag-and-drop

**v0.4 — Calendar:**
- Embedded calendar (CalDAV / Google Calendar API)
- Agent can read today's meetings and surface relevant documents before each one

**v0.5 — Chat / Messaging:**
- Microsoft Teams integration (read + send)
- Slack integration (read + send)
- Agent context spans messages + documents

**v1.0 — Full replacement:**
- No reason to open Outlook, Teams, or a browser for the majority of work

### 6.7 Sovereignty & Privacy

- **100% local data:** Files never leave the machine unless user explicitly shares
- **No telemetry:** Zero usage data sent anywhere
- **Open source engines:** OnlyOffice (AGPL), PDF.js (Apache), FortuneSheet (MIT), Excalidraw (MIT)
- **Local AI index:** Full-text search index lives in SQLite on-device
- **Offline-first:** Full document editing and viewing works without internet
- **Self-controlled sync (optional):** Users may configure sync via their own storage (S3, NAS, Nextcloud)

---

## 7. Out of Scope (v1)

- Real-time multiplayer co-editing
- Cloud storage integration (Drive, Dropbox) — v0.3
- Video calls (Teams video, Zoom) — OS-level limitation, open in system app
- Plugin/extension marketplace — v2
- Mobile app — v2

---

## 8. MVP Scope (v0.1)

The minimum that proves "zero app switching" for a manager:

1. **Layout shell** — File panel + Canvas + Agent Terminal, resizable/collapsible, persisted layout
2. **OnlyOffice Writer** — `.docx` opens and edits natively (this is mandatory for v0.1 — it's the core value)
3. **OnlyOffice Calc** — `.xlsx` opens and edits natively
4. **OnlyOffice Impress** — `.pptx` opens and edits natively
5. **PDF viewer** — PDF.js with highlight + annotation
6. **Image + video viewer** — PNG/JPG/SVG/MP4 in canvas
7. **Agent Terminal (core)** — always-visible command center; current file auto-loaded into context, summarize/explain/edit actions
8. **File panel** — tree view, large document icons, recent files, right-click menu, search
9. **Command Bar** — file open + basic search
10. **Workspace Snapshots (basic)** — save/restore open tabs
11. **Trash + undo for agent actions** — every destructive op (agent or user delete/overwrite) copies the prior version to `.workspace-os/trash` first, restorable from the file panel. *Non-negotiable for the non-technical persona: an agent with delete/overwrite rights and no undo is unsafe.*

**Deferred to v0.2:**
- Full cross-document AI actions
- Smart folders and file tagging
- Monaco editor (code files)
- Relationship graph, activity heatmap
- Full-text search index (SQLite)

---

## 9. Architecture Decisions (Resolved)

| Decision | Choice | Rationale |
|---|---|---|
| **OnlyOffice embedding** | Local server process + iframe | Most reliable cross-platform; OnlyOffice runs as a sidecar process, rendered in a sandboxed iframe in the canvas |
| **Agent bridge** | Spawn `claude` CLI process (AgentDesk model) | Proven approach, zero additional cost, no API key needed |
| **Config storage** | Both — `~/.config/workspace-os/` global defaults + `.workspace-os/` per-workspace overrides | Global for preferences/keybindings, per-workspace for snapshots/tags/layout |
| **File indexing** | SQLite FTS5, background-indexed, incremental via file watcher | Persistent across restarts, handles 10k+ docs, only reindexes changed files; in-memory would be lost on every restart |
| **OnlyOffice licensing** | AGPL — confirmed acceptable for local desktop use | Local server model does not trigger server-side distribution clause |
| **Workspace-root ownership** | Main process owns the active root; renderer can only *request* changes via the folder dialog | The root is the security boundary for all file-system access — it must not live in renderer-controlled storage. Validators scope to this root, not the home directory |
| **Path-traversal guard** | Lexical resolve + symlink (`realpath`) comparison against the root | Lexical checks alone miss symlinks inside the workspace that point outside it |
| **Agent-write safety** | Shadow-git checkpoint before every agent run; one-click revert | The `claude` subprocess writes directly to disk, bypassing the IPC trash layer. A shadow git repo (GIT_DIR under `.workspace-os`, work-tree = workspace) snapshots the whole tree cheaply, is invisible to the user's folder, never collides with their own git, and makes every agent run revertable — including removal of agent-created files. Rollback is itself undoable via an auto safety checkpoint. |

---

## 10. Concurrency & Conflict Model

The core premise — "the AI can touch anything" — means the agent and the user can act on the same file at the same time. This must be designed, not left implicit.

| Scenario | Behaviour |
|---|---|
| Agent edits a file the user has open | The file watcher detects the change; the open renderer shows a non-destructive "This file changed on disk — Reload / Keep mine" banner. No silent overwrite. |
| User edits in OnlyOffice while agent queues an edit | The agent waits for the editor's save callback to settle, then operates on the saved version. Agent edits to an actively-edited doc are deferred, not racing. |
| Two writes collide | Last-writer-wins **only after** the prior version is copied to `.workspace-os/trash` (see MVP #11), so nothing is unrecoverable. |
| External change (Dropbox, another app) | Treated identically to an agent change — watcher-driven reload prompt. |

**Principle:** no write is ever destructive-without-recovery, and no overwrite is ever silent when the file is open.

---

## 11. Production Document Engine (Open Decision)

The current build runs OnlyOffice Document Server as a **Docker** sidecar. This is the right *development* path, but Docker is not acceptable for the CEO/manager persona in production — "install Docker Desktop" is a non-starter.

Options to resolve before v1:

| Option | Pros | Cons |
|---|---|---|
| **Bundled DocumentServer build** | No Docker; ships inside the app | Large binary; per-platform packaging; AGPL bundling review |
| **Collabora Online / LibreOffice headless** | Lighter; LGPL/MPL friendlier | Different embedding API; fidelity differences vs OnlyOffice |
| **Keep Docker, auto-provision silently** | Reuse current architecture | Still requires Docker engine present; heavy |

**Status:** Docker is the dev mechanism. A production engine decision is required before v1 and should not block Phases 6–8, which are engine-agnostic.
