# Phase: Native Office Suite — No Docker

**Status:** Active phase (planning complete 2026-06-20)

## The Goal

> Open, view, edit, and export `.docx` / `.xlsx` / `.pptx` natively inside
> Workspace OS — with **no Docker**, no 4 GB container, no 60-second cold boot.
> The office engine is bundled, open source, local, and feels like one app.

Today: office docs go through an **OnlyOffice Document Server in Docker** —
heavy (4 GB image, ~60 s first boot, 147 % CPU), requires Docker Desktop, and is
a separate engine bolted on. That's the wart this phase removes.

## Engine Decision — LibreOffice

The realistic open-source paths were evaluated:

| Option | Verdict |
|---|---|
| **OnlyOffice without Docker** | ✗ No clean embeddable distribution — it's a full server stack (Node + nginx + Postgres + Redis + conversion services). Bundling cross-platform is fragile and huge. |
| **Pure-JS office libraries** | ✗ Good for *viewing* (mammoth, docx-preview) or *data* (exceljs), but no full-fidelity JS editor for complex Office formats. |
| **LibreOffice (LGPL/MPL)** | ✅ The actual office engine. Two integration surfaces: `soffice --headless` for conversion, and **LibreOfficeKit (LOKit)** — the C++ API Collabora uses — for true in-process editing. Bundleable, sovereign, "ours." |

**Decision: LibreOffice is the engine.** It's the only realistic way to get
native, Docker-free, open-source office support we can ship and make our own.

## The honest tradeoff: viewing/export is easy, editing is the hard part

- **Conversion + viewing + export** via `soffice --headless --convert-to` is
  simple and robust. This removes Docker for most of what a manager does.
- **Native in-place editing** with full fidelity is the genuinely hard part —
  LOKit tile rendering + input handling (C++ FFI, immature npm bindings). This
  is the multi-week lift.

So the phase is sequenced to deliver the Docker-free win early and tackle
editing fidelity as a deliberate, separate effort.

## Phased Plan

### Phase 1 — LibreOffice as a conversion engine (removes Docker for export)
- Resolve a LibreOffice binary: detect a local `soffice`, else use a bundled
  headless build (Phase 4 bundles it; Phase 1 can require/auto-prompt install).
- Replace the OnlyOffice Docker export-to-PDF with `soffice --headless
  --convert-to pdf --outdir <tmp> <src>`. No Docker, no bridge, no SSRF/nginx
  workarounds — just a subprocess.
- Wire it behind the existing `export-pdf` action so the surface is unchanged.
- **Win:** export works with zero Docker. Validates the LibreOffice integration.

### Phase 2 — Docker-free viewing (default open path)
- On opening a `.docx/.xlsx/.pptx`, convert to PDF (or HTML) via `soffice` and
  render it with our existing **PDF.js** viewer (or HTML renderer).
- Cache conversions by source mtime so reopening is instant.
- Route office files to this viewer by default; keep OnlyOffice behind an
  "Advanced edit" toggle for now.
- **Win:** opening office docs no longer needs Docker at all — read-only, fast.

### Phase 3 — Native editing (the hard part; pick a route)
Three routes, decreasing fidelity / decreasing effort:
- **3a. LibreOfficeKit tiles** — load doc in LOKit, render tiles to a canvas,
  map keyboard/mouse to LOKit. True native editing. Largest effort; needs C++
  FFI / a maintained binding.
- **3b. HTML round-trip** — `soffice` converts docx→html, edit in a rich web
  editor (ProseMirror/TipTap), convert html→docx on save. Lighter; lossy on
  complex documents (tables, styles, comments).
- **3c. Keep OnlyOffice (Docker) as optional advanced-edit** while default
  view/export is Docker-free — pragmatic bridge until 3a lands.
- **Decision deferred to start of Phase 3** — depends on fidelity bar + LOKit
  binding maturity at that time. Recommendation: ship 3c as the bridge, invest
  in 3a as the real answer.

### Phase 4 — Bundle the engine ✅ (done 2026-06-20)
- Ship LibreOffice inside the app so users install nothing.
- `resolveSoffice()` now checks bundled paths under `process.resourcesPath`
  (`libreoffice/LibreOffice.app/Contents/MacOS/soffice` on macOS, `program/`
  on Linux/Windows) **before** any system install; an explicit `SOFFICE_BIN`
  still wins. Ordering covered by `libreoffice.test.ts`.
- electron-builder `mac.extraResources` copies `/Applications/LibreOffice.app`
  into `Resources/libreoffice/`, filtering out `help/` and `gallery/`.
- **Verified:** packaged `.app` contains the bundled `soffice` (796 MB on
  disk), and that binary converts `test-document.docx → 29 KB PDF` standalone
  with zero system dependency. DMG is **431 MB** compressed (was 168 MB).
- **Size note (honest tradeoff):** LibreOffice is 795 MB; this is the cost of a
  self-contained, no-install, sovereign engine. Already trimmed help+gallery;
  further trimming (languages, unused modules under `program/`) can shave more
  in a later pass but risks breaking conversion — left conservative for now.
- **Pending for real distribution:** the build hardcodes the dev machine's
  `/Applications/LibreOffice.app` as the source; a CI build must vendor a
  pinned LibreOffice (download per-platform) instead. Windows/Linux
  `extraResources` not yet wired (macOS only this pass).

### Phase 5 — Remove OnlyOffice + Docker entirely ✅ (done 2026-06-21)
- Deleted: `handlers/onlyoffice.ts`, `src/main/onlyoffice/` (sidecar, file bridge,
  config), `OnlyOfficeRenderer`, the `onlyoffice` IPC channels / preload / types,
  and the export fallback. No Docker dependency remains.
- One sovereign, bundled engine: the headless LibreOffice (Phase 3a) serves both
  LOKit editing and `soffice` PDF conversion, shipped inside the app.
  `OfficeRenderer` now renders the native editor when the engine is present, with
  a read-only PDF view as the only fallback. Native editing verified end-to-end
  in the packaged app with no external dependency.

## Suggested first step
**Phase 1** — wire `soffice` conversion behind the export action. Smallest,
fully testable, removes Docker from a real path, and de-risks the whole engine
choice before committing to the heavier viewing/editing work.

## Decisions (locked 2026-06-20)
1. **Engine delivery:** require a **local LibreOffice install** for Phases 1–3
   (detect/prompt); **bundle** it in Phase 4. Validates the approach before the
   heavy packaging work.
2. **Near-term editing:** **keep OnlyOffice (Docker) as the edit fallback** —
   default view/export goes Docker-free via LibreOffice; full editing stays on
   OnlyOffice until native LOKit editing (3a) lands. Nothing regresses; Docker is
   only touched when the user actually edits.
3. **Spreadsheet/presentation parity** — same convert-to-view path; native
   `.xlsx`/`.pptx` editing via LOKit is the same effort class as docx.
