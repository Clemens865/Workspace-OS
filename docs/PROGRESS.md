# Workspace OS — Progress Tracker

**Living document.** Status of the product against the [PRD](../PRD.md), updated as
we ship. Legend: ✅ done · 🟡 partial / in progress · ⬜ not started · ❓ unverified · 🔭 roadmap

> **Last updated:** 2026-06-25
> **One-line status:** Native, Docker-free office suite (Word/Excel/PowerPoint) with
> live editing, a real interactive design canvas, an agent command center, and a
> Framer-style reusable **component system** that works across all three apps.

---

## 1. Vision vs. reality (the PRD benchmark)

The PRD's north star: *"If a manager can go 3 consecutive days without opening any
external application, we have achieved our goal."* We are not there yet — the gating
gaps are **communication** (email/calendar/chat, PRD §6.6, all roadmap) — but the
**document core is real and native**, which was the hardest and most important part.

**Biggest deviation from the PRD (resolved, for the better):** the PRD (written around
OnlyOffice + a Docker sidecar, see §4 and the "open decision" in §11) has been
**superseded**. We pivoted to a **bundled headless LibreOffice engine driven via
LibreOfficeKit (LOKit)**, rendering into our own canvas. OnlyOffice and Docker are
**fully removed**. This resolves PRD §11 and the NEXT-PHASE Goal-3 "which engine"
question — Path B (LOKit) shipped.

---

## 2. MVP (v0.1) scorecard — PRD §8

| # | MVP item | Status | Notes |
|---|----------|--------|-------|
| 1 | Layout shell (File panel · Canvas · Agent Terminal, resizable, persisted) | ✅ | Compacted top chrome (5→3 rows) |
| 2 | Word (`.docx`) opens + edits natively | ✅ | LOKit, not OnlyOffice |
| 3 | Excel (`.xlsx`) opens + edits natively | ✅ | Formula bar, sheet management |
| 4 | PowerPoint (`.pptx`) opens + edits natively | ✅ | Thumbnails, Present mode, full design tools |
| 5 | PDF viewer + highlight/annotate | 🟡 | PDF.js viewer present; annotation layer ❓ |
| 6 | Image + video viewer | ✅ | Image / media renderers |
| 7 | Agent Terminal (core) — current file in context, actions | ✅ | Shell + agent; doc-gen + components via skills |
| 8 | File panel — tree, icons, recent, right-click, search | ✅ | |
| 9 | Command Bar — file open + basic search | 🟡 | ⌘K palette + search index |
| 10 | Workspace Snapshots (save/restore tabs) | ⬜ | Not yet built |
| 11 | Trash + undo for agent actions (shadow-git checkpoints) | ✅ | Trash + checkpoint handlers |

---

## 3. Engineering milestones shipped

### Native office engine (the foundation)
- ✅ **Headless LibreOffice on macOS** — ported the Cairo headless backend; LOKit
  initializes and renders with no Aqua crash.
- ✅ **`wos-lok-host` C++ sidecar** + framed stdio protocol (tiles / callbacks / commands).
- ✅ **In-app editing** — keyboard/mouse input, live caret, region repaint, ⌘S save back
  to the original file; crisp HiDPI tiles.
- ✅ **Bundled engine** — ships inside the app; no Docker, no env, no SSD. OnlyOffice
  + Docker deleted.
- ✅ **Multi-doc** — resident-doc cache + LRU, crash-recovery watchdog.
- ✅ **Model-API macro bridge** — Basic macros seeded post-init, run via `runMacro`,
  with `WosActiveDoc()` resolving the right doc across tabs. This is the workhorse for
  every operation the `.uno:` dispatcher can't do headlessly.

### Office suite polish
- ✅ **Document-aware ribbon + native menus** (Edit/Format/Insert/View per type)
- ✅ **Excel:** formula bar, sheet management (add/rename/delete/reorder), cell borders, geometry/drag-resize
- ✅ **Word:** table editing (insert/delete rows & columns at the cursor)
- ✅ **PowerPoint:** slide thumbnail rail, drag-reorder, full-screen Present mode

### Interactive design canvas (PowerPoint) — *the editor became real*
- ✅ **Shapes:** rectangle, rounded-rect, ellipse, line, arrow, text box, image
- ✅ **Fills:** solid, **gradient**, **hatch pattern**; **outline** color; **stroke** width + dash
- ✅ **Effects:** shadow; text styling; **align to slide**; **z-order**; delete
- ✅ **Slide background** (current / all slides)
- ✅ **Visible selection + resize handles** — render the engine's `GRAPHIC_SELECTION`
  callback so click-select, drag-move, drag-resize work (this was the fix that made the
  whole design surface usable)
- ✅ **Design-tab palette** (swatches + pickers) and native Format/Insert menus

### Component system (Framer-style assets) — *post-PRD, major*
- ✅ **Library** (stored in userData, reusable across decks) with **live SVG preview** + thumbnails
- ✅ **Types:** `shape`, `card` (bg+title), `media` (bg+image+caption), `captured`, `block` (Word text)
- ✅ **Composites** are real `GroupShape`s; per-instance overrides edit named children
- ✅ **Create from selection** — serialize arbitrary shapes (groups flattened) → rebuild
- ✅ **Master → instance propagation** with per-instance override preservation (overrides
  stored in each shape's `Description`, so they persist with the file)
- ✅ **Agent text-to-component** — `office-component` skill + `wos-component` CLI let the
  agent author components (incl. multi-shape, e.g. timelines) from natural language
- ✅ **Cross-app** — components insert into **Excel sheets** and **Word pages**, not just
  slides; **Word content blocks** (heading/callout/quote/signature) flow as text

### IWE / agent
- ✅ **Workspace-aware agent** on the Claude subscription (never the paid API)
- ✅ **Doc generation** — `office-docgen` skill + `wos-gen` (Python) creates real docx/xlsx/pptx
- ✅ **Custom agents** (`~/.claude/agents`), native Agent menu, Settings panel
- ✅ **Safety** — shadow-git checkpoint per agent run; trash for every destructive op

---

## 4. Per-app feature status (supersedes `office-feature-inventory.md`)

The [feature inventory](./office-feature-inventory.md) (2026-06-22) is now **outdated** —
most PowerPoint "🟡 missing" items (insert image/shape, slide reorder, background, etc.)
are **done**. Quick current read:

- **PowerPoint** — strongest: full shape/design tooling + the component system. Still
  missing: transitions, animations, charts/SmartArt, themes, speaker notes, presenter view.
- **Excel** — solid editing + formula bar + sheet management + shapes/components +
  **persistent native charts** (column/bar/line/pie/area, bound to a cell range). Still
  missing (engine-backed, needs UI): pivot tables, conditional formatting, data
  validation, Find & Replace, freeze panes.
- **Word** — editing + table ops + shapes (single) + **content-block components**. Still
  missing: Layout tab (margins/orientation/headers/footers/page numbers), images-in-flow,
  references (TOC/citations), spelling & grammar.

---

## 5. Roadmap

### Near-term (engine-backed, high value)
- 🔭 **Excel range templates** — reusable formatted cell ranges / KPI cards (the Excel
  counterpart to Word content blocks; completes "components everywhere")
- 🔭 **Component variants** (hover/active states) + enum/boolean property controls
- 🔭 **Charts** (cross-app) and **PivotTables** (Excel)
- 🔭 **Word Layout tab** — margins, orientation, headers/footers, page numbers
- 🔭 **Cross-app:** Find & Replace everywhere, spelling & grammar, conditional formatting

### Product gaps to hit the PRD benchmark
- 🔭 **Workspace Snapshots** (MVP #10) — save/restore open tabs + layout
- 🔭 **PDF annotation layer** (MVP #5)
- 🔭 **Communication (PRD §6.6):** Email (v0.3) → Calendar (v0.4) → Teams/Slack (v0.5).
  These are the true gating items for "3 days without an external app."

### Open / deferred
- ✅ **Charts (Excel)** — DONE. `.uno:InsertObjectChart` didn't persist headlessly, but the
  model-API macro path does: `WosInsertChart` builds a native chart via `Sheet.Charts.
  addNewByName(range)`, round-tripping as real chart XML (`xl/charts/chart1.xml` + a `<c:ser>`
  bound to the cell range) that survives save + reopen. All five types work (column/bar/line/
  pie/area). Proven by the real-engine e2e `e2e/office/E-charts.mjs` (`npm run e2e:charts`,
  37/37 unzip-verified). Impress charts still deferred.
- Word floating **group** shapes don't round-trip in Writer → use content blocks instead
- Master→instance propagation is currently PowerPoint-only (Impress draw pages)

---

## 6. Architecture decisions that changed vs. the PRD

| PRD said | Now |
|----------|-----|
| OnlyOffice DocumentServer + Docker sidecar (§4, §11 open decision) | **Bundled headless LibreOffice + LOKit**, rendered in our own canvas. No Docker. |
| Editing via iframed web editor | Native tiles painted to a `<canvas>`; our own UI shell drives the engine |
| "Production engine decision required before v1" (§11) | **Resolved** — LOKit (NEXT-PHASE Goal 3, Path B) |

Everything else in PRD §9 (agent = spawned `claude` CLI, shadow-git agent safety,
workspace-root ownership, path-traversal guard) holds and is implemented.

---

## How to maintain this file
Update the scorecard (§2) and milestones (§3) when a feature merges. Keep the
"Last updated" date current. When a roadmap item ships, move it from §5 to §3 with ✅.
This file is the canonical status; the phase docs (`PHASE-*.md`, `NEXT-PHASE.md`) are
historical point-in-time plans.
