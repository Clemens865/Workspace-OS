# Plan: native Windows build

Branch `windows-native`, from `linux-wsl-support`. Goal: a Windows x64 installer that runs the app,
the office engine and file access natively on Windows, with agents that keep working against an
existing setup. Status: phase 0 run on GitHub Actions; results below. Calc rendering is the open point.

## What we know (checked 2026-10-23)

| Area | Finding | Consequence |
|---|---|---|
| LibreOfficeKit loader | `LibreOfficeKitInit.h` has a `_WIN32` path: loads `sofficeapp.dll` / `mergedlo.dll`, prepends the program and URE dirs to `PATH` | The sidecar's `lok_init_2` call can stay as is |
| Engine sidecar `wos-lok-host.cpp` | POSIX use is small: one `write()` (frames to fd 3 and fd 4), one `setenv`, one `stat`, `file://` + path URLs, five `/tmp/...` paths | A port, not a rewrite |
| Extra pipes fd 3 / fd 4 | The app reads JSON on fd 3 and tiles on fd 4 (`stdio: [pipe, ignore, inherit, pipe, pipe]`) | libuv passes extra fds to Windows children through the CRT; an MSVC-built child should see them as `_write(3)`. Needs a spike |
| Engine data exchange | 112 hardcoded `/tmp/wos-*.txt` paths: 90 in the StarBasic macros (`lokMacros.ts`), 20 in `handlers/lok.ts`, 5 in the sidecar | One exchange directory, chosen at runtime and templated into the macros |
| Engine bootstrap | macOS and Linux use `fundamentalrc`; Windows LibreOffice uses `fundamental.ini` | `lokPaths()` gets a Windows branch |
| Stock-engine patches | `csv-filteroptions-headless` and `multidoc-parttile-view` are missing from stock Windows LibreOffice too | `csvSilentLoad` auto extends to the Windows stock engine; the multidoc limitation stays documented |
| Native modules | `node-pty` 1.1.0 ships `win32-x64` prebuilds; `better-sqlite3` 12.11.1 needs a build or download for Electron 42 | Build with MSVC, or fetch a prebuild; spike |
| PATH and shims | `launchRun.ts` joins `PATH` with `:`; seven CLI installers write POSIX `sh` shims (`wos-gen`, `wos-metric`, `wos-collection`, `wos-case`, `wos-action`, `wos-mcp-token`, component CLI); the docgen venv assumes `bin/python3` | `path.delimiter`, `.cmd` shims, `Scripts\python.exe` |
| Action bridge | `wos-action` talks to the app over a Unix socket in userData | A Windows named pipe (`\\.\pipe\wos-agent-<user>`), which Node's `net` supports |
| Existing Windows code | `userdata-path.ts`, `handlers/shell.ts` and `terminal/ptyHost.ts` already branch on `win32` | Start from those |

## Decisions (2026-10-23)

1. **Agents run natively** on Windows: Claude Code for Windows, started by the app like on macOS.
   Running agents inside WSL is out of scope for this branch.
2. **Built and tested on GitHub Actions** (`windows-latest`), not on a developer PC. The workflow
   produces the installer as an artifact; a person only installs the runtime dependencies below and
   the built app.
3. **No bundled engine** unless the spikes show the installed LibreOffice cannot work.

## Supported setup

| Item | Supported | Notes |
|---|---|---|
| Windows | Windows 11 x64, Windows 10 22H2 x64 | ARM64 not built in this branch |
| Install commands | `winget`, one block that runs unchanged in Command Prompt and PowerShell | `winget` ships with Windows 11 and current Windows 10 (App Installer) |
| LibreOffice | 24.2 or newer; CI tests the current release (26.8.1.1 on 2026-10-23) | The sidecar is compiled against the 24.2 LibreOfficeKit headers, so it only calls functions every supported version has |
| Claude Code | Native Windows build, `winget install Anthropic.ClaudeCode` | WinGet installs do not auto-update: `winget upgrade Anthropic.ClaudeCode` |
| Git for Windows | Recommended | Needed for agent-run checkpoints and gives Claude Code its Bash tool; without it checkpoints are off and Claude Code uses PowerShell |
| Python 3.13 | Needed for document generation (`wos-gen`) | The app creates its own venv on first use |
| Node.js | Not needed | The `wos-*` CLIs run on the app's own runtime (`ELECTRON_RUN_AS_NODE`) instead of a system `node` |
| Codex | Optional, unchanged | |

README block (to be verified on a clean Windows 11 install before it is published):

```bat
winget install --id TheDocumentFoundation.LibreOffice --exact
winget install --id Anthropic.ClaudeCode --exact
winget install --id Git.Git --exact
winget install --id Python.Python.3.13 --exact
```

Then open a new terminal, run `claude` once to sign in, and run the Workspace OS installer from the
release page.

## Phase 0 results (GitHub Actions, windows-latest, LibreOffice 26.8.1.1)

| Spike | Result | Evidence |
|---|---|---|
| S1 LOK on Windows, Writer | Pass | `.docx` opens; tile renders text on a white page |
| S1 LOK on Windows, Calc load | Fixed | Loading any Calc document (also a blank one) deadlocked. Thread dump: the LOK thread holds the SolarMutex in `lo_documentLoadWithOptions` and calls `SetWindowPos` while creating the formula bar's Name Box (`ScInputWindow` → `ScPosWnd`); the window belongs to the "VCL Main" thread, which waits for the SolarMutex in `CoWaitForMultipleHandles` and does not process the sent message. The wait changed on 2025-01-10 ("Try to use CoWaitForMultipleHandles magic to handle COM message loop"): 24.8 and 25.2 use `MsgWaitForMultipleObjects(QS_SENDMESSAGE)`, 25.8 and later `CoWaitForMultipleHandles`. The host now hides the formula bar (child window 26100) in its private profile on Windows; xlsx and csv then load. |
| S1 LOK on Windows, Calc render | **Open** | Tiles come back opaque black (alpha 255, RGB 0) at every scale, after `setPart`, and after `setClientVisibleArea` + `setClientZoom`. Not the renderer (Skia default, `SAL_DISABLESKIA=1`, `SAL_SKIA=raster`) and not the colour configuration (light appearance, explicit scheme colours). The runner reports no high-contrast mode. Linux renders the same file. |
| S2 fd 3/4 pipes | Pass | JSON and tile frames arrive from the MSVC-built host |
| S3 native modules | Pass | `better-sqlite3` and `node-pty` load in Electron 42.4.1 |
| S4 installer | Pass | `electron-builder --win` builds `Workspace OS Setup 0.2.26.exe` |
| Unit tests on Windows | Baseline | 257 of 274 files pass; the 17 failing files are POSIX assumptions (sockets, pty, paths) and the new host-profile tests' POSIX example paths |

## Phases

### 0. Spikes (de-risk before porting)

| Spike | Pass when | If it fails |
|---|---|---|
| S1 LOK on Windows | A minimal MSVC build of the sidecar opens a `.docx` with stock LibreOffice and renders a non-blank tile | Try the current LibreOffice release; if the stock build lacks working LOK on Windows, stop and decide on bundling a Collabora or self-built engine |
| S2 fd 3/4 pipes | Node `spawn` with `[pipe, ignore, inherit, pipe, pipe]` receives frames written by the MSVC child with `_write(3)` / `_write(4)` in binary mode | Switch the sidecar protocol to two named pipes passed as arguments |
| S3 native modules | `better-sqlite3` and `node-pty` load in Electron 42 on Windows | Use VS 2022 Build Tools, or `prebuild-install` for the Electron ABI |
| S4 installer | `electron-builder --win nsis` produces an installer in CI that starts the app | Fix packaging config before porting further |

### 1. Engine port

- Sidecar: `_write` with `_setmode(_O_BINARY)` on fds 3 and 4, `_putenv_s`, `_stat64`, `file:///C:/…`
  URLs with forward slashes, profile and exchange paths from arguments instead of `/tmp`.
- `scripts/lok/build-host.cmd` (MSVC `cl /std:c++17 /EHsc /O2`), headers fetched for the installed
  version as on Linux.
- `lokPaths()` Windows branch: install dir, `fundamental.ini`, `wos-lok-host.exe`; `lokAvailable()`
  checks `mergedlo.dll` or `sofficeapp.dll`.
- Exchange directory: one runtime path (`os.tmpdir()/wos-lok`), substituted into the macro text when
  the macros are seeded and used by `handlers/lok.ts` and the sidecar, replacing all 112 `/tmp` paths.
  Linux and macOS get the same mechanism with `/tmp`, so behaviour there is unchanged.
- `csvSilentLoad` auto: on for the stock Windows engine.

### 2. Platform plumbing

- `PATH` via `path.delimiter`; `.cmd` shims beside the POSIX ones for the seven CLIs; docgen venv
  `Scripts\python.exe`, discovery through `py -3` and `python`.
- Action bridge on a named pipe; `WOS_AGENT_SOCK` carries the pipe name.
- Binary resolution for `claude` and `codex` on Windows (`.exe`, npm `.cmd`), keeping the prompt on
  stdin.
- Terminal dock: PowerShell by default, `wsl.exe` as an option; ConPTY through `node-pty`.
- Checkpoints need Git for Windows; without it they are off with a clear message.
- Audit path handling for drive letters, backslashes and case-insensitive comparisons
  (`ipc-validator`, workspace root checks, content root, artifact paths).

### 3. Agents inside WSL

Out of scope (decision 1).

### 4. Packaging and CI

- `build.win`: NSIS x64, `extraResources` with `wos-lok-host.exe` and the CLI resources, no signing
  (SmartScreen warns on first run), updater off for fork builds.
- Workflow `windows.yml`: install, typecheck, unit tests, build the sidecar, package, upload the
  installer.

### 5. Tests and docs

- Unit tests on the Windows runner; new tests for path translation, shims and the exchange directory.
- `e2e/lok-packaged-windows.mjs`: packaged app renders `.docx`, `.xlsx`, `.csv`.
- Manual on a Windows 11 machine: open a workspace on a local drive, run an agent, edit office
  files, and run an agent edit with `agentHooks: "project"`.
- `docs/WINDOWS.md`: install, settings, limitations.

## Effort and risk

| Phase | Estimate |
|---|---|
| 0 Spikes | 0.5–1 day |
| 1 Engine port | 1–2 days |
| 2 Platform plumbing | 2–3 days |
| 4 Packaging and CI | 0.5–1 day |
| 5 Tests and docs | 1–2 days |

Largest risk: S1. The loader supports Windows, but whether the stock LibreOffice Windows build
exposes and renders everything the sidecar calls has not been tested. Second risk: the fd 3/4 pipe
inheritance (S2), which has a known fallback.

## Owner actions needed

- Actions enabled on the fork (public repository minutes are free).
- For the final manual test: the four `winget` installs above and the built installer.
