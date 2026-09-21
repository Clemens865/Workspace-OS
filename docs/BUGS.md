# Workspace OS — Bug Log

Bugs filed from inside the running app by the in-app reporter (⌘⇧B).

**This file is the hand-off.** Reports are captured while USING Workspace OS and
are never worked on there — they land here so the next development session can
pick them up. Structured fields below are Claude's interpretation of the report;
the *Reported as* block at the end of each entry is the user's own words and is
the authority when the two disagree.

Entries are append-only. Do not renumber IDs — they are referenced elsewhere.

---

## WOS-001 · New .docx opens with no caret and swallows all typing/paste — doc surface never gets keyboard focus after creation

- **Status:** FIXED — fixed in ec24fc4 — docWrap is focused on load and Writer seeds a caret; regression test e2e/office/AE-new-docx-caret.mjs
- **Severity:** high
- **Surface:** Files → New → Word document (LOK office canvas)
- **Reported:** 2026-08-01T22:13:22.663Z (seen 2×, last 2026-08-01T23:01:30.571Z)
- **Build:** 0.1.0 · `82c1733`
- **Environment:** Darwin 25.3.0 (arm64) · open: `Untitled.docx`

**What happens**

A Word document created from scratch opens and renders, but there is no visible text cursor and neither typed characters nor ⌘V reach the document. The keyboard path lives entirely on the `docWrap` div in LokRenderer (tabIndex=0, onKeyDown → useLokInput), and that element is only ever focused from onMouseDown or on dialog close — the open effect (LokRenderer.tsx:189-257) clears the caret and never calls docWrapRef.current?.focus(), and never seeds an initial cursor in the engine. A document opened programmatically right after creation (FilePanel.handleNew → onFileOpen) therefore starts with an unfocused surface, so keystrokes never become lok.key calls and ⌘V never becomes .uno:Paste. The caret overlay is gated on `caretVisible && caret`, which is set only by engine callbacks CB_INVALIDATE_VISIBLE_CURSOR / CB_CURSOR_VISIBLE — on a blank template doc with no click, neither fires, so no caret is drawn. Side note for triage: the report's captured filename is `Untitled.docx`, but the new-Word path names files `New Document.docx` (`Untitled` is only used for .md/.csv), so either the capture is synthesizing the name or the file arrived via a different route than FilePanel.handleNew.

**Expected**

A newly created Word document opens focused with a blinking caret at the start of the body, ready to accept typing and paste immediately — no click required.

**Steps to reproduce**

1. Open a workspace folder in Workspace OS
2. In the Files panel, create a new Word document (New ▸ Word document, or ⌘N with the default new-file format set to docx)
3. When the document opens in the canvas, type on the keyboard and press ⌘V

**Suspected code** — analysis only, unverified, do not trust without checking

- `src/renderer/src/components/Canvas/renderers/LokRenderer.tsx` — The open effect (lines 189-257) resets caret/selection and finishes loading without ever focusing docWrapRef or placing an initial cursor; docWrap (line 828-837, tabIndex=0 + onKeyDown) is focused only in onMouseDown and dialog-close handlers, so a programmatically opened doc is unfocused and deaf to the keyboard.
- `src/renderer/src/components/Canvas/renderers/useLokInput.ts` — onKeyDown (lines 162-212) is the sole route for both typed characters (lok.key) and paste (⌘V → runUno('.uno:Paste')); it can only fire if docWrap has DOM focus. Also worth checking independently: .uno:Paste reads LibreOffice's own clipboard, not the Electron/system clipboard, which could break paste even once focus is fixed.
- `src/renderer/src/components/Canvas/renderers/useLokCallbacks.ts` — caretVisible/caret are set only from CB_INVALIDATE_VISIBLE_CURSOR (line 104) and CB_CURSOR_VISIBLE (line 131). Nothing requests an initial cursor after open, so a freshly opened blank doc renders no caret until the user clicks into it.
- `src/renderer/src/components/FilePanel/FilePanel.tsx` — handleNew (lines 57-73) calls lok.newDoc then onFileOpen(res.path) and hands off; nothing moves focus from the file panel to the canvas, so the new document opens behind the panel's focus.
- `src/main/handlers/lok.ts` — lok:new (lines 94-126) copies the blank template and already calls lokOpen on it; the renderer then opens the same path again. If the engine treats the second open of the already-resident doc as a no-op, the post-open callbacks (initial cursor/view state) the caret depends on may never be re-emitted for this document.

**Reported as** (the user's own words — authoritative)

> I have just tried to open a new word doc, from scratch, and cannot write inside it. There is no cursor visible, I can also not paste anything in it.

---

## WOS-002 · electron-builder ships an invalidly-signed bundle, so macOS SIGKILLs the app at dlopen

- **Status:** FIXED — fixed in 32e5328 — afterPack re-signs and verifies, so the dmg/zip carry a valid seal
- **Severity:** critical
- **Surface:** packaging / dist:mac
- **Reported:** 2026-08-01T23:03:53.121Z
- **Build:** 0.1.0 · `e7ee6e2`
- **Environment:** Darwin 25.3.0 (arm64)

**What happens**

`npm run dist:mac` produces a bundle that fails `codesign -v` with "code has no resources but signature indicates they must be present". Combined with hardenedRuntime:true and identity:null in package.json > build.mac, macOS 26 (codeSigningMonitor active) kills the process the moment dyld maps a native addon page it cannot validate. The crash is EXC_BAD_ACCESS / SIGKILL (Code Signature Invalid), termination CODESIGNING / Invalid Page, with the faulting stack at dyld dlopen -> node::binding::DLib::Open(). It survives startup and dies later, when the first native module is lazily loaded, which makes it look like a random runtime crash rather than a packaging fault. Verified the SOURCE bundle in release/ is already invalid, so the copy to /Applications is not the cause. Workaround that works: codesign --force --deep --sign - "/Applications/Workspace OS.app".

**Expected**

A bundle straight out of dist:mac passes codesign -v and runs without being killed by the kernel.

**Steps to reproduce**

1. npm run dist:mac
2. codesign -v "release/mac-arm64/Workspace OS.app"  → invalid
3. Install and run it
4. Use a feature that lazily loads better-sqlite3 or node-pty
5. Process is SIGKILLed

**Suspected code** — analysis only, unverified, do not trust without checking

- `package.json` — build.mac sets identity:null with hardenedRuntime:true and notarize:false — the ad-hoc signing path electron-builder takes here leaves the seal incomplete

**Reported as** (the user's own words — authoritative)

> The app still keeps crashing: EXC_BAD_ACCESS (SIGKILL (Code Signature Invalid)) / Termination Reason: Namespace CODESIGNING, Code 2, Invalid Page

---

## WOS-003 · Playwright cannot launch the app, so every real-engine e2e is unrunnable

- **Status:** FIXED — fixed in 43eadcf — NOT a Playwright/Electron incompatibility; unsigned native addons were SIGKILLing the launch. Both rebuild scripts now sign.
- **Severity:** high
- **Surface:** e2e harness
- **Reported:** 2026-08-01T23:03:53.121Z
- **Build:** 0.1.0 · `e7ee6e2`
- **Environment:** Darwin 25.3.0 (arm64)

**What happens**

playwright 1.61 _electron.launch() against Electron 42: the window mounts, #root appears, then the process is killed. e2e/smoke.mjs and e2e/office/_harness.mjs fail identically, so the breakage is the harness rather than any one test. The office harness retries twice and reports the failure as launch flake, which hides it. This matters more than a normal bug because real-engine e2e is this project’s stated definition of done — the discipline that previously caught empty charts and a silently-dead macro.

**Expected**

e2e/smoke.mjs launches the app and drives the renderer.

**Steps to reproduce**

1. npm run build
2. node e2e/smoke.mjs

**Suspected code** — analysis only, unverified, do not trust without checking

- `package.json` — playwright 1.61 predates Electron 42; pin a compatible pair or move the harness off _electron

**Reported as** (the user's own words — authoritative)

> (found while trying to click-test the bug reporter — the e2e harness itself cannot launch the app)

---

## WOS-004 · Typing "=" in Calc offers no function-name suggestions and no click-to-pick cell ranges — formulas must be typed blind

- **Status:** PARTIAL — function autocomplete shipped (calcFunctions.ts, 19 tests). Click-to-pick cell ranges is NOT done: it needs a live engine cell-edit session instead of the one-shot .uno:EnterString commit, which is a deeper change. An Insert ▸ Function… menu entry was deliberately NOT added, because the .uno: name was not verified against the real engine and this project does not ship unverified dispatch names.
- **Severity:** medium
- **Surface:** office / Calc (.xlsx) — formula entry (FormulaBar + LOK grid)
- **Reported:** 2026-08-01T23:52:04.428Z
- **Build:** 0.1.0 · `32e5328`
- **Environment:** Darwin 25.3.0 (arm64)

**What happens**

Starting a formula with "=" produces no autocomplete or function picker: there is no list of SUM/MID/etc. anywhere in the app. Grep confirms no function catalog, no autocomplete component for Calc, and no Insert→Function / Function Wizard entry in the Calc menus (calcMenu.ts dispatches no .uno:FunctionDialog or .uno:AutoPilotFunctions). The formula bar is a plain <input> with no suggestion dropdown (FormulaBar.tsx:31-52). Building a formula by clicking/dragging cells is also unsupported from the formula bar: it commits via a one-shot `.uno:EnterString` (LokRenderer.tsx:329-336) rather than opening a live cell-edit session in the engine, so the engine is never in reference-selection mode while the user types; worse, the input's onBlur resets the draft to the engine value (FormulaBar.tsx:38), so clicking into the grid mid-formula discards what was typed. Formulas typed fully by hand still work, which is the workaround.

**Expected**

Same workflow as regular Excel: typing "=" opens a filtered list of available functions (SUM, MID, VLOOKUP, …) navigable with arrows and accepted with Tab/Enter, with an argument hint once a function is chosen; and while a formula is open, clicking or dragging cells in the grid inserts that reference/range (A1, A1:B10) into the formula at the caret instead of cancelling the edit.

**Steps to reproduce**

1. Open any .xlsx in the Calc canvas
2. Click a cell and type "=" (either directly in the grid or in the formula bar)
3. Type the start of a function name, e.g. "=SU" — observe no suggestion list appears
4. With the formula still open, click another cell to reference it — observe the reference is not inserted (from the formula bar the in-progress draft is discarded instead)

**Suspected code** — analysis only, unverified, do not trust without checking

- `src/renderer/src/components/Canvas/renderers/FormulaBar.tsx` — The whole formula-entry UI: a bare <input> with no suggestion dropdown, no function catalog, no caret-aware reference insertion. onBlur (line 38) resets the draft to the engine value, so any click into the grid mid-formula throws the typed formula away — this is where an autocomplete list and a 'reference mode' would have to live.
- `src/renderer/src/components/Canvas/renderers/LokRenderer.tsx` — commitCell (lines 329-336) is the only path from the formula bar to the engine and uses one-shot `.uno:EnterString`. Because no interactive cell-edit session is ever opened in LOK, the engine cannot be in reference-picking mode while the user composes a formula. Also the site that would own the shared formula-editing state (line 1066 renders FormulaBar).
- `src/renderer/src/components/Canvas/renderers/calcMenu.ts` — The Calc cell/row/column menus enumerate real .uno: commands but contain no function entry (no .uno:FunctionDialog / AutoPilot:Functions). LibreOffice's own Function Wizard is the cheapest route to 'show me every available function' and it is simply not wired up.
- `src/renderer/src/components/Canvas/renderers/useLokInput.ts` — GUESS — unverified. Keystrokes and mouse events are forwarded raw to the engine (onKeyDown ~line 195-207, onMouseDown line 302), so typing "=SUM(" directly in the grid probably does put LO core into cell-edit mode, and click-to-reference may partly work there already. Worth click-testing on the real engine before building anything: the fix may be 'surface what the engine already does' for the grid, plus new UI for the formula bar.

**Reported as** (the user's own words — authoritative)

> When I am on an Excel, I would like to add a formular with =
> It should then suggest or show formulars like SUM, MID and everything which is available in a regular exel. And the user should be able to mark the cells, which the formular should include. Same workflow as in a regular excel program

<details><summary>Main-process errors at the time</summary>

```
2026-08-01T22:51:30.544Z [error] [updater] Error: HttpError: 404 
2026-08-01T22:51:30.544Z [error] [updater] error — HttpError: 404 
2026-08-01T22:51:30.544Z [error] [updater] check failed — HttpError: 404 
2026-08-01T22:58:04.839Z [error] [updater] Error: HttpError: 404 
2026-08-01T22:58:04.840Z [error] [updater] error — HttpError: 404 
2026-08-01T22:58:04.840Z [error] [updater] check failed — HttpError: 404 
2026-08-01T23:04:07.673Z [error] [updater] Error: HttpError: 404 
2026-08-01T23:04:07.674Z [error] [updater] error — HttpError: 404 
2026-08-01T23:04:07.674Z [error] [updater] check failed — HttpError: 404 
2026-08-01T23:10:44.055Z [error] [updater] Error: HttpError: 404 
2026-08-01T23:10:44.055Z [error] [updater] error — HttpError: 404 
2026-08-01T23:10:44.055Z [error] [updater] check failed — HttpError: 404 
```

</details>

---

## WOS-005 · New browser tab is dead — typing a domain and pressing Enter does nothing, because a blank tab's <webview> has no src and never attaches a guest

- **Status:** FIXED (2026-08-17, second time) — the first fix rested on a false premise. Blank tabs now render NO webview; the first navigation mounts one with that url as its src.

  **Why it came back.** 8d4a25b mounted blank tabs at `about:blank` "so a guest attaches". Measured against the running app, a webview at about:blank NEVER attaches — `getWebContentsId()` throws indefinitely — while one mounted at a real url attaches at once. So the tab stayed guestless, `loadURL` threw, the `wv.src = url` fallback wrote an attribute with no guest behind it, and the page never painted. `tab.url` updated regardless, so the tab strip, the address bar and the model all looked right.

  **Why the e2e agreed.** It accepted `getAttribute('src')` as proof of navigation and swallowed the `getURL()` failure in a comment — so the fallback's attribute write satisfied it exactly. Worse, its behavioural check passes even now against the broken build, because the address bar drives a tab that works while the new one sits dead. The check that catches it is structural: no webview may be left without a guest. Verified failing on the old code and passing on the new.
- **Severity:** high
- **Surface:** Browser → new tab (+ in the tab strip) → address bar
- **Reported:** 2026-08-02T21:48:50.652Z (seen 2×, last 2026-08-17T06:32:17.612Z)
- **Build:** 0.1.0 · `fa62fc6`
- **Environment:** Darwin 25.3.0 (arm64)

**What happens**

Opening a new tab in the in-app browser gives a blank start pane and a focused address bar, but submitting the address bar never navigates. A blank tab is created with url:'' (browserTabs.makeTab), and BrowserPage renders its <webview> with the src attribute conditionally omitted — `{...(tab.url ? { src: tab.url } : {})}` (BrowserSurface.tsx:176). An Electron <webview> mounted without a src never attaches a guest webContents and never emits dom-ready. The Enter key reaches the form (the input sits inside <form onSubmit={onSubmit}>), toNavUrl() correctly turns "example.com" into "https://example.com", and navigateActive() finds the element in wvRefs — but it then calls `void wv.loadURL(url)` on an unattached webview, which Electron rejects ("The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called"). The throw is unhandled and unlogged, so the UI shows nothing at all. The `wv.src = url` fallback on the next line is never reached, because loadURL IS a function on the element — the typeof guard passes. The tab can never recover: src is only ever set from tab.url at mount, and tab.url is only updated by syncNav, which is driven by guest events that will never fire. The first tab is unaffected because initialTabsState is seeded with HOME_URL, which is why the browser works until you open a second tab. Closing the last tab also produces a blank tab (reducer 'close' → makeTab()), so that path is dead the same way. The updater 404s in the log are unrelated background noise.

**Expected**

A new tab accepts a domain in the address bar and, on Enter, loads that site in that tab — the same as the first tab does.

**Steps to reproduce**

1. Open the Browser surface in Workspace OS
2. Click + in the browser tab strip (or close the last remaining tab) to get a blank New Tab
3. Type a domain, e.g. example.com, into the address bar
4. Press Enter — nothing loads, the start pane stays

**Suspected code** — analysis only, unverified, do not trust without checking

- `src/renderer/src/components/Browser/BrowserSurface.tsx` — Line 176 omits the src attribute entirely for a blank tab (`{...(tab.url ? { src: tab.url } : {})}`), so no guest webContents is ever attached for that tab. Likely fix direction: always give the webview a src (e.g. about:blank) so the guest attaches, or set tab.url before/with the navigate.
- `src/renderer/src/components/Browser/BrowserSurface.tsx` — navigateActive (lines 271-279) calls wv.loadURL on a possibly-unattached webview; the call throws and the error is swallowed by `void`. The `else wv.src = url` fallback is unreachable because loadURL exists as a method regardless of attachment. Worth also dispatching a 'patch' to set tab.url so a re-render can seed src.
- `src/renderer/src/components/Browser/browserTabs.ts` — makeTab() (line 39) and the 'close'-last-tab branch (line 99) both create tabs with url:'' — the state that BrowserPage cannot render into a live guest. Same shape is used by the agent-facing newTab command with no url, so browser.newTab() without a url is probably equally dead.
- `src/renderer/src/components/Browser/browserTabCommands.ts` — newTab resolves only once the tab's guest registers (onTabAttach → dom-ready). For a blank tab that never attaches, an agent's browser.newTab() with no url will hang until its timeout — same root cause, worth verifying alongside.
- `src/main/browser/guestRegistry.ts` — Secondary check only: the tab→guest registry is populated from dom-ready, so a blank tab is also invisible to tab-scoped drive calls. Confirms the symptom rather than causing it.

**Reported as** (the user's own words — authoritative)

> When I open a new tab in the browser, I can type in a domain, but when I hit enter, nothing happens. it seems I cannot start to go to a website from a new open tab

<details><summary>Main-process errors at the time</summary>

```
2026-08-01T23:10:44.055Z [error] [updater] Error: HttpError: 404 
2026-08-01T23:10:44.055Z [error] [updater] error — HttpError: 404 
2026-08-01T23:10:44.055Z [error] [updater] check failed — HttpError: 404 
2026-08-02T05:10:34.211Z [error] [updater] Error: HttpError: 404 
2026-08-02T05:10:34.211Z [error] [updater] error — HttpError: 404 
2026-08-02T05:10:34.212Z [error] [updater] check failed — HttpError: 404 
2026-08-02T11:10:34.345Z [error] [updater] Error: HttpError: 404 
2026-08-02T11:10:34.346Z [error] [updater] error — HttpError: 404 
2026-08-02T11:10:34.346Z [error] [updater] check failed — HttpError: 404 
2026-08-02T17:33:06.415Z [error] [updater] Error: HttpError: 404 
2026-08-02T17:33:06.416Z [error] [updater] error — HttpError: 404 
2026-08-02T17:33:06.417Z [error] [updater] check failed — HttpError: 404 
```

</details>

**Also reported** 2026-08-17T06:32:17.612Z

> When I open a new tab in the browser, the tab does not work. It stays blank, even if I type in a new domain.

---

## WOS-006 · Cmd+C in the browser address bar copies nothing — selected URL never reaches the clipboard

- **Status:** FIXED — fixed in 8d4a25b — clipboard accelerators now routed by focus (editRouter.ts)
- **Severity:** medium
- **Surface:** browser
- **Reported:** 2026-08-02T21:57:01.913Z
- **Build:** 0.1.0 · `fa62fc6`
- **Environment:** Darwin 25.3.0 (arm64)

**What happens**

In the browser surface the address-bar text can be selected with the mouse, but pressing ⌘C leaves the clipboard unchanged — the domain/URL is never copied. The address bar is a plain controlled <input> in the host renderer (BrowserSurface.tsx:407-416); nothing in the Browser components handles clipboard or focus, so ⌘C is left to the native Edit menu's { role: 'copy' } (menu.ts:248), which acts on Electron's *focused* webContents. With a <webview> guest mounted and previously focused (the page the user clicked before reaching for the address bar), the copy role targets the guest — which has no selection — so the host input's selection is silently ignored. Two aggravating factors in the same path: (1) the office Edit menu binds ⌘C to `.uno:Copy` with an explicit accelerator (menu-office.ts:71) and is installed whenever officeDocType is non-null; that state is only cleared when LokRenderer unmounts (LokRenderer.tsx cleanup effect), so a doc that is merely hidden behind the browser tab would leave a ⌘C accelerator that swallows the key before any input sees it; (2) BrowserSurface's nav sync calls setAddress(next.url) on did-navigate / page-title-updated (BrowserSurface.tsx:257), which can rewrite the controlled input's value and collapse the selection between select and copy.

**Expected**

Selecting the URL in the address bar and pressing ⌘C puts that text on the system clipboard, exactly as in Safari/Chrome.

**Steps to reproduce**

1. Open the browser surface and load any site so the address bar shows a URL
2. Click into the address bar and select the domain (double-click or drag)
3. Press ⌘C
4. Paste into any other field — the previous clipboard content appears, not the URL

**Suspected code** — analysis only, unverified, do not trust without checking

- `src/renderer/src/components/Browser/BrowserSurface.tsx` — Owns the address-bar <input> (lines 405-417) and the webview hosts. It never blurs the guest when the address bar takes focus and adds no local ⌘C/copy handling, so clipboard behaviour depends entirely on which webContents Electron considers focused. Its syncNav → setAddress(next.url) at line 257 can also reset the controlled value and clear the user's selection mid-gesture.
- `src/main/menu.ts` — Line 248: Edit → { role: 'copy' } is the only thing bound to ⌘C for non-office surfaces; menu roles are dispatched to the focused webContents, which with an embedded <webview> is likely the guest rather than the host input. Prime place to route copy explicitly at the host, or to add a webview-aware copy handler.
- `src/main/menu-office.ts` — Line 71 replaces Copy with a click handler on `.uno:Copy` carrying an explicit CmdOrCtrl+C accelerator. Whenever officeDocType is stale (LokRenderer still mounted but hidden behind the browser surface, per the resident-doc cache), this menu is installed and eats ⌘C globally — including in the address bar — with no native copy fallback.

**Reported as** (the user's own words — authoritative)

> When I am in the browser I cannot copy paste the browser tab domain. I can select it, but when doing command c, it doesn nt seem to copy the domain.

<details><summary>Main-process errors at the time</summary>

```
2026-08-01T23:10:44.055Z [error] [updater] Error: HttpError: 404 
2026-08-01T23:10:44.055Z [error] [updater] error — HttpError: 404 
2026-08-01T23:10:44.055Z [error] [updater] check failed — HttpError: 404 
2026-08-02T05:10:34.211Z [error] [updater] Error: HttpError: 404 
2026-08-02T05:10:34.211Z [error] [updater] error — HttpError: 404 
2026-08-02T05:10:34.212Z [error] [updater] check failed — HttpError: 404 
2026-08-02T11:10:34.345Z [error] [updater] Error: HttpError: 404 
2026-08-02T11:10:34.346Z [error] [updater] error — HttpError: 404 
2026-08-02T11:10:34.346Z [error] [updater] check failed — HttpError: 404 
2026-08-02T17:33:06.415Z [error] [updater] Error: HttpError: 404 
2026-08-02T17:33:06.416Z [error] [updater] error — HttpError: 404 
2026-08-02T17:33:06.417Z [error] [updater] check failed — HttpError: 404 
```

</details>

---

## WOS-007 · Links that open in a new window do nothing in the in-app browser — <webview> is missing `allowpopups`, so target=_blank/window.open is silently dropped

- **Status:** FIXED — fixed in 8d4a25b — allowpopups set; main routes popups into a new in-app tab
- **Severity:** high
- **Surface:** browser
- **Reported:** 2026-08-02T21:58:45.283Z
- **Build:** 0.1.0 · `fa62fc6`
- **Environment:** Darwin 25.3.0 (arm64)

**What happens**

Clicking a link inside the in-app Browser that is meant to open in a new window/tab (target="_blank" or window.open) produces no visible result at all: no new tab, no new window, no system-browser hand-off, and the current page does not navigate either. The click is swallowed. The <webview> guests in BrowserSurface are rendered with only `className`/`style`/`src`/`partition` — no `allowpopups` attribute (src/renderer/src/components/Browser/BrowserSurface.tsx:171-179). In Electron, a guest <webview> without `allowpopups` cannot create new windows at all: Chromium blocks the popup before it becomes a window, so the guest's `setWindowOpenHandler` in security.ts:146-149 never fires and nothing is logged. Telling detail: the `allowpopups?: string` prop is already declared in the local JSX typing at BrowserSurface.tsx:63 but is never passed to the tag — the attribute looks like it was planned and dropped. Note the second half of the problem: even once popups are enabled, the current handler denies every one and calls shell.openExternal, which would kick the link out to Safari/Chrome rather than opening it as a new tab in the app's own tab strip — so the fix is likely two-part (enable popups, then route the url into `dispatch({type:'add', url})` / the existing `newTab` command bus at BrowserSurface.tsx:329-336 instead of externalising it). The recent-error log is unrelated (auto-updater 404s only). The blank-tab defect WOS-005 is in the same file but is a different failure: that one is about a tab with no src never attaching a guest; this one is about an attached, working guest whose popup request is blocked.

**Expected**

Clicking a new-window link opens the target URL — ideally as a new tab in the in-app browser's tab strip (the app already has multi-tab support and an agent-facing newTab command), or at minimum in the system browser via the existing shell.openExternal path. Either way, something visible must happen.

**Steps to reproduce**

1. Open the Browser surface and load a page that contains a target="_blank" link (e.g. a search-results page or any docs site)
2. Click that link
3. Observe: no new tab appears in the tab strip, no new window opens, no system browser opens, and the current page stays where it was

**Suspected code** — analysis only, unverified, do not trust without checking

- `src/renderer/src/components/Browser/BrowserSurface.tsx` — Primary suspect. The <webview> at lines 171-179 is rendered without the `allowpopups` attribute, so Chromium blocks every popup/new-window request in the guest before Electron can surface it. The `allowpopups?: string` prop is declared in the JSX augmentation at line 63 but never used, suggesting it was intended and lost.
- `src/main/security.ts` — Lines 142-154: the guest's `did-attach-webview` handler installs a setWindowOpenHandler that unconditionally returns `{action:'deny'}` and calls shell.openExternal. This is the code that would run once allowpopups is enabled — it currently has no path that opens the url as an in-app tab, so it is the second half of the fix. Also relevant: `will-attach-webview` at line 128 rewrites webPreferences on attach and is where a popup's preferences would be governed.
- `src/renderer/src/components/Browser/browserTabCommands.ts` — Holds the TAB_COMMAND_EVENT / newTab command already used by the agent to open tabs programmatically. A main→renderer popup request would most naturally be routed through this same bus, so it is where the 'open the popup as a tab' plumbing belongs.
- `src/main/browser/browserControl.ts` — Owns the main-side guest registry and the wos:browser-navigate channel used to push a URL into the active tab. Likely the transport for handing a denied popup url back to the renderer instead of shell.openExternal.

**Reported as** (the user's own words — authoritative)

> When I am in the browser and click a link, which should open in a new window, it does not work. so the browser does not open a new window with the link.

<details><summary>Main-process errors at the time</summary>

```
2026-08-01T23:10:44.055Z [error] [updater] Error: HttpError: 404 
2026-08-01T23:10:44.055Z [error] [updater] error — HttpError: 404 
2026-08-01T23:10:44.055Z [error] [updater] check failed — HttpError: 404 
2026-08-02T05:10:34.211Z [error] [updater] Error: HttpError: 404 
2026-08-02T05:10:34.211Z [error] [updater] error — HttpError: 404 
2026-08-02T05:10:34.212Z [error] [updater] check failed — HttpError: 404 
2026-08-02T11:10:34.345Z [error] [updater] Error: HttpError: 404 
2026-08-02T11:10:34.346Z [error] [updater] error — HttpError: 404 
2026-08-02T11:10:34.346Z [error] [updater] check failed — HttpError: 404 
2026-08-02T17:33:06.415Z [error] [updater] Error: HttpError: 404 
2026-08-02T17:33:06.416Z [error] [updater] error — HttpError: 404 
2026-08-02T17:33:06.417Z [error] [updater] check failed — HttpError: 404 
```

</details>

---

## WOS-008 · ⌘V pastes nothing into the mail composer — clipboard read is denied and the fallback can't update a React-controlled field

- **Status:** FIXED — both defects, and both reproduced in the real app before and after. (1) Clipboard access now goes through Electron's `clipboard` module in main via `IPC.CLIPBOARD_READ/WRITE`, so the deny-all permission policy stays intact rather than being weakened for `clipboard-read`. (2) `setFieldValue` writes through the native prototype setter, which leaves React's value tracker stale so `onChange` fires and controlled fields update. Guarded by `e2e/clipboard.mjs` (6 checks, `npm run e2e:clipboard`) + 20 unit tests in `editRouter.test.ts`.
- **Severity:** high
- **Surface:** mail › new message (compose body/subject/recipients)
- **Reported:** 2026-08-10T10:09:21.582Z
- **Build:** 0.1.37 · `5e1ccba`
- **Environment:** Darwin 25.3.0 (arm64) · open: `~/Documents/Letters/Cover_Letter_Draft.docx`

**What happens**

With text on the clipboard, pressing ⌘V (or Edit ▸ Paste) in a new mail leaves the composer unchanged — no text is inserted and no error is shown. Two independent defects on the same path explain it. (1) Because an office document was open (context: Cover_Letter_Draft.docx), the application Edit menu is the OFFICE one, which binds CmdOrCtrl+V to a custom item that sends the `edit.paste` action instead of Electron's native `role: 'paste'` (src/main/menu-office.ts:81; menu.ts only uses the native roles when no office doc is open). The renderer then handles it in editRouter.runOnTextEntry, which pastes by calling `navigator.clipboard.readText()` — but src/main/security.ts:139 installs a deny-all permission request handler, so `clipboard-read` is refused, the promise rejects, the `catch` returns false, and App.tsx discards that false without falling back to anything. The paste is swallowed silently. (2) Even if the read succeeded, the insert path assigns `input.value = …` and dispatches a synthetic `input` event. React's input value tracker sees no change from a direct `.value` assignment, so `onChange` never fires and the controlled `value={body}` state (MailCompose.tsx:370, :330, :355) is never updated — the text would vanish on the next render and would not be sent. Same module as WOS-006 but a different defect: that one was ⌘C in the browser address bar; this is ⌘V into mail, and it is expected to reproduce in every plain input in the app chrome whenever an office doc is open.

**Expected**

⌘V in the mail composer inserts the clipboard text at the caret and the inserted text is part of the message that gets sent — regardless of whether an office document happens to be open in another tab.

**Steps to reproduce**

1. Open any .docx in the document canvas (so the office Edit menu is installed).
2. Copy some text to the clipboard (from another app or from a document).
3. Switch to the Mail surface and start a new message.
4. Click into the body (or subject) field and press ⌘V, or use Edit ▸ Paste.
5. Nothing is inserted.

**Suspected code** — analysis only, unverified, do not trust without checking

- `src/main/security.ts:139` — setPermissionRequestHandler denies every permission unconditionally, which includes 'clipboard-read'. That makes navigator.clipboard.readText() reject, which is the only mechanism the paste path has.
- `src/renderer/src/lib/editRouter.ts:91-109` — runOnTextEntry's paste branch depends entirely on navigator.clipboard.readText() and swallows the failure in a bare catch returning false; it also mutates input.value directly, which React's value tracker ignores so onChange/state never update.
- `src/renderer/src/App.tsx:83-98` — useEditRouter ignores runOnTextEntry's false return — when the paste fails there is no fallback to the native clipboard and no user-visible signal.
- `src/main/menu-office.ts:79-82` — The office Edit menu claims CmdOrCtrl+X/C/V/A app-wide and routes them to edit.* actions, so having a document open replaces the working native paste role for every surface, mail included.
- `src/main/menu.ts:245-252` — Shows the branch: native roles (working paste) only when officeDocType is null — confirms the bug is conditional on a document being open.
- `src/renderer/src/components/Mail/MailCompose.tsx:330,353-370` — The compose subject/body are controlled React inputs, which is what makes the direct .value assignment in editRouter ineffective.

**Reported as** (the user's own words — authoritative)

> When we are in the mail and want to write a new mail, we cannot Copy Paste a text in there.

<details><summary>Main-process errors at the time</summary>

```
2026-08-09T19:47:54.266Z [error] [updater] error — HttpError: 404 
2026-08-09T19:47:54.266Z [error] [updater] check failed — HttpError: 404 
2026-08-09T19:48:08.160Z [warn] [browser:page] %c%d font-size:0;color:transparent NaN (https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/av0/rch/lg624/0x4AAAAAAADnPIDROrmt1Wwj/ligh:1)
2026-08-09T19:48:08.165Z [warn] [browser:page] %c%d font-size:0;color:transparent NaN (https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/av0/rch/lg624/0x4AAAAAAADnPIDROrmt1Wwj/ligh:1)
2026-08-09T19:48:17.362Z [warn] [browser:page] %c%d font-size:0;color:transparent NaN (https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/av0/rch/2gky2/0x4AAAAAAADnPIDROrmt1Wwj/ligh:1)
2026-08-09T19:48:17.363Z [warn] [browser:page] %c%d font-size:0;color:transparent NaN (https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/av0/rch/2gky2/0x4AAAAAAADnPIDROrmt1Wwj/ligh:1)
2026-08-10T09:54:22.081Z [error] [updater] Error: HttpError: 404 
2026-08-10T09:54:22.082Z [error] [updater] error — HttpError: 404 
2026-08-10T09:54:22.083Z [error] [updater] check failed — HttpError: 404 
2026-08-10T09:54:22.223Z [warn] [browser] load failed -300 ERR_INVALID_URL — https://elevenlabs.io%20coordinates:%208850,%20300,%201769,%20299,%205,%201,%209615,%20450/
2026-08-10T09:54:26.619Z [warn] [browser:page] Permissions policy violation: compute-pressure is not allowed in this document. (https://www.youtube.com/s/player/854a788e/player_embed_es6.vflset/de_DE/base.js:5289)
2026-08-10T10:00:17.289Z [warn] [browser:page] TypeError: Failed to fetch (https://example.com/careers:978)
```

</details>

---

## WOS-009 · Copy from an office document puts nothing on the system clipboard — the LOK engine's clipboard is never bridged to macOS, so ⌘C in a .docx yields nothing to paste into Mail, the browser, or another document

- **Status:** FIXED — both directions, proven on the REAL engine (`npm run e2e:office-clipboard`, and the same test reproduces the reported bug when the bridge is removed). The LOK host gained `getsel`/`pastebuf` (base64-framed) over `getTextSelection`/`paste`; `officeClipboard.ts` holds the policy and is intercepted at `lok:uno`, so the keyboard, the Edit menu and Calc's context menu are all covered rather than just the Writer keyboard path. Paste prefers the system pasteboard for content from other apps but keeps the engine's own clipboard when the pasteboard still holds what we last mirrored — otherwise copying a shape in Impress would be downgraded to stale text. 12 unit tests in `officeClipboard.test.ts`.
- **Severity:** high
- **Surface:** Office canvas (LokRenderer) ↔ rest of the app — cross-surface clipboard
- **Reported:** 2026-08-10T11:42:44.067Z
- **Build:** 0.1.37 · `5e1ccba`
- **Environment:** Darwin 25.3.0 (arm64) · open: `~/Documents/Letters/Cover_Letter.docx`

**What happens**

Selecting text in an open .docx and pressing ⌘C appears to do nothing usable: pasting into Mail, the browser, the agent terminal or another office document produces nothing (or whatever was on the pasteboard before). The reason is that the office canvas's clipboard commands never leave the LibreOffice process. ⌘C on the canvas resolves to target 'canvas' (editRouter.ts:45-49) and is dispatched as `.uno:Copy` (useLokInput.ts:182-191, LokRenderer.tsx:316-325 → `lok:uno`, src/main/handlers/lok.ts:187), which writes into the LOKit host's OWN internal clipboard. That host is a separate spawned headless process (src/main/office/lokHost.ts:142) with no macOS pasteboard integration, and there is no code anywhere in the repo that reads the selection out of it or pushes system-clipboard bytes into it — a repo-wide search finds no `getTextSelection`, `setClipboard`, or any equivalent LOK clipboard call. The renderer never calls `navigator.clipboard.writeText` for the canvas path either (editRouter.ts only does that for focused text inputs, line 118). The same gap runs the other way: ⌘V on the canvas fires `.uno:Paste`, which reads LibreOffice's internal clipboard, so text copied in Mail or the browser cannot be pasted into a document. Copy/paste WITHIN one document should still work (both ends are the engine's own clipboard), which likely matches the user's suspicion that the failure is about crossing between applications rather than one surface being broken. Note the user's guess that Mail/browser are also broken is probably a different, already-filed defect (WOS-008 mail ⌘V, WOS-006 address-bar ⌘C) — this entry is specifically the office-canvas boundary.

**Expected**

⌘C in an office document places the selection on the macOS system clipboard so it can be pasted into Mail, the browser, the terminal, or any other app; ⌘V in an office document inserts whatever is on the system clipboard, regardless of which app or surface it was copied from.

**Steps to reproduce**

1. Open a .docx in the office canvas (e.g. Cover_Letter.docx)
2. Click into the document, select a paragraph of text
3. Press ⌘C (or Edit ▸ Copy)
4. Switch to the Mail composer, the browser address bar, or another app and press ⌘V — nothing from the document arrives
5. Reverse it: copy text in the browser, click into the document and press ⌘V — nothing is inserted

**Suspected code** — analysis only, unverified, do not trust without checking

- `src/renderer/src/components/Canvas/renderers/useLokInput.ts` — onKeyDown lines 182-191 map ⌘C/⌘V/⌘X to bare `.uno:Copy`/`.uno:Paste`/`.uno:Cut` and nothing else — no read of the engine selection onto the system clipboard before copy, and no push of system-clipboard content into the engine before paste.
- `src/renderer/src/lib/editRouter.ts` — resolveEditTarget (lines 45-49) sends the canvas case to UNO_FOR[cmd] (lines 52-57) via a `wos:run-action` event (used from App.tsx:92-94). The system-clipboard work (`navigator.clipboard.writeText/readText`) exists only on the 'input' branch (lines 91-121); the canvas branch has no clipboard interaction at all.
- `src/main/handlers/lok.ts` — `lok:uno` (line 187) is the only route into the engine for clipboard commands and passes the string straight through. There is no `lok:getSelection` / `lok:paste` IPC pair, so the renderer has no way to get bytes out of, or into, the document even if it wanted to.
- `src/main/office/lokHost.ts` — The LOK engine runs as a separate spawned child process (line 142) in headless mode. Its clipboard is process-internal; it cannot see or write the macOS pasteboard, which is why `.uno:Copy` is invisible outside the document. Bridging would need the LOK document clipboard API (getTextSelection / setClipboard-style calls) exposed through this host — none exists in the repo today.
- `src/main/menu-office.ts` — Edit ▸ Cut/Copy/Paste (lines 79-82) register ⌘X/⌘C/⌘V on the application menu and forward to the renderer's edit router. Confirms the menu path lands in the same canvas branch as the keyboard path, so both entry points share the missing bridge.
- `src/renderer/src/components/Canvas/renderers/calcMenu.ts` — The Calc context menu's CLIPBOARD items (lines 32-38, reused at 77/94/110) use the same `.uno:` commands, so Calc's right-click Copy/Paste has the identical boundary problem — worth checking together rather than fixing only the Writer keyboard path.

**Reported as** (the user's own words — authoritative)

> Copying /Pasting  a text from a word doc does not work. This is probably accross differnent applications: Mail, Doc, PPtx, Excel, Browser?

<details><summary>Main-process errors at the time</summary>

```
2026-08-10T11:13:45.934Z [warn] [browser:page] Uncaught (in promise) Error: Minified React error #418; visit https://react.dev/errors/418?args[]= for the full message or use the non-minified dev environment for full errors and additional helpful warnings. (https://static.licdn.com/aero-v1/sc/h/assets/kuu7tUnu.js:1)
2026-08-10T11:13:57.344Z [warn] [browser:page] TypeError: network error (https://static.licdn.com/aero-v1/sc/h/58z3jiq635nf8ip4iicnawsev:9769)
2026-08-10T11:13:57.877Z [warn] [browser:page] Uncaught (in promise) Error: Minified React error #418; visit https://react.dev/errors/418?args[]= for the full message or use the non-minified dev environment for full errors and additional helpful warnings. (https://static.licdn.com/aero-v1/sc/h/assets/kuu7tUnu.js:1)
2026-08-10T11:14:01.358Z [warn] [browser:page] TypeError: network error (https://static.licdn.com/aero-v1/sc/h/58z3jiq635nf8ip4iicnawsev:9769)
2026-08-10T11:14:16.355Z [warn] [browser:page] TypeError: network error (https://static.licdn.com/aero-v1/sc/h/58z3jiq635nf8ip4iicnawsev:9769)
2026-08-10T11:14:38.224Z [warn] [browser:page] Uncaught (in promise) AbortError: The play() request was interrupted because video-only background media was paused to save power. https://goo.gl/LdLk22 (https://careers.allianz.com/global/en:0)
2026-08-10T11:14:38.225Z [warn] [browser:page] Uncaught (in promise) AbortError: The play() request was interrupted because video-only background media was paused to save power. https://goo.gl/LdLk22 (https://careers.allianz.com/global/en:0)
2026-08-10T11:28:22.197Z [warn] [browser:page] Access to XMLHttpRequest at 'https://www.linkedin.com/platform-telemetry/li/apfcDf' from origin 'https://de.linkedin.com' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource. (https://de.linkedin.com/:0)
2026-08-10T11:29:55.100Z [warn] [browser:page] Loading the script 'https://fundingchoicesmessages.google.com/i/ca-pub-1335775269991806?href=https%3A%2F%2Fcrewai.com&ers=2' violates the following Content Security Policy directive: "script-src-elem 'self' https://vercel.live https://rstr.in https://cdn.raster.app https://player.vimeo.com https://f (https://pagead2.googlesyndication.com/pagead/manage
2026-08-10T11:31:04.930Z [warn] [browser:page] Loading the script 'https://fundingchoicesmessages.google.com/i/ca-pub-1335775269991806?href=https%3A%2F%2Fcrewai.com%2Fcareers&ers=2' violates the following Content Security Policy directive: "script-src-elem 'self' https://vercel.live https://rstr.in https://cdn.raster.app https://player.vimeo.com (https://pagead2.googlesyndication.com/pagead/manage
2026-08-10T11:31:16.158Z [warn] [browser:page] Uncaught Error: Minified React error #418; visit https://react.dev/errors/418?args[]=HTML&args[]= for the full message or use the non-minified dev environment for full errors and additional helpful warnings. (https://crewai.com/_next/static/chunks/18bb0c3df2611f86.js?dpl=dpl_Am4gvJeK7AgvDANdhWdP3EKL4QDk:1)
2026-08-10T11:31:16.319Z [warn] [browser:page] Loading the script 'https://fundingchoicesmessages.google.com/i/ca-pub-1335775269991806?href=https%3A%2F%2Fcrewai.com&ers=2' violates the following Content Security Policy directive: "script-src-elem 'self' https://vercel.live https://rstr.in https://cdn.raster.app https://player.vimeo.com https://f (https://pagead2.googlesyndication.com/pagead/manage
```

</details>

---

## WOS-010 · Idea reports time out during analysis — the idea path reuses the bug analyzer's 120s budget and bug-shaped JSON schema, so it burns two full attempts and fails

- **Status:** FIXED — both named causes, plus a third found on the way. (1) Ideas now get `ideaSystemPrompt`, whose schema asks for `verdict` and omits `severity`/`steps` entirely, so it no longer contradicts IDEA_GUIDANCE. (2) The budget is 300s for ideas and is an OVERALL deadline: the retry gets only the time left and is skipped below 30s, so a retry can never double the wait. (3) `ENTRY_RE` matched only `WOS-\d+`, so IDEAS.md always parsed as empty and every idea was filed as IDEA-001 over the last one — ideas were broken for a second, unreported reason. Ideas also render as proposals now (no severity, no repro steps; "What already exists" / "What this would add" / "Worth building?").
  Proven with a REAL model call — `npm run e2e:idea`, 14 checks, returned in **122s**. That number is the evidence the old budget was itself a cause: a full-source idea analysis does not fit in 120s.
- **Severity:** high
- **Surface:** bug reporter (Idea mode)
- **Reported:** 2026-08-10T11:48:30.796Z
- **Build:** 0.1.37 · `5e1ccba`
- **Environment:** Darwin 25.3.0 (arm64) · open: `~/Documents/Letters/Cover_Letter.docx`

**What happens**

Filing an *Idea* (as opposed to a Bug) in the in-app reporter never returns an analysis — it runs long and ends in a timeout/failure. Two things in the shared code path plausibly combine to cause this. (1) `ANALYZE_TIMEOUT_MS` is a single 120s constant used for both kinds (bug-analyzer.ts:23), but the idea prompt (`IDEA_GUIDANCE`, bug-analyzer.ts:123-137) asks the model to do a four-part codebase survey — search what already exists, name the files, judge it against the roadmap rule, state the honest objection — which is far more Read/Grep work than bug triage and does not fit in the bug-sized budget. (2) `systemPrompt()` never receives `kind` (bug-analyzer.ts:59, called at :255), so an idea is still told to reply with the bug schema `{severity, steps, suspects, duplicateOf}` while the user-side IDEA_GUIDANCE says "Do not assign a severity or steps to reproduce." Given contradictory instructions the model tends to answer in prose; `parseAnalysis` then returns null and the `for (attempt of 2)` loop at :250 fires a SECOND full run — so worst-case wall time is ~4 minutes of spinner before 'The analyzer did not return a usable report.' The renderer shows no progress or partial output while this runs (BugReporter.tsx:68-79), so it reads to the user purely as "it's running out of time".

**Expected**

An idea should come back with a usable analysis in a reasonable time: a prompt/schema shaped for ideas (what already exists, what it touches, roadmap-rule verdict, the objection — no severity, no repro steps), a timeout budget sized for the code-searching that idea analysis actually requires, and a retry that only re-runs when the reply was genuinely unparseable rather than because the schema contradicted the instructions.

**Steps to reproduce**

1. Open the in-app bug reporter
2. Switch the kind toggle from Bug to Idea
3. Type a feature idea and press Analyze & file (or ⌘Enter)
4. Wait — the analysis spins for minutes and then fails instead of returning a proposal

**Suspected code** — analysis only, unverified, do not trust without checking

- `src/main/bugs/bug-analyzer.ts` — Line 23: `ANALYZE_TIMEOUT_MS = 120_000` is one constant for both kinds, but IDEA_GUIDANCE (123-137) demands a multi-step repo survey that a bug-sized budget can't cover. Line 255: `systemPrompt(localized, attempt > 0)` never gets `input.kind`, so ideas are still asked for the bug JSON (severity/steps) that IDEA_GUIDANCE forbids — the contradiction makes the reply unparseable. Line 250: the two-attempt loop then doubles the wall clock to ~240s before erroring.
- `src/main/agent/claudeRun.ts` — The timeout is enforced per child process (line 93, SIGTERM after `timeoutMs`), so it is per-attempt with no overall deadline for the analyze call — nothing caps the combined two-attempt duration, and a killed child resolves with whatever partial text it had.
- `src/main/handlers/bugs.ts` — `bug:analyze` (line 197) awaits `analyzeBug` synchronously over IPC with no per-kind timeout or progress channel, so the renderer has nothing to show and the whole cost lands in one blocking call.
- `src/renderer/src/components/BugReport/BugReporter.tsx` — `analyze` (line 68) is a single await with no elapsed-time feedback, cancel, or partial rendering — a slow idea analysis is indistinguishable from a hang, which is exactly how this was reported.

**Reported as** (the user's own words — authoritative)

> We have a problem when running the bug report for ideas, not the bugs: 
> It seems it is running out of time. or timing out

<details><summary>Main-process errors at the time</summary>

```
2026-08-10T11:13:45.934Z [warn] [browser:page] Uncaught (in promise) Error: Minified React error #418; visit https://react.dev/errors/418?args[]= for the full message or use the non-minified dev environment for full errors and additional helpful warnings. (https://static.licdn.com/aero-v1/sc/h/assets/kuu7tUnu.js:1)
2026-08-10T11:13:57.344Z [warn] [browser:page] TypeError: network error (https://static.licdn.com/aero-v1/sc/h/58z3jiq635nf8ip4iicnawsev:9769)
2026-08-10T11:13:57.877Z [warn] [browser:page] Uncaught (in promise) Error: Minified React error #418; visit https://react.dev/errors/418?args[]= for the full message or use the non-minified dev environment for full errors and additional helpful warnings. (https://static.licdn.com/aero-v1/sc/h/assets/kuu7tUnu.js:1)
2026-08-10T11:14:01.358Z [warn] [browser:page] TypeError: network error (https://static.licdn.com/aero-v1/sc/h/58z3jiq635nf8ip4iicnawsev:9769)
2026-08-10T11:14:16.355Z [warn] [browser:page] TypeError: network error (https://static.licdn.com/aero-v1/sc/h/58z3jiq635nf8ip4iicnawsev:9769)
2026-08-10T11:14:38.224Z [warn] [browser:page] Uncaught (in promise) AbortError: The play() request was interrupted because video-only background media was paused to save power. https://goo.gl/LdLk22 (https://careers.allianz.com/global/en:0)
2026-08-10T11:14:38.225Z [warn] [browser:page] Uncaught (in promise) AbortError: The play() request was interrupted because video-only background media was paused to save power. https://goo.gl/LdLk22 (https://careers.allianz.com/global/en:0)
2026-08-10T11:28:22.197Z [warn] [browser:page] Access to XMLHttpRequest at 'https://www.linkedin.com/platform-telemetry/li/apfcDf' from origin 'https://de.linkedin.com' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource. (https://de.linkedin.com/:0)
2026-08-10T11:29:55.100Z [warn] [browser:page] Loading the script 'https://fundingchoicesmessages.google.com/i/ca-pub-1335775269991806?href=https%3A%2F%2Fcrewai.com&ers=2' violates the following Content Security Policy directive: "script-src-elem 'self' https://vercel.live https://rstr.in https://cdn.raster.app https://player.vimeo.com https://f (https://pagead2.googlesyndication.com/pagead/manage
2026-08-10T11:31:04.930Z [warn] [browser:page] Loading the script 'https://fundingchoicesmessages.google.com/i/ca-pub-1335775269991806?href=https%3A%2F%2Fcrewai.com%2Fcareers&ers=2' violates the following Content Security Policy directive: "script-src-elem 'self' https://vercel.live https://rstr.in https://cdn.raster.app https://player.vimeo.com (https://pagead2.googlesyndication.com/pagead/manage
2026-08-10T11:31:16.158Z [warn] [browser:page] Uncaught Error: Minified React error #418; visit https://react.dev/errors/418?args[]=HTML&args[]= for the full message or use the non-minified dev environment for full errors and additional helpful warnings. (https://crewai.com/_next/static/chunks/18bb0c3df2611f86.js?dpl=dpl_Am4gvJeK7AgvDANdhWdP3EKL4QDk:1)
2026-08-10T11:31:16.319Z [warn] [browser:page] Loading the script 'https://fundingchoicesmessages.google.com/i/ca-pub-1335775269991806?href=https%3A%2F%2Fcrewai.com&ers=2' violates the following Content Security Policy directive: "script-src-elem 'self' https://vercel.live https://rstr.in https://cdn.raster.app https://player.vimeo.com https://f (https://pagead2.googlesyndication.com/pagead/manage
```

</details>

---

## WOS-011 · No way to enlarge a single surface to fill the window — the rail and tab strip are always mounted, so browser/mail/office can't go full-screen

- **Status:** BUILT — ⌃⌘F (or the ⤢ button in the tab strip) expands the active surface: the rail slides out, the tab strip folds up, the terminal dock unmounts. Esc or the always-visible "Exit full window" pill returns. ⌘B is the lighter gesture — rail only — and now does something, having been wired to an empty function. Scoped to the NEW shell, deliberately: `BrowserSurface` exists only there, so whoever reported WOS-012 was running it. Not persisted, because reopening into a window with no rail and no tabs gives the user no way to understand what happened. The dock is suppressed without writing `terminalOpen`, so collapsing restores exactly the terminal they had. Guarded by `npm run e2e:shell-layout` (20 checks) which reads MEASURED geometry — a class that styles nothing looks identical to a working feature from the DOM.
- **Severity:** medium
- **Surface:** shell / layout (all surfaces: browser, mail, office canvas, calendar, knowledge)
- **Reported:** 2026-08-10T11:52:05.055Z
- **Build:** 0.1.37 · `5e1ccba`
- **Environment:** Darwin 25.3.0 (arm64) · open: `~/Documents/Letters/Cover_Letter.docx`

**What happens**

Feature request, not a defect. The user wants to expand any surface — browser, mail, Word/PowerPoint/Excel canvas — so it fills the whole screen when they need the extra room to concentrate on one app. Today the shell has no such control: WorkspaceShell renders a fixed `grid-template-columns: 76px 1fr` root (rail | stage) with the topbar tab strip always above the surface, and every rail surface is a sibling inside `.body` that can only ever occupy the leftover space. There is no per-surface expand/zen state anywhere in the renderer. The only existing 'enlarge' is the OS-level `window:maximize` IPC (src/main/index.ts:221), which resizes the Electron window but keeps all app chrome. The closest in-app precedent is Files' 'Open full' button, which promotes the tree-side peek to a full Stage tab — but that is files-only and still keeps the rail and tab bar. Notably, even the partial escape hatch is dead in the new shell: `onToggleSidebar` is wired to an empty function, so ⌘B cannot reclaim the 76px rail. The user also notes the idea reporter timed out on this submission — that is WOS-010, already filed.

**Expected**

Every surface can be expanded to fill the window (rail, tab strip, and dock animating out), with a matching collapse back to the normal layout, a keyboard shortcut, and a smooth modern transition rather than a hard layout jump.

**Steps to reproduce**

_Not captured — reproduce from the description._

**Suspected code** — analysis only, unverified, do not trust without checking

- `src/renderer/src/components/Shell/WorkspaceShell.tsx` — The new shell's layout owner. Every surface is a sibling `div.surface` inside `.body`, with `Rail` and `.topbar` unconditionally rendered around it — an `expanded` state here (and hiding rail/topbar/dock when set) is the natural home for the feature. Line 273 shows `onToggleSidebar: () => {}`, a no-op, so today not even the rail can be dismissed. Line ~485's 'Open full' button is the existing files-only precedent.
- `src/renderer/src/components/Shell/WorkspaceShell.module.css` — `.root` is a hard `display: grid; grid-template-columns: 76px 1fr`. The 'super smooth' animation the user asks for has to come from here — an animatable grid track (76px → 0) plus a collapsible topbar height, ideally with a transform/opacity fade so it doesn't relayout-thrash.
- `src/renderer/src/components/Layout/WorkspaceLayout.tsx` — The LEGACY shell, and still the default (`newShell` defaults off, App.tsx:53). It has `sidebarOpen` (line 49) but no maximize. Whichever shell the reporter is actually running, the feature likely has to land in both or be explicitly scoped to the new one.
- `src/renderer/src/hooks/useKeyboardShortcuts.ts` — Where a toggle binding (e.g. ⌃⌘F or ⌘⇧Enter) would be registered, alongside the existing sidebar/terminal toggles; Esc-to-exit would belong here too.
- `src/renderer/src/components/Browser/BrowserSurface.tsx` — GUESS — the browser is the surface the user named first and the riskiest to animate: it hosts a sandboxed <webview> whose guest does not resize as cheaply as a DOM node, so a CSS width/height transition on it may stutter. Worth checking whether the expand should snap the webview and animate only the surrounding chrome.
- `src/main/index.ts` — Line 221 handles `window:maximize` (toggling the Electron window). Relevant as the existing, chrome-preserving 'enlarge' the user is implicitly contrasting against — and a decision point on whether in-app expand should also maximize the OS window.

**Reported as** (the user's own words — authoritative)

> Not a bug report, but as the idea report is timing out: 
> It would be great to be able to enlarge any window in any application. for example: Enlarge the browser, so it is covering the full screen. same with the email or word, pptx. excel. Some of these are working already. The reason is, that sometimes the user needs this extra space and wants to work on the full screen within one application. We have something similar alraeady for the multiple screens. The animation should feel super smooth and modern.

<details><summary>Main-process errors at the time</summary>

```
2026-08-10T11:13:45.934Z [warn] [browser:page] Uncaught (in promise) Error: Minified React error #418; visit https://react.dev/errors/418?args[]= for the full message or use the non-minified dev environment for full errors and additional helpful warnings. (https://static.licdn.com/aero-v1/sc/h/assets/kuu7tUnu.js:1)
2026-08-10T11:13:57.344Z [warn] [browser:page] TypeError: network error (https://static.licdn.com/aero-v1/sc/h/58z3jiq635nf8ip4iicnawsev:9769)
2026-08-10T11:13:57.877Z [warn] [browser:page] Uncaught (in promise) Error: Minified React error #418; visit https://react.dev/errors/418?args[]= for the full message or use the non-minified dev environment for full errors and additional helpful warnings. (https://static.licdn.com/aero-v1/sc/h/assets/kuu7tUnu.js:1)
2026-08-10T11:14:01.358Z [warn] [browser:page] TypeError: network error (https://static.licdn.com/aero-v1/sc/h/58z3jiq635nf8ip4iicnawsev:9769)
2026-08-10T11:14:16.355Z [warn] [browser:page] TypeError: network error (https://static.licdn.com/aero-v1/sc/h/58z3jiq635nf8ip4iicnawsev:9769)
2026-08-10T11:14:38.224Z [warn] [browser:page] Uncaught (in promise) AbortError: The play() request was interrupted because video-only background media was paused to save power. https://goo.gl/LdLk22 (https://careers.allianz.com/global/en:0)
2026-08-10T11:14:38.225Z [warn] [browser:page] Uncaught (in promise) AbortError: The play() request was interrupted because video-only background media was paused to save power. https://goo.gl/LdLk22 (https://careers.allianz.com/global/en:0)
2026-08-10T11:28:22.197Z [warn] [browser:page] Access to XMLHttpRequest at 'https://www.linkedin.com/platform-telemetry/li/apfcDf' from origin 'https://de.linkedin.com' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource. (https://de.linkedin.com/:0)
2026-08-10T11:29:55.100Z [warn] [browser:page] Loading the script 'https://fundingchoicesmessages.google.com/i/ca-pub-1335775269991806?href=https%3A%2F%2Fcrewai.com&ers=2' violates the following Content Security Policy directive: "script-src-elem 'self' https://vercel.live https://rstr.in https://cdn.raster.app https://player.vimeo.com https://f (https://pagead2.googlesyndication.com/pagead/manage
2026-08-10T11:31:04.930Z [warn] [browser:page] Loading the script 'https://fundingchoicesmessages.google.com/i/ca-pub-1335775269991806?href=https%3A%2F%2Fcrewai.com%2Fcareers&ers=2' violates the following Content Security Policy directive: "script-src-elem 'self' https://vercel.live https://rstr.in https://cdn.raster.app https://player.vimeo.com (https://pagead2.googlesyndication.com/pagead/manage
2026-08-10T11:31:16.158Z [warn] [browser:page] Uncaught Error: Minified React error #418; visit https://react.dev/errors/418?args[]=HTML&args[]= for the full message or use the non-minified dev environment for full errors and additional helpful warnings. (https://crewai.com/_next/static/chunks/18bb0c3df2611f86.js?dpl=dpl_Am4gvJeK7AgvDANdhWdP3EKL4QDk:1)
2026-08-10T11:31:16.319Z [warn] [browser:page] Loading the script 'https://fundingchoicesmessages.google.com/i/ca-pub-1335775269991806?href=https%3A%2F%2Fcrewai.com&ers=2' violates the following Content Security Policy directive: "script-src-elem 'self' https://vercel.live https://rstr.in https://cdn.raster.app https://player.vimeo.com https://f (https://pagead2.googlesyndication.com/pagead/manage
```

</details>

---

## WOS-012 · Browser Assistant panel cannot be collapsed — it permanently occupies 300px of the window's right edge

- **Status:** BUILT — the panel collapses from its header control or ⌥⌘A, with a pinned tab on the right edge to bring it back, and the column is drag-resizable (220–640px, double-click to reset). Both the collapsed choice and the width persist in localStorage next to the browser session, read via a lazy initialiser so it never renders open-then-shut. Covered by the same `e2e:shell-layout` run, which asserts the PAGE actually gets the width back rather than just that a class flipped.
- **Severity:** medium
- **Surface:** browser
- **Reported:** 2026-08-10T12:03:40.251Z
- **Build:** 0.1.37 · `5e1ccba`
- **Environment:** Darwin 25.3.0 (arm64) · open: `~/Documents/Letters/Cover_Letter.docx`

**What happens**

The Browser surface is laid out as a fixed two-column grid (`grid-template-columns: 1fr 300px`) and `<PageAssistant>` is rendered unconditionally at the end of `BrowserSurface`. There is no toggle, no keyboard shortcut, no drag handle, and no persisted collapsed state, so the Assistant sidebar is always visible and always exactly 300px wide. The web page is squeezed into whatever remains, which on a laptop-width window meaningfully narrows the page and can push responsive sites into their tablet/mobile breakpoints.

**Expected**

The Assistant panel should be collapsible — a control in its header (and/or a keyboard shortcut) that hides it and gives the full width back to the page, with a visible affordance to bring it back and the collapsed/expanded choice remembered across tab switches, surface switches, and app restarts. Resizing the panel by dragging its edge would be the natural companion.

**Steps to reproduce**

1. Open the Browser surface
2. Observe the Assistant panel pinned to the right edge, with no control anywhere to hide or narrow it

**Suspected code** — analysis only, unverified, do not trust without checking

- `src/renderer/src/components/Browser/BrowserSurface.module.css` — `.browser` at lines 5-11 hardcodes `grid-template-columns: 1fr 300px`. The collapse would live here — e.g. drive the second track from a CSS variable or a `collapsed` class so it can go to 0 (and `.bmain`'s `border-right` should drop with it).
- `src/renderer/src/components/Browser/BrowserSurface.tsx` — Line 857 renders `<PageAssistant …>` unconditionally as the grid's second child. This is where a `assistantCollapsed` state and the class toggle on the wrapper would be owned. Note: unmounting the panel would drop its Q&A log and profile state, so hide via CSS rather than conditional render unless that loss is acceptable.
- `src/renderer/src/components/Browser/PageAssistant.tsx` — The `<aside className={styles.panel}>` header block at lines 228-233 (`.head` / `.title` with the Sparkles icon) is the obvious home for a chevron collapse button; the component currently takes no visibility props.
- `src/renderer/src/components/Browser/PageAssistant.module.css` — `.panel` and the header styles need a collapsed variant (and a slim re-open rail or floating button) so the panel does not simply vanish with no way back.
- `src/renderer/src/hooks/useSettings.ts` — Guess — this is the shared settings store used elsewhere in the shell; likely the right place to persist the collapsed flag so it survives restart. Not yet read in detail, so confirm it is the correct persistence layer.

**Reported as** (the user's own words — authoritative)

> In the browser app, we have the Assistant panel on the right. It would be great if we could make this collapsable

<details><summary>Main-process errors at the time</summary>

```
2026-08-10T11:14:16.355Z [warn] [browser:page] TypeError: network error (https://static.licdn.com/aero-v1/sc/h/58z3jiq635nf8ip4iicnawsev:9769)
2026-08-10T11:14:38.224Z [warn] [browser:page] Uncaught (in promise) AbortError: The play() request was interrupted because video-only background media was paused to save power. https://goo.gl/LdLk22 (https://careers.allianz.com/global/en:0)
2026-08-10T11:14:38.225Z [warn] [browser:page] Uncaught (in promise) AbortError: The play() request was interrupted because video-only background media was paused to save power. https://goo.gl/LdLk22 (https://careers.allianz.com/global/en:0)
2026-08-10T11:28:22.197Z [warn] [browser:page] Access to XMLHttpRequest at 'https://www.linkedin.com/platform-telemetry/li/apfcDf' from origin 'https://de.linkedin.com' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource. (https://de.linkedin.com/:0)
2026-08-10T11:29:55.100Z [warn] [browser:page] Loading the script 'https://fundingchoicesmessages.google.com/i/ca-pub-1335775269991806?href=https%3A%2F%2Fcrewai.com&ers=2' violates the following Content Security Policy directive: "script-src-elem 'self' https://vercel.live https://rstr.in https://cdn.raster.app https://player.vimeo.com https://f (https://pagead2.googlesyndication.com/pagead/manage
2026-08-10T11:31:04.930Z [warn] [browser:page] Loading the script 'https://fundingchoicesmessages.google.com/i/ca-pub-1335775269991806?href=https%3A%2F%2Fcrewai.com%2Fcareers&ers=2' violates the following Content Security Policy directive: "script-src-elem 'self' https://vercel.live https://rstr.in https://cdn.raster.app https://player.vimeo.com (https://pagead2.googlesyndication.com/pagead/manage
2026-08-10T11:31:16.158Z [warn] [browser:page] Uncaught Error: Minified React error #418; visit https://react.dev/errors/418?args[]=HTML&args[]= for the full message or use the non-minified dev environment for full errors and additional helpful warnings. (https://crewai.com/_next/static/chunks/18bb0c3df2611f86.js?dpl=dpl_Am4gvJeK7AgvDANdhWdP3EKL4QDk:1)
2026-08-10T11:31:16.319Z [warn] [browser:page] Loading the script 'https://fundingchoicesmessages.google.com/i/ca-pub-1335775269991806?href=https%3A%2F%2Fcrewai.com&ers=2' violates the following Content Security Policy directive: "script-src-elem 'self' https://vercel.live https://rstr.in https://cdn.raster.app https://player.vimeo.com https://f (https://pagead2.googlesyndication.com/pagead/manage
2026-08-10T11:53:36.660Z [warn] [browser:page] %c%d font-size:0;color:transparent NaN (https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/av0/rch/s3b39/0x4AAAAAAAVY8hH3nz6RxaK0/ligh:1)
2026-08-10T11:53:36.660Z [warn] [browser:page] %c%d font-size:0;color:transparent NaN (https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/av0/rch/s3b39/0x4AAAAAAAVY8hH3nz6RxaK0/ligh:1)
2026-08-10T11:58:30.024Z [warn] [browser:page] %c%d font-size:0;color:transparent NaN (https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/av0/rch/s3b39/0x4AAAAAAAVY8hH3nz6RxaK0/ligh:1)
2026-08-10T11:58:30.025Z [warn] [browser:page] %c%d font-size:0;color:transparent NaN (https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/av0/rch/s3b39/0x4AAAAAAAVY8hH3nz6RxaK0/ligh:1)
```

</details>

---

## WOS-013 · Files surface has no sort, no real filter, and no Finder-style folder browsing or previews

- **Status:** BUILT — the Files right pane is now a browsable location instead of a "Select a file to open it here." dead end: sortable Name/Kind/Date modified/Size columns, filters by name + kind + age, a breadcrumb, back/forward, and click-to-enter subfolders. The enabling change was `fs:read-dir`, which returned only name/path/isDirectory — that is why the order was hardcoded; it now carries `size` and `mtimeMs` (one stat per entry, in parallel, degrading to zeroes so a permission-denied file is still listed). Selecting a file loads it into the same pane through the real Canvas, which IS the preview — a separate thumbnail pipeline would render fewer formats than the editor already does — and a "Folder" button returns to browsing. Rules live in `fileBrowserModel.ts` (27 unit tests); `npm run e2e:files-browser` (22 checks) builds a folder with known sizes and staggered timestamps and asserts the app sorts by them, which is the only way to prove the stat data is real.
  Not built: icon/gallery/column view modes. The report lists them as optional ("optionally as an expanded Finder-like icon/column/gallery view"), and the list view carries the sorting and filtering the request actually leads with.
- **Severity:** medium
- **Surface:** files
- **Reported:** 2026-08-10T14:21:59.576Z
- **Build:** 0.1.37 · `5e1ccba`
- **Environment:** Darwin 25.3.0 (arm64)

**What happens**

The Files surface is a single sidebar tree with fixed ordering and a name-substring box. Order is hardcoded to folders-first then name A→Z in `loadChildren` (src/renderer/src/hooks/useFileTree.ts:13-17) with no UI to change it — and it cannot currently be changed, because the `fs:read-dir` IPC handler returns only `{name, path, isDirectory}` (src/main/handlers/fs.ts:72-76) and `FileEntry` (src/renderer/src/types/fs.ts) carries no size, mtime or kind to sort or filter on. The "Filter files…" box is not a filter in the Finder sense: `flatFilter` (FilePanel.tsx:305-312) matches the name substring and strips `children`, so results arrive as a flat list with folder context lost, and it only searches directories already expanded/loaded (the tree is lazily loaded in `toggle`). There is no filter by kind, date or star. Going into a subfolder means expanding it in place — no double-click-to-enter, no breadcrumb/back-forward in the Files surface (`revealPath` exists but is only driven by the external `wos:reveal-path` event, FilePanel.tsx:27-34), so deep folders indent off the left edge of a narrow sidebar. And there are no previews: the right pane of the Files split opens the selected file in the real editor (WorkspaceShell.tsx:462-480), so there is no lightweight thumbnail/QuickLook-style peek and no icon/gallery/column view.

**Expected**

The Files app should behave like a real file browser: sortable columns (name, kind, date modified, size), filtering by kind/date as well as name, drilling into a subfolder as a navigable location with a breadcrumb and back/forward, and a preview — thumbnail or QuickLook-style peek — for documents, images and PDFs, optionally as an expanded Finder-like icon/column/gallery view rather than only the narrow sidebar tree.

**Steps to reproduce**

1. Open a folder in the Files surface with a mix of documents and subfolders
2. Look for a way to sort by date modified or size — there is none; the order is always folders first, then name A→Z
3. Type in the "Filter files…" box — matches come back as a flat list without their parent folders, and only for folders already expanded
4. Click a subfolder — it expands in place; there is no way to enter it as a location with a breadcrumb
5. Select a file — it opens in the full editor pane; there is no thumbnail or quick preview

**Suspected code** — analysis only, unverified, do not trust without checking

- `src/renderer/src/hooks/useFileTree.ts` — `loadChildren` hardcodes the sort (dirs first, then `localeCompare`) and the dotfile filter, and owns the lazy expand/collapse model. Any sort order, sort direction or "enter this folder as a location" navigation has to be introduced here — `revealPath` is the only existing primitive for navigating to a folder.
- `src/renderer/src/components/FilePanel/FilePanel.tsx` — Owns the header, the "Filter files…" input and `flatFilter`/`flatPaths`. This is where sort/filter controls would live, and `flatFilter` (line 305) is exactly the naive name-substring match that drops folder context — it also can't see unloaded subtrees.
- `src/main/handlers/fs.ts` — The `fs:read-dir` handler (line 68) returns only name/path/isDirectory. Sorting or filtering by date, size or kind is blocked until this returns `stat` data — likely the first change needed.
- `src/renderer/src/types/fs.ts` — `FileEntry`/`TreeNode` have no size/mtime/kind fields; they must be widened alongside the IPC handler.
- `src/renderer/src/components/FilePanel/FileTree.tsx` — The renderer for rows. Fixed indent-per-depth (`paddingLeft: 8 + depth * 16`, line 88) is what makes deep subfolders unusable in a narrow pane; a column/gallery/list-with-columns view would be introduced or branched here. Guess: a preview-on-hover/selection hook would also attach to the row.
- `src/renderer/src/components/Shell/WorkspaceShell.tsx` — Lines ~460-500 define the Files split (tree LEFT / opened file RIGHT). "Expand with previews like Finder" means changing what that right pane shows — a lightweight preview instead of, or before, the full Canvas editor. Guess: a preview component does not exist yet and would be new.
- `src/renderer/src/components/CalmCockpit/ArtifactThumb.tsx` — Guess — name suggests existing thumbnail rendering for artifacts; if it can render document thumbnails it may be the reusable basis for Finder-style previews rather than building one from scratch. Not verified.

**Reported as** (the user's own words — authoritative)

> Es wäre top den Files App noch etwas zu verbessern: Sorting, filtern, besser in Subfolder gehen. Vielleicht sogar expanden mit previews, wie in einem Finder

<details><summary>Main-process errors at the time</summary>

```
2026-08-10T12:13:18.293Z [warn] [browser:page] %c%d font-size:0;color:transparent NaN (https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/av0/rch/s3b39/0x4AAAAAAAVY8hH3nz6RxaK0/ligh:1)
2026-08-10T12:18:15.422Z [warn] [browser:page] %c%d font-size:0;color:transparent NaN (https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/av0/rch/s3b39/0x4AAAAAAAVY8hH3nz6RxaK0/ligh:1)
2026-08-10T12:18:15.422Z [warn] [browser:page] %c%d font-size:0;color:transparent NaN (https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/av0/rch/s3b39/0x4AAAAAAAVY8hH3nz6RxaK0/ligh:1)
2026-08-10T12:23:15.289Z [warn] [browser:page] %c%d font-size:0;color:transparent NaN (https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/av0/rch/s3b39/0x4AAAAAAAVY8hH3nz6RxaK0/ligh:1)
2026-08-10T12:23:15.290Z [warn] [browser:page] %c%d font-size:0;color:transparent NaN (https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/av0/rch/s3b39/0x4AAAAAAAVY8hH3nz6RxaK0/ligh:1)
2026-08-10T12:26:34.720Z [warn] [browser:page] TypeError: network error (https://static.licdn.com/aero-v1/sc/h/58z3jiq635nf8ip4iicnawsev:9769)
2026-08-10T12:26:37.172Z [warn] [browser:page] [14:26:37.165] [WonderPush] [website] [sw-client   ] [subscribeAppropriately] pushManager.subscribe( [object Object] ) rejected [object DOMException] (https://cdn.by.wonderpush.com/sdk/1.1.44.0/wonderpush.min.js:1)
2026-08-10T12:26:37.174Z [warn] [browser:page] [14:26:37.174] [WonderPush] [website] [sw-client   ] [subscribeAppropriately] pushManager.subscribe( [object Object] ) rejected [object DOMException] (https://cdn.by.wonderpush.com/sdk/1.1.44.0/wonderpush.min.js:1)
2026-08-10T12:26:39.593Z [warn] [browser:page] [14:26:39.593] [WonderPush] [website] [sw-client   ] [subscribeAppropriately] pushManager.subscribe( [object Object] ) rejected [object DOMException] (https://cdn.by.wonderpush.com/sdk/1.1.44.0/wonderpush.min.js:1)
2026-08-10T12:26:39.594Z [warn] [browser:page] [14:26:39.594] [WonderPush] [website] [sw-client   ] [subscribeAppropriately] pushManager.subscribe( [object Object] ) rejected [object DOMException] (https://cdn.by.wonderpush.com/sdk/1.1.44.0/wonderpush.min.js:1)
2026-08-10T12:28:11.014Z [warn] [browser:page] %c%d font-size:0;color:transparent NaN (https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/av0/rch/s3b39/0x4AAAAAAAVY8hH3nz6RxaK0/ligh:1)
2026-08-10T12:28:11.014Z [warn] [browser:page] %c%d font-size:0;color:transparent NaN (https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/av0/rch/s3b39/0x4AAAAAAAVY8hH3nz6RxaK0/ligh:1)
```

</details>

---

## WOS-014 · "Load images" in the mail reader does nothing — remote images stay blank, and inline (cid:) images never render at all

- **Status:** fixed (2026-08-17) — pending click-test in the running app
- **Severity:** high
- **Surface:** mail
- **Reported:** 2026-08-17T06:29:46.184Z
- **Build:** 0.1.39 · `8000c07`
- **Environment:** Darwin 25.3.0 (arm64) · open: `~/Documents/Letters/Cover_Letter.docx`

**What happens**

In the mail reader, message images do not appear. Clicking the "Load images" button on the blocked-content banner flips the reader into remote mode but no image ever paints, and embedded/inline images (logos, signatures — the ones the app never claimed to block) are blank from the moment the message opens. Two independent causes, either of which alone is fatal:

**Fix (2026-08-17).** Remote images are now fetched in the MAIN process and returned as data: URIs, which the existing `img-src data:` already permits — so the app-wide CSP is untouched and no other surface gains network image loading. New module `src/main/mail/remote-images.ts` + IPC `mail:remote-images`; the reader substitutes the bytes into `data-blocked-*` instead of promoting the remote URL, and a URL that fails stays inert. It leaks *less* than the original design intended: no cookies, no referrer.

Moving the fetch into main introduces an SSRF surface the renderer's CSP was implicitly covering — message URLs are attacker-chosen and main can reach the loopback interface, `169.254.169.254`, and the user's own LAN. `isBlockedHost` refuses loopback/private/link-local/multicast literals; 18 tests cover it, two of which were watched failing with the guard disabled. Known residual: a DNS name that *resolves* to a private address still passes, because Node's fetch does not expose resolution-time hooks. Narrower than the hole it closes, and the response is never shown to the sender.

1. Remote images: the reader body is a `srcDoc` iframe (MailReader.tsx:179-189). A srcdoc document inherits the embedder's CSP, and CSP composes by intersection — an inner `<meta http-equiv>` policy can only narrow the inherited one, never widen it. The app-wide policy injected in src/main/security.ts:107 is `img-src 'self' data: blob: http://localhost:* http://127.0.0.1:*`, which has no `https:`. So the reader's opt-in policy (`img-src data: https:`, MailReader.tsx:56-58) is intersected down to `data:` and every promoted `data-blocked-src` → `src` load is refused by the parent policy. The "Load images" button is wired correctly; the load is killed one layer up. Expect `Refused to load the image ... violates the following Content Security Policy directive: img-src` in the renderer console. (Secondary: protocol-relative URLs, which message-parser.ts:223 explicitly captures, are promoted back as `//host/x.png` and would resolve against the app's own scheme even if the CSP allowed them.)

2. ~~Inline cid: images never render.~~ **CORRECTED 2026-08-17 — this cause was wrong.** mailparser's `simpleParser` already rewrites `cid:` to a data: URI before our code sees the HTML, in both multipart/related and multipart/mixed. Measured directly against the library, not inferred. The cited proof (message-parser.test.ts:140-142) exercises `sanitizeHtml` in isolation — a function that receives no attachments and therefore could never have inlined anything — so it says nothing about what the reader renders. The real gap is much narrower: mailparser matches the Content-ID exactly, so it misses references differing in case (`cid:LOGO123` vs `Content-ID: <logo123>`) or carrying brackets (`cid:<logo123>`), both of which senders emit. **Fixed** by a bounded fallback in `inlineCidImages` (message-parser.ts), image types allow-listed with `image/svg+xml` excluded, verified by tests watched failing first.

The same ceiling applies to the PDF export path (src/main/handlers/mail.ts:471, `img-src data:`), so "Export PDF" is not a workaround.

**Expected**

Inline cid: images render immediately when a message is opened (they are attachment bytes, not a network fetch, so there is no privacy reason to block them). Clicking "Load images" makes the previously blocked remote images fetch and paint inside the sandboxed iframe, with the per-message opt-in and no-script guarantees intact.

**Steps to reproduce**

1. Open the mail surface and select an HTML message containing images (a newsletter, or any message with an inline logo/signature).
2. Observe: inline images are blank; the "Remote images were blocked" banner appears.
3. Click "Load images".
4. Observe: the banner disappears but no image loads — the body stays image-free.

**Suspected code** — analysis only, unverified, do not trust without checking

- `src/main/security.ts` — Line 107 — app-wide `img-src 'self' data: blob: http://localhost:* http://127.0.0.1:*` has no `https:`. This policy is injected on the app document via onHeadersReceived (line 121) and is inherited by the reader's srcdoc iframe, so it overrides (intersects) the reader's own opt-in `img-src data: https:`. Prime suspect for the dead "Load images" button. Widening it globally is the wrong fix — the remote-image allowance needs to live where only the mail iframe gets it (e.g. serve the body from a dedicated scheme/partition with its own header-based CSP instead of srcdoc).
- `src/renderer/src/components/Mail/MailReader.tsx` — Lines 48-75 and 179-189 — builds the srcdoc + meta CSP and promotes `data-blocked-*` back to real attributes. The promotion regex itself looks correct against what the sanitizer emits, which is why the failure is almost certainly the inherited-CSP ceiling rather than this code. Line 49's comment claims `img-src data:` covers cid images; it does not.
- `src/main/mail/message-parser.ts` — Lines 111-135 and 215-227 — parseMessage lists attachment `cid` values (line 119) but never inlines them into the HTML body, leaving `src="cid:..."` unresolvable. This is the whole of cause 2. Line 223's regex also captures protocol-relative `//host/...` URLs, which cannot round-trip correctly when promoted back inside a srcdoc document.
- `src/main/mail/message-parser.test.ts` — Lines 138-142 assert the current behaviour (`cid:logo123` preserved as-is, remote URL parked in data-blocked-src) and pass — the suite verifies the sanitizer's contract but never that an image actually paints in the reader, so both defects are invisible to it. Any fix needs a test at the reader/CSP level, not the parser level.
- `src/main/handlers/mail.ts` — Line 471 — the PDF export builds its own `img-src data:` document with the same cid/remote gap, so exported messages are also image-free. Same root cause, worth fixing in the same pass; not the thing the user clicked.

**Reported as** (the user's own words — authoritative)

> The load images inside the mail does not work. Images are not loaded

<details><summary>Main-process errors at the time</summary>

```
2026-08-17T00:08:04.922Z [error] [updater] Error: HttpError: 404 
2026-08-17T00:08:04.925Z [error] [updater] error — HttpError: 404 
2026-08-17T00:08:04.926Z [error] [updater] check failed — HttpError: 404 
2026-08-17T03:42:57.641Z [warn] [browser:page] TypeError: network error (https://static.licdn.com/aero-v1/sc/h/bnmc4331fne8fm9kp3n6mnwn0:9769)
2026-08-17T04:36:16.397Z [warn] [browser:page] TypeError: network error (https://static.licdn.com/aero-v1/sc/h/bnmc4331fne8fm9kp3n6mnwn0:9769)
2026-08-17T04:55:54.206Z [warn] [browser:page] Uncaught (in promise) #<Object> (https://www.linkedin.com/preload/?_bprMode=vanilla:0)
2026-08-17T05:40:26.823Z [warn] [browser:page] Uncaught (in promise) Error: Minified React error #418; visit https://react.dev/errors/418?args[]= for the full message or use the non-minified dev environment for full errors and additional helpful warnings. (https://static.licdn.com/aero-v1/sc/h/assets/kuu7tUnu.js:1)
2026-08-17T06:08:04.854Z [error] [updater] Error: HttpError: 404 
2026-08-17T06:08:04.854Z [error] [updater] error — HttpError: 404 
2026-08-17T06:08:04.855Z [error] [updater] check failed — HttpError: 404 
2026-08-17T06:25:42.824Z [warn] [browser:page] TypeError: network error (https://static.licdn.com/aero-v1/sc/h/bnmc4331fne8fm9kp3n6mnwn0:9769)
2026-08-17T06:27:03.125Z [warn] [browser:page] Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'name') (https://static.licdn.com/aero-v1/sc/h/6xit43scc04ns3vx47p7zv81u:3354)
```

</details>

---
