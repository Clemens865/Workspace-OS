# Plan: native Windows build

Branch `windows-native`, from `linux-wsl-support`. Goal: a Windows x64 installer that runs the app,
the office engine and file access natively on Windows, with agents that keep working against an
existing setup. Status: phase 0 run on GitHub Actions; results below. Calc is blocked by two LibreOffice 25.8+ regressions, tracked in [#1](https://github.com/cbruyndoncx/Workspace-OS/issues/1) / [tdf#174142](https://bugs.documentfoundation.org/show_bug.cgi?id=174142) and [#2](https://github.com/cbruyndoncx/Workspace-OS/issues/2) / [tdf#174143](https://bugs.documentfoundation.org/show_bug.cgi?id=174143).

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
| LibreOffice | 24.2 or newer for Writer and Impress. Calc on Windows renders only up to 25.2 (end of life 2025-11-30) until LibreOffice fixes tdf#174142 and tdf#174143 (#1, #2) | The sidecar is compiled against the 24.2 LibreOfficeKit headers, so it only calls functions every supported version has. CI tests the current release (26.8.1.1) |
| Claude Code | Native Windows build, `winget install Anthropic.ClaudeCode` | WinGet installs do not auto-update: `winget upgrade Anthropic.ClaudeCode` |
| Git for Windows | Recommended | Needed for agent-run checkpoints and gives Claude Code its Bash tool; without it checkpoints are off and Claude Code uses PowerShell |
| Python 3.13 | Needed for document generation (`wos-gen`) | The app creates its own venv on first use |
| Node.js | Not needed | The `wos-*` CLIs run on the app's own runtime (`ELECTRON_RUN_AS_NODE`) instead of a system `node` |
| Codex | Optional, unchanged | |

The install block is in [WINDOWS.md](WINDOWS.md) and the README (CI checks the two are identical).
The `install-docs` CI job runs it line by line on a clean runner, installs the app with the NSIS
installer and runs the e2e against the installed app.

## Phase 0 results (GitHub Actions, windows-latest, LibreOffice 26.8.1.1)

| Spike | Result | Evidence |
|---|---|---|
| S1 LOK on Windows, Writer | Pass | `.docx` opens; tile renders text on a white page |
| S1 LOK on Windows, Calc load | Fixed | Loading any Calc document (also a blank one) deadlocked. Thread dump: the LOK thread holds the SolarMutex in `lo_documentLoadWithOptions` and calls `SetWindowPos` while creating the formula bar's Name Box (`ScInputWindow` → `ScPosWnd`); the window belongs to the "VCL Main" thread, which waits for the SolarMutex in `CoWaitForMultipleHandles` and does not process the sent message. The wait changed on 2025-01-10 ("Try to use CoWaitForMultipleHandles magic to handle COM message loop"): 24.8 and 25.2 use `MsgWaitForMultipleObjects(QS_SENDMESSAGE)`, 25.8 and later `CoWaitForMultipleHandles`. The host now hides the formula bar (child window 26100) in its private profile on Windows; xlsx and csv then load. |
| S1 LOK on Windows, Calc render | **Open** | Tiles come back opaque black (alpha 255, RGB 0) at every scale, after `setPart`, and after `setClientVisibleArea` + `setClientZoom`. Not the renderer (Skia default, `SAL_DISABLESKIA=1`, `SAL_SKIA=raster`) and not the colour configuration (light appearance, explicit scheme colours). The runner reports no high-contrast mode. Linux renders the same file. |
| S1 version matrix | Both regressions start in 25.8 | Clean installs on GitHub runners, same .xlsx. 25.2.7.2: renders with the formula bar shown or hidden. 25.8.7.3, 26.2.7.1, 26.8.1.1: deadlock with the formula bar shown, black tiles with it hidden. 25.2 is end of life (2025-11-30), so it is not a supported target. Reports for LibreOffice drafted, not filed. |
| Deadlock root cause | Confirmed | LOK starts "VCL Main" (`lo_startmain`) with `osl_createThread`, whose wrapper puts it in the MTA; `SalData`'s STA request fails, so the 25.8+ `CoWaitForMultipleHandles` wait does not pump the sent `SetWindowPos`. Switching that thread to STA (an experiment, 254f46e) removed the Calc deadlock on 25.8.7.3 and 26.8.1.1. Impress deadlocks the same way (`sd::ViewShellBase::UpdateBorder` → `SetWindowPos`). The host now redirects `vclplug_winlo.dll`'s import of `osl_waitCondition` to the 25.2 wait (`MsgWaitForMultipleObjects` with `QS_SENDMESSAGE`), on by default on Windows (`WOS_LOK_WAIT_FIX=0` turns it off). |
| Black tiles root cause | Bibisected | win64-25.8 bibisect, 13 steps: first bad source commit 2507d08388dd "split the SetSizeUsingBuffer code paths" (2025-01-16). The base `SalVirtualDevice::SetSizeUsingBuffer` no longer falls back to `SetSize` (asserts and returns false), and `WinSalVirtualDevice` does not override it. Needs a LibreOffice fix; no host-side workaround. |
| S2 fd 3/4 pipes | Pass | JSON and tile frames arrive from the MSVC-built host |
| S3 native modules | Pass | `better-sqlite3` and `node-pty` load in Electron 42.4.1 |
| S4 installer | Pass | `electron-builder --win` builds `Workspace OS Setup 0.2.26.exe` |
| Unit tests on Windows | Pass, gating | Started at 17 failing files of 274 (POSIX sockets, mode bits, pty helpers, paths). Fixed in the code where it was a real bug (named pipe released before restart, case-insensitive workspace keys, `/` in agent guidance), skipped where the check is POSIX-only. The recall eval is excluded in CI: it needs a downloaded embedding model and fails on Linux the same way |

## Manual test on a Windows 11 PC (2026-10-24)

The install from [WINDOWS.md](WINDOWS.md) on the owner's PC (Developer Mode off, LibreOffice 26.8.1.1
already installed), then the installer built by CI.

| Step | Result | Fix |
|---|---|---|
| winget block | LibreOffice up to date, Claude Code installed, Git upgraded; the Python upgrade was cancelled at the prompt (3.13.1 kept) | None needed |
| Claude Code found | WinGet could not create the `Links` symlink without Developer Mode and put the package folder on the user PATH instead | `findTool` also looks in the WinGet package folders (b063b2a) |
| Open a workspace | A LibreOffice dialog, "bootstrap.ini is corrupt", and a console window for the engine host | `convertTo` passed `file://C:\...` as the profile URL; now a real file URL. Console programs started with `windowsHide` (f8cd317) |
| Agent document generation | Ran the Git Bash `wos-gen` shim instead of `wos-gen.cmd` | Runs `wos-gen.cmd` through `cmd.exe` (f8cd317) |
| `.docx`, `.pptx` | Render | |
| `.xlsx`, `.csv` on 26.8.1.1 | Black tiles (tdf#174143) | None in the app |
| `.xlsx`, `.csv` on 25.2.7.2 | Render, with an unpacked second copy next to 26.8 used only by Workspace OS (`WOS_LOK_INSTALL`) | Documented in WINDOWS.md; trailing separator added when missing (54f517c) |
| Agent run from the app | Works: Claude Code (WinGet build) answers from the agent panel | |
| Vault on `D:` as workspace, open a note, back to the folder | "Path escapes workspace root": the renderer split paths on `/` only and cut a character off a path such as `D:\Notes\my-vault` | Separator-agnostic renderer path helpers (`lib/paths.ts`) everywhere paths are split, joined or compared (e7604db); confirmed fixed on the PC |

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
| 0 Spikes | done |
| 1 Engine port | 1–2 days |
| 2 Platform plumbing | 2–3 days |
| 4 Packaging and CI | 0.5–1 day |
| 5 Tests and docs | 1–2 days |

Phase 0 is done. S1 resolved into two LibreOffice regressions with known causes (#1, #2): Writer
works on every supported version, Calc needs a LibreOffice fix. Phases 1 and 2 go ahead for
everything except Calc; Calc is checked against LibreOffice 25.2 in CI so the rest of the Calc path
stays tested. Remaining risk: how much of the app assumes POSIX beyond the places listed above (the
Windows unit-test baseline has 17 failing files to work through).

## Owner actions needed

- Actions enabled on the fork (public repository minutes are free).
