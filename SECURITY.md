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
| 5 | Handle session permission requests | ✅ | Deny-by-default `setPermissionRequestHandler` (`security.ts`) |
| 6 | Do not disable `webSecurity` | ✅ | `webSecurity: true` |
| 7 | Define a Content-Security-Policy | ✅ | Enforced via response headers (`applySessionSecurity`), not a strippable meta tag |
| 8 | Do not set `allowRunningInsecureContent` | ✅ | `allowRunningInsecureContent: false` |
| 9 | Do not enable experimental features | ✅ | `experimentalFeatures: false` |
| 10 | Do not use `enableBlinkFeatures` | ✅ | Not set |
| 11 | Do not use `<webview>` with untrusted content | ✅ | `webviewTag: false`; `will-attach-webview` denied |
| 12 | Verify/limit navigation | ✅ | `will-navigate` blocks off-app navigation; opens http(s) externally |
| 13 | Disable or limit new window creation | ✅ | `setWindowOpenHandler` denies all; http(s) opened in system browser |
| 14 | Validate the sender of IPC messages | ✅ | Subframes get no preload bridge; process-spawn channels additionally `assertMainFrame` |

## App-specific controls

- **Workspace-root boundary.** The main process owns the active root. Every
  file-system IPC validates the requested path against it (lexical + symlink
  `realpath` resolution), so a renderer compromise cannot read/write outside the
  user-selected folder. Tested in `ipc-validator.test.ts`.
- **IPC input validation.** All 36 handlers take `unknown` params and validate
  before use; ids are regex-checked, strings length-capped.
- **Process-spawn safety.** The `claude` CLI and OnlyOffice Docker container are
  spawned with **array args, never through a shell** — terminal/document input
  cannot inject shell commands.
- **OnlyOffice isolation.** The Document Server binds to `127.0.0.1` only (never
  `0.0.0.0`), reachable only on-device. The file bridge issues single-use opaque
  per-document tokens, so the server can only fetch/save the exact file bound to
  each token.
- **Recovery layers.** Destructive IPC ops snapshot to `.workspace-os/trash`;
  every agent run is preceded by a shadow-git checkpoint with one-click revert.
- **Local-only data.** Search index, trash, and checkpoints all live on-device.
  No telemetry, no cloud calls except to the localhost OnlyOffice server.

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

- Production OnlyOffice delivery (Docker is dev-only) — see PRD §11.
- End-to-end runtime verification with a live `claude` invocation and a packaged
  build is still pending.
