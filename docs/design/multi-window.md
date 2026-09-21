# Multi-window / multi-monitor — architecture + design

**The ask:** let a user split the workspace across **separate OS windows**, not just panes in one app — so on multiple monitors they can put Mail on one screen, the Cockpit on another, a deck full-screen on a third.

## Why it fits
Electron is already multi-window-capable (each window is a `BrowserWindow`). The whole IA (rail · Stage · surfaces) makes this natural: **a surface is a self-contained thing that can live in a pane, a Stage tab, OR its own window.** Multi-monitor power users are exactly the target (managers with 2–3 screens).

## The model — "tear off a surface into its own window"
- **Pop-out affordance:** every surface tab and every peek pane gets a small **⤢ "Open in new window"** control (next to the tab's ×, and in the peek header — the mockups show it as "Open in Mail ↗").
- **A popped-out window** is a **focused single-surface window**: just that surface + a slim titlebar (breadcrumb + ⌘K), no rail needed (or a collapsed rail). E.g. a Mail window, a Cockpit window, a `report.docx` window.
- **The main window keeps the full shell** (rail + Stage + Home). Popping a surface out **removes its tab** from the main Stage and moves it to its own window; closing the window returns it (or just closes the surface).
- **Spaces ↔ windows:** a whole **Space** can open as a window too (Space "W" = Work on monitor 1, Space "P" = Personal on monitor 2). This is the cleanest multi-monitor story: one Space per screen.

## Shared state (the important part)
All windows share **one workspace, one agent fleet, one liveness store** — because state lives in the **main process**, not per-window:
- Metrics/collections/ranges, the review/fleet store, mail, connectors, the vault, checkpoints — all already main-process-owned and reached via IPC. A second window is just another renderer subscribing to the same main-process state.
- **Live everywhere:** a metric changed in the report window updates the deck in another window instantly (the liveness moat already works cross-surface; cross-window is the same IPC, no new engine work).
- **One agent fleet:** an agent launched from any window appears in every window's Cockpit/Agents view. Approvals sync. (The `reviewStore` is a singleton fed by main-process events — a second window's Cockpit mirrors it.)

## What it takes to build (later — this is a design/arch note, not now)
- A `windowManager` in main: `openSurfaceWindow(surfaceId, {space, monitor?})`, track windows, restore on relaunch.
- Renderer: a `?window=<surfaceId>` (or route) mode that renders a single surface without the full shell; the pop-out control calls an IPC `window:popout`.
- State: **no change** — windows are renderers over the existing main-process stores; the stores already broadcast (the fleet/liveness IPC does this today). This is the reason it's tractable: we don't duplicate state, we add windows.
- Window persistence: remember which surfaces were in which windows/monitors (extend the existing snapshot store).

## Effort / risk
- **M**, and low-risk architecturally *because state is already centralized in main*. The work is windowing + a single-surface render mode + persistence — not a state rewrite.
- Design cost: each surface must render standalone (it already does — surfaces are components). The pop-out control + a slim standalone chrome is the only new UI.

## Design decisions to confirm (in the mockups)
1. Pop-out control placement (tab ⤢ + peek header) — shown in the page set.
2. Standalone window chrome — slim titlebar with breadcrumb + ⌘K, collapsed/no rail.
3. Space-as-window (one Space per monitor) — the recommended multi-monitor default.
