# Workspace OS — Security Posture

This document records how Workspace OS satisfies the
[Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
and the app-specific controls layered on top.

## Electron security checklist

| # | Recommendation | Status | Where |
|---|---|---|---|
| 1 | Only load secure content | ✅ | App loads `file://` (prod) / localhost dev server; no remote app content |
| 2 | Disable `nodeIntegration` in renderers | ✅ | `webPreferences.nodeIntegration: false` (`index.ts`) |
| 3 | Enable `contextIsolation` | ✅ | `contextIsolation: true` |
| 4 | Enable process sandboxing | ✅ | `sandbox: true` |
| 5 | Handle session permission requests | ✅ | `setPermissionRequestHandler` on both sessions denies everything except fullscreen (`security.ts`) |
| 6 | Do not disable `webSecurity` | ✅ | `webSecurity: true` |
| 7 | Define a Content-Security-Policy | ◐ | Enforced via response headers (`applySessionSecurity`); it still allows localhost origins, see follow-ups |
| 8 | Do not set `allowRunningInsecureContent` | ✅ | `allowRunningInsecureContent: false` |
| 9 | Do not enable experimental features | ✅ | `experimentalFeatures: false` |
| 10 | Do not use `enableBlinkFeatures` | ✅ | Not set |
| 11 | Do not use `<webview>` with untrusted content | ◐ | The in-app Browser uses `<webview>` (`webviewTag: true`). Each guest is hardened in `will-attach-webview`: no preload, no Node, context isolation, sandbox, http(s) only, own session partition |
| 12 | Verify/limit navigation | ✅ | `will-navigate` keeps the app frame on the app; off-app http(s) links open outside it |
| 13 | Disable or limit new window creation | ✅ | App popups are denied and opened as in-app browser tabs. A browser guest may open a hardened sign-in popup (`window.open`), which OAuth flows need |
| 14 | Validate the sender of IPC messages | ✅ | Subframes get no preload bridge; process-spawn channels additionally `assertMainFrame` |

## App-specific controls

- **Workspace-root boundary.** The main process owns the active root. Every
  file-system IPC validates the requested path against it (lexical + symlink
  `realpath` resolution), so a renderer compromise cannot read/write outside the
  user-selected folder. Tested in `ipc-validator.test.ts`.
- **IPC input validation.** Handlers receive `unknown` arguments and validate them
  before use; ids are regex-checked, strings length-capped.
- **Process-spawn safety.** Agents and the office engine are spawned with **array
  args, never through a shell**. The one exception is Windows `.cmd` shims, which
  go through `cmd.exe` with arguments that are quoted and refused when they cannot
  be passed safely (`platform-tools.ts`).
- **Recovery layers.** Destructive IPC ops snapshot to `.workspace-os/trash`;
  every agent run is preceded by a shadow-git checkpoint with one-click revert.
- **Local-only data.** Search index, trash, and checkpoints all live on-device.
  No telemetry. Network traffic is what the user connects: mail, calendars,
  the in-app browser, connectors, model downloads and the agent CLIs.

## Dependency posture

- Production `npm audit`: no high/critical advisories. (SheetJS/`xlsx`, which
  carried an unpatched prototype-pollution advisory on untrusted parsing, was
  replaced with `exceljs`.)
- Remaining moderate advisories are transitive and off the untrusted-input path.

## Native modules

`better-sqlite3` and `node-pty` are native. They are built for Node by default
(so the test suite runs), and rebuilt for Electron's ABI:
- **Dev:** `npm run rebuild:electron` before `npm run dev` (and
  `npm run rebuild:node` to return to a test-runnable state).
- **Packaging:** `electron-builder` rebuilds them automatically (`npmRebuild`),
  and they are `asarUnpack`-ed so the `.node` binaries load from disk.

## Known follow-ups

- The CSP and its exemption for `localhost` / `127.0.0.1` were written for the
  removed OnlyOffice document server (`csp` and `applySessionSecurity` in
  `security.ts`). Tightening them needs a run of the packaged app to confirm that
  nothing else depends on them.
- End-to-end runtime verification with a live `claude` invocation and a packaged
  build is still pending.
