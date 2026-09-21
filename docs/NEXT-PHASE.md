# Workspace OS — Next Phase Plan (v0.3)

Captured 2026-06-19. Three goals, each planned step by step.

---

## Goal 1 — UI Iteration (clean corporate, forward-thinking)

**Target feel:** Microsoft Word / macOS native apps (Pages, Numbers) — calm, spacious,
professional, instantly legible — but forward-thinking, not dated. Built for
executives and managers, not developers.

### Icon strategy (decision)

Two icon systems, used for different jobs — this is the clean answer to "does
Lucide have everything":

| Use | Library | Why |
|---|---|---|
| **UI chrome** (toolbar, panel headers, buttons, menus, tabs) | **Lucide** | Consistent, professional line icons; covers every UI affordance. NOT emojis. |
| **Per-file-type icons** (the small icon at the *start* of each file row) | **Material Icon Theme** SVGs (the VS Code set) or `vscode-icons` | Covers hundreds of extensions with recognizable, branded marks (Word/Excel/PPT/PDF/code). Lucide only has generic `FileText`/`FileSpreadsheet` — not per-type. |

**Implementation:** a `fileIconFor(name, isDirectory)` resolver that maps
extension → imported SVG component, with a sensible fallback. Replaces the
current emoji map (`fileIcons.ts`). Office types (`.docx/.xlsx/.pptx/.pdf`) get
their distinctive brand-colored marks so a manager scans the tree by shape/color,
not by reading extensions.

### Design system foundations to introduce

- **Design tokens**: spacing scale, type scale, radii, elevation, a refined
  light + dark palette (today's is a dev dark theme; add a polished light theme
  as default for the office persona).
- **Density control**: comfortable default, compact option.
- **Motion**: subtle, purposeful (panel transitions, tab open) — never flashy.
- **Empty states & onboarding**: first-run "Open a folder" should feel inviting.

### The design prompt — see "UI Design Prompt" section below.

---

## Goal 2 — Full IDE-grade functionality (per-file actions everywhere)

The app should expose every action a user expects, from BOTH the canvas and the
menu bar, contextual to the open file type.

### 2a. Editor/canvas capabilities
- Find & replace in the canvas (Monaco has it; wire a unified Cmd+F across
  renderers — text, PDF text search, spreadsheet filter).
- Outline / structure panel (headings, slides, sheet tabs).
- Split view, compare/diff.

### 2b. Per-file-type action system (the core new architecture)
A registry mapping `fileType → actions[]`, surfaced in the **menu bar**, a
**canvas toolbar**, and the **right-click** menu. Each action declares which
types it applies to:

| File type | Actions |
|---|---|
| Word/Calc/Impress | Save, Save As, Export (PDF/ODF/…), Print, Page setup |
| PDF | Annotate, Export annotated, Print, Extract text |
| Image | Export as…, Resize, Copy |
| Code/Text | Save, Format, Find/Replace |
| All | Rename, Duplicate, Reveal, Move to trash, Properties |

Build it as a declarative `ActionRegistry` so adding a type or action is data,
not new menu plumbing. The menu bar reads the active file's type and
enables/disables accordingly.

### 2c. Export/convert pipeline
"Save As / Export" for office docs routes through the document engine's
conversion API (OnlyOffice can convert docx↔pdf↔odt). This is the natural bridge
to Goal 3.

---

## Goal 3 — Native Office integration (the big one)

**Today (MVP):** we embed the OnlyOffice editor (web app in an iframe, backed by
a Docker container). Works, but it's a separate engine bolted on — heavy
(4GB container, ~60s cold boot, 147% CPU), and doesn't *feel* native.

**Goal:** office editing that is genuinely part of the application — one
workspace, no container, no "loading editor," themed to match, fast.

### Honest assessment of the paths (they differ enormously in effort)

| Path | What it is | Effort | Native-ness |
|---|---|---|---|
| **A. Deeply integrate OnlyOffice** | Self-host the editor's static assets *inside* the app (no Docker — run the document services as a bundled sidecar binary), strip its chrome, theme it to match, drive via the API | Medium-large | Feels native; still web tech under the hood |
| **B. LibreOfficeKit (LOKit)** | Embed LibreOffice's actual rendering/editing core (the engine Collabora uses) via its C++ API; render tiles into our own canvas | Large | Truly native rendering, our own UI shell |
| **C. Build our own document engine** | Implement OOXML/ODF parsing + layout + editing from scratch | Enormous (years) | Fully native, fully ours |

**Recommendation — phased, not all-or-nothing:**

1. **v0.3 — Remove Docker dependency (Path A, step 1):** bundle the OnlyOffice
   DocumentServer as a packaged sidecar (or switch to a lighter self-hosted
   build) so there's no "install Docker" and no 4GB image. Same editor, but
   shipped *with* the app. Biggest UX win for least risk.
2. **v0.4 — Theme + de-chrome the embedded editor (Path A, step 2):** hide
   OnlyOffice's own toolbars where we want our menu bar to drive, match colors
   and fonts, so the seam disappears. It starts to *feel* like our editor.
3. **v0.5+ — Evaluate LOKit (Path B):** spike LibreOfficeKit for true-native
   rendering as the long-term engine. Decide based on fidelity + effort vs the
   themed-OnlyOffice approach.

The licenses (AGPL OnlyOffice, MPL/LGPL LibreOffice) permit building our own
integrated version — so "make it our own native version" is achievable; the
question is which engine and how deep, sequenced above.

---

## Suggested sequencing

1. **UI iteration first** (Goal 1) — highest visible impact, makes it demoable,
   unblocks showing it to people. Run the design prompt, rebuild the shell.
2. **Per-file action system** (Goal 2b) — the architecture everything else hangs
   off (menus, export, toolbars).
3. **Remove Docker / bundle the engine** (Goal 3, step 1) — kills the worst UX
   wart (cold boot, install Docker).
4. Iterate deeper on native office and remaining editor capabilities.

---

## UI Design Prompt

> See the prompt block in chat / the section below — paste into Claude Code (or
> run the `frontend-design` skill) to generate the redesigned shell.
