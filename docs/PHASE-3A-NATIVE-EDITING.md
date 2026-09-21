# Phase 3a — Native Editing via LibreOfficeKit (LOKit)

**Status:** Scoped 2026-06-20. Not started. Gated on the M0 spike.

## The goal

Edit `.docx` / `.xlsx` / `.pptx` **in place, full fidelity, no Docker**, using
LibreOffice's own layout engine — and then delete OnlyOffice + Docker entirely
(Phase 5). This replaces the broken OnlyOffice "Download failed" edit path with
real, sovereign, bundled editing.

It is the genuinely hard part of the native-office effort. This doc scopes it
honestly: architecture, milestones, effort, and the risks that can sink it.

## Why LOKit (and not the alternatives)

| Route | Fidelity | Effort | Verdict |
|---|---|---|---|
| **3a. LibreOfficeKit tiles** | Full — it *is* LibreOffice | High (5–8 wks) | ✅ Sovereign, bundled, no Docker. The real answer. |
| 3b. HTML round-trip (docx→html→edit→docx) | Lossy on tables/styles/comments | Medium | Fallback if 3a's spike fails. |
| 3c. OnlyOffice in Docker | Full | Low | ✗ The wart we're removing. Currently broken anyway. |

LOKit is the C++ API Collabora Online and the LibreOffice mobile apps use. We
already bundle the engine (Phase 4); LOKit is a different *surface* on the same
binary, so 3a adds no new runtime dependency.

## De-risking already done

`libmergedlo.dylib` in our bundled `LibreOffice.app` exports the LOKit entry
points — verified with `nm`:

```
T _libreofficekit_hook
T _libreofficekit_hook_2
T _lok_preinit
T _lok_preinit_2
```

So the bundled macOS engine *can* be driven as a kit. That removes the top risk
(mac desktop builds sometimes ship without LOKit). What's still unproven is that
it **initializes and paints a tile** under our bundle's path/entitlement setup —
that's M0.

## M0 spike result (2026-06-20) — NO-GO on the stock macOS build

The spike (`/tmp/wos-lok-spike/lokprobe.cpp`) got **further than expected, then
hit a hard wall** that is specific to the stock TDF macOS desktop build:

What worked (real progress, reusable):
1. **Symbols present** — `libreofficekit_hook` / `lok_preinit` in
   `libmergedlo.dylib` (already known).
2. **The mac Frameworks/Resources split is solvable** — passing
   `install_path = …/Contents/Frameworks/` (for `dlopen`) **plus**
   `URE_BOOTSTRAP=vnd.sun.star.pathname:…/Contents/Resources/fundamentalrc`
   (for the URE bootstrap) let `lok_init_2` find everything and proceed into
   engine startup. No "installation path / fundamentalrc not found" errors.
3. Init reached `InitVCL` — i.e. bootstrap, URE, and config all loaded.

Where it died:
```
InitVCL → CreateSalInstance → AquaSalInstance() → NSComboBox → NSWindow
*** 'NSWindow should only be instantiated on the main thread!'
```
**Root cause:** LOKit runs the office main loop on a *background* thread
(`lo_startmain` via `osl_thread_start`) so the API can return. The **only VCL
plugin in the stock mac build is Aqua** (`libvclplug_osxlo.dylib`) — there is
**no headless `svp` plugin** (`find … -iname '*svp*'` → nothing;
`SAL_USE_VCLPLUGIN=svp` is ignored because the plugin doesn't exist). Aqua
instantiates AppKit objects (`NSComboBox`/`NSWindow`) during init, and AppKit
forbids that off the main thread. `soffice --headless` (Phase 1) avoids this
only because the real binary runs office-main on the *main* thread.

**Conclusion:** the stock LibreOffice macOS desktop build exports LOKit but is
**not LOKit-capable at runtime**. This is a known TDF limitation, not a bug in
our setup. Fixing it requires a **headless-enabled (`svp`) LibreOffice build for
macOS** — either built from source with `--enable-headless`, or sourced from
Collabora (whose mac/iOS apps ship a headless-capable LOKit backend).

**Platform note:** stock TDF **Linux/Windows** builds *do* include the `svp`
plugin, so 3a is expected to work there with the bundled engine as-is. The wall
is macOS-specific — and macOS is our primary platform.

## M0.5 — the headless-build prerequisite is NOT achievable on macOS (2026-06-21)

Followed the plan: build a headless LibreOffice (tag `libreoffice-26.2.4.2`, to
match our bundle) on an APFS disk image on an external SSD. It died at
**configure**, and the reason is structural, not a flag tweak:

```
configure: error: darwin25.3.0 operating system is not suitable
                  to build LibreOffice with --disable-gui.
```

`configure.ac` (~line 5944): `--disable-gui` is rejected unless `using_x11=yes`.
`vcl/Library_vcl.mk` (line 677): the entire headless backend
(`vcl/headless/svpinst`, `svpgdi`, Cairo rendering — the `SvpSalInstance`) is
gated behind `DISABLE_GUI=TRUE`. macOS has no X11, so **the headless VCL backend
is never compiled on macOS**. The mac build is **Aqua-only by design**.

**Consequence:** there is no stock-source path to a headless LibreOffice on
macOS. The "build the engine headless and bundle it" prerequisite for native
LOKit editing — the foundation of this whole phase on mac — **cannot be met with
upstream LibreOffice.**

The only ways native LOKit editing could happen on macOS:
1. **Fork/patch LibreOffice** to either port the Cairo headless backend to mac
   (bypass the X11 gate — real, unmaintained porting work) or make the Aqua
   backend drive LOKit on the main thread (Collabora's approach). Both are
   **fork-level, multi-week, deep-C++ efforts** with uncertain payoff.
2. **Collabora Office/CODE for mac** — Collabora ships a working mac/iOS LOKit
   (their fork). Not redistributable as drop-in libraries without a commercial
   arrangement.

**Platform reality:** stock LOKit works on **Linux/Windows** (svp builds there),
so real-3a remains viable on those platforms. It is specifically **macOS — our
primary platform — where native LOKit is effectively off the table** without a
fork or a Collabora deal.

**Recommendation flip:** for near-term editing on mac, **3b (HTML round-trip)**
is now the pragmatic path — it uses `soffice --convert-to`, which already works
headless on the mac build (main thread), no custom engine needed. Treat native
LOKit as a future/cross-platform track, not the mac near-term answer.

### What this changes
- 3a on macOS now carries a **prerequisite**: produce/obtain a headless mac
  LibreOffice. That's a heavy, mostly one-time cost (multi-hour source build +
  toolchain, or a Collabora dependency), *before* M1–M5 even begin.
- The lighter **3b (HTML round-trip)** path uses only `soffice --convert-to`,
  which already works headless on the mac build (main thread) — so it can ship
  editing on mac far sooner, at the cost of fidelity on complex documents.

## ✅ M0.6 — GO. Headless LOKit renders documents on macOS (2026-06-21)

The fork worked. A headless (`--disable-gui`) LibreOffice **builds, initializes,
loads, and renders documents pixel-perfect on macOS** via LOKit — no Aqua, no
Docker, no commercial dependency. Proof render: `scripts/lok/headless-render-proof.png`
(the test docx, full fidelity: styled headings, rule, body, bullets).

This overturns M0–M0.5: the "headless is impossible on macOS" wall was a soft
configure gate plus a handful of mac+headless combinations upstream never tested.

### The recipe (reproducible)
Build: `scripts/lok/build-headless-macos.sh` (tag `libreoffice-26.2.4.2`).
Toolchain (brew): GNU make ≥4.2, gperf ≥3.1 (mac ships older), autoconf/automake/nasm.
Config: `--disable-gui --enable-headless --enable-bogus-pkg-config` (+ lean flags).
Source patch: `scripts/lok/headless-macos.patch` — **9 insertions / 9 deletions, 6 files**:
- `configure.ac` — allow `--disable-gui` on Darwin (X11 error→warning) + don't
  force-enable OpenGL/epoxy when `DISABLE_GUI` (gate the Darwin OpenGL branch).
- `vcl/Module_vcl.mk`, `vcl/Library_vcl.mk`, `Repository.mk` — make macOS under
  `DISABLE_GUI` select the **headless Cairo backend** and skip the Aqua plugin
  (`Library_vclplug_osx`), via the `$(OS)$(DISABLE_GUI)` idiom.
- `vcl/headless/svpinst.cxx` — gate the AppKit spell-checker startup workaround on
  `HAVE_FEATURE_UI` (irrelevant + unsafe in headless).
- `desktop/source/lib/init.cxx` — **the key fix.** `doc_paintTile` wrapped its
  whole body in `#if defined(UNX) && !defined(MACOSX) || defined(_WIN32)`, so on
  mac it was a no-op (engine loaded docs but painted nothing). Including MACOSX
  routes mac through the generic svp `SetOutputSizePixelScaleOffsetAndLOKBuffer`
  path → tiles render into the caller's buffer.

Validate: `scripts/lok/lokprobe.cpp` — init → load → `paintTile` → PPM. Install
path = `…/Contents/Frameworks/` (hook is in `libsofficeapp.dylib`; no mergelibs),
with `URE_BOOTSTRAP=vnd.sun.star.pathname:…/Contents/Resources/fundamentalrc`.

### What this unblocks
Native LOKit editing on macOS is real. M1–M5 (sidecar, tile client, input/UNO,
save) now proceed on a **proven engine** — and the same engine gives a live-tile
*view* path superior to the current `soffice --convert-to-pdf` snapshot.

### Caveats / TODO before production
- Built unsigned/lean for validation; a shippable engine needs hardening
  (signing, trimming, `--enable-mergelibs` for a single `libmergedlo`).
- Upstreamability: the `init.cxx` paintTile guard fix is arguably a real upstream
  bug for headless-mac; worth proposing to TDF.
- Cross-platform: Linux/Windows already work with stock headless; this recipe is
  macOS-specific.

## Architecture — out-of-process LOKit host (sidecar)

```
 renderer (canvas tile client)
   │  contextBridge IPC (existing)
 main (Electron)  ── spawns & proxies ──▶  wos-lok-host  (C++ sidecar)
                                              │  dlopen libmergedlo via
                                              │  LibreOfficeKitInit.h
                                              ▼
                                        bundled LibreOffice engine
```

**Why a separate process, not the Electron main process:**
1. **Single-instance / single-threaded.** LOKit initializes one office instance
   per process, does its own threading and signal handling. Hosting it inside
   Electron's main process risks deadlocks and event-loop stalls.
2. **ABI isolation.** No coupling to Electron/Node's ABI — the sidecar is plain
   C++, rebuilt only when LibreOffice changes, not on every Electron bump.
3. **Crash containment.** A document that crashes the engine kills the sidecar,
   not the workspace; main respawns it. This is exactly how Collabora isolates
   its per-document "kit" processes.
4. **Reuse of the bundle.** The sidecar `lok_init`s against
   `…/Resources/libreoffice/LibreOffice.app/Contents/Frameworks` — the same
   files Phase 4 ships. Nothing new to download.

**Protocol (sidecar ↔ main):** length-prefixed frames over a pipe/socket.
Control messages JSON (`open`, `tileRequest`, `key`, `mouse`, `uno`, `save`);
tile payloads raw BGRA blobs (no base64 — too slow for streaming).

## Client (renderer) — a minimal tiled editor

This is the bulk of the new UI work. Concepts:
- **Tiles & twips.** The document is a grid measured in twips (1/1440"). The
  client requests `paintTile(docX, docY, docW, docH, pixelW, pixelH)` and blits
  the returned BGRA into a `<canvas>`. Maintain a tile cache keyed by
  position+zoom; evict on memory pressure.
- **Callbacks → UI.** Handle the LOK callback stream:
  `INVALIDATE_TILES` (repaint a dirty rect), `CURSOR_VISIBLE` / `CELL_CURSOR` /
  `TEXT_SELECTION` (draw overlays the engine doesn't paint into tiles),
  `STATE_CHANGED` (toolbar button states — bold on/off), `DOCUMENT_SIZE_CHANGED`
  (scrollbars).
- **Input.** Canvas mouse → twips → `postMouseEvent`; keyboard → `postKeyEvent`
  (with IME/composition handling); toolbar buttons → `postUnoCommand(".uno:Bold"
  …)`. This reuses the existing Markdown formatting-toolbar pattern, but driving
  UNO commands instead of Monaco.
- **Save.** `.uno:Save` / `saveAs` writes back to the original docx/xlsx/pptx.

Reality check: Collabora's browser client is tens of thousands of lines for
exactly this. We need a fraction of it — single user, single document, no
real-time collaboration, no server, no permission model — but it is still the
largest single UI component in the app.

## Milestones (each is a go/no-go gate)

- **M0 — Spike (~1–2 days). GO/NO-GO.** Standalone C program: `lok_init` the
  bundled mac engine, `documentLoad("test-document.docx")`, `paintTile` page 1
  to a PNG on disk. Proves init + render under our bundle's paths/entitlements.
  *If this fails and can't be made to work in a few days → fall back to 3b.*
- **M1 — Host process (~3–5 days).** C++ `wos-lok-host` + IPC protocol: open
  doc, report size, stream tiles on request, forward the callback stream. No
  editing. Wire main↔sidecar spawn/proxy.
- **M2 — Read-only live canvas (~3–5 days).** Renderer tile client: render
  docx/xlsx/pptx to canvas, scroll, zoom, tile cache + invalidation. Visually
  matches today's PDF view but is the live engine (replaces the converted-PDF
  view for office files).
- **M3 — Writer editing (~1 wk).** Cursor + selection overlays, keyboard input,
  a real UNO toolbar (bold/italic/lists/headings), save back to `.docx`. This is
  the milestone where we can honestly say "editing works." Keep OnlyOffice as
  fallback until here.
- **M4 — Calc + Impress (~1 wk).** Same pipeline; format-specific input (cell
  selection/entry for Calc, slide panel for Impress).
- **M5 — Harden + retire Docker (~1 wk).** IME/unicode, find/replace, undo/redo,
  sidecar crash-recovery, tile-cache perf. Then execute **Phase 5**: delete the
  OnlyOffice handlers, file bridge, SSRF/nginx hacks, and the Docker dependency.

## Effort & honesty

- **Baseline (M0–M3, Writer editing): ~3–4 weeks.**
- **Solid all-three-formats editor (through M5): ~5–8 weeks.**
- **Open-ended long tail** (track-changes, comments, complex tables, full
  toolbar parity, accessibility) is not in this estimate — baseline editing is.
- New build complexity: a **C++ sidecar build step** per platform enters
  packaging/CI (node-gyp or standalone clang → a binary added via
  `extraResources`). This is real and ongoing.

## Risks

1. **macOS init/entitlements.** `lok_init` may need URE bootstrap env and the
   mac sandbox showed a benign `Task policy set failed` notice during convert —
   M0 confirms init works (or not) under our bundle.
2. **Build/CI.** Producing and shipping a per-platform native sidecar is new
   toolchain surface; couples our build to a LibreOffice SDK/headers.
3. **Performance.** Tile streaming over IPC for large docs needs a cache +
   dirty-region invalidation to feel smooth; naive full-repaints will lag.
4. **Save fidelity.** LOKit `saveAs` is LibreOffice's own writer — high fidelity,
   not byte-identical to Word; acceptable, worth stating to users.
5. **Cross-platform.** This scope proves macOS; Windows/Linux LOKit init differ
   and are a follow-on.

## Recommendation

Run **M0 next** — it's cheap, and decisive. The symbol check already passed, so
M0 is now "does it initialize + paint," not "does the API exist." If M0 renders a
tile, commit to M1–M3 for Writer editing and reassess before M4. Keep OnlyOffice
wired as the edit fallback until M3 lands so nothing regresses; delete it in M5.
If M0 can't be made to work in a few days, pivot to **3b (HTML round-trip)** as a
lossy-but-shippable interim and revisit LOKit later.
