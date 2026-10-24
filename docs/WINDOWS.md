# Windows

Workspace OS runs natively on Windows 11 and Windows 10 22H2 (x64). It uses the LibreOffice you
install, the native Windows build of Claude Code, and its own runtime for the `wos-*` command-line
tools, so Node.js is not needed. The build plan and the investigation behind it are in
[WINDOWS-NATIVE-PLAN.md](WINDOWS-NATIVE-PLAN.md).

## What works

| Area | State |
|---|---|
| Word documents (`.docx`) | Open and render through the installed LibreOffice (checked in CI); editing not yet checked on Windows |
| Presentations (`.pptx`) | Open and render (checked in CI); editing not yet checked on Windows |
| Spreadsheets (`.xlsx`, `.csv`) | Open, but tiles render black on LibreOffice 25.8 and later; see [Spreadsheets](#spreadsheets) |
| Agents | Claude Code runs on your subscription; Codex is optional |
| `wos-*` tools | Installed in `%APPDATA%\workspace-os\bin` as `.cmd` files, plus a Git Bash variant |
| Document generation (`wos-gen`) | The app builds its own Python environment on first start |
| Checkpoints | Need Git for Windows |

## Install

Open Command Prompt or PowerShell and paste these lines. They run unchanged in both.

<!-- install-block:start -->
```bat
winget install --id TheDocumentFoundation.LibreOffice --exact --accept-package-agreements --accept-source-agreements
winget install --id Anthropic.ClaudeCode --exact --accept-package-agreements --accept-source-agreements
winget install --id Git.Git --exact --accept-package-agreements --accept-source-agreements
winget install --id Python.Python.3.13 --exact --accept-package-agreements --accept-source-agreements
```
<!-- install-block:end -->

`winget` ships with Windows 11 and with current Windows 10 (App Installer from the Microsoft Store).
Each line reports "already installed" when the program is present; that is fine. LibreOffice asks
for administrator approval once.

Then:

1. Open a **new** terminal, so it sees the updated PATH.
2. Run `claude` once and sign in.
3. Install Workspace OS. Until a release is published, the installer is a build artifact: open the
   [Windows build workflow](https://github.com/cbruyndoncx/Workspace-OS/actions/workflows/windows.yml)
   (signed in to GitHub), choose the latest green run, download `workspace-os-windows`, unzip it and
   run `Workspace OS Setup <version>.exe`. It installs for the current user, without administrator
   rights, into `%LOCALAPPDATA%\Programs\workspace-os`.
4. The installer is not code-signed, so SmartScreen shows "Windows protected your PC". Choose
   **More info**, then **Run anyway**.

On first launch, choose a folder. That folder is the workspace, as on macOS. App-wide state lives in
`%APPDATA%\workspace-os`.

CI runs this block line by line on a clean Windows runner, installs the app with the installer and
checks that it renders a `.docx` and a `.pptx`, finds Claude Code and builds its Python environment
(`install-docs` job in `.github/workflows/windows.yml`).

### What each program is for

| Program | Needed for | Without it |
|---|---|---|
| LibreOffice | Every office document | Documents do not open |
| Claude Code | Agents | Agents do not start |
| Git for Windows | Checkpoints of agent runs; gives Claude Code its Bash tool | Checkpoints are off; Claude Code uses PowerShell |
| Python 3.13 | Document generation (`wos-gen`) and Python skills | `wos-gen` stops with "Python 3 is required for document generation but was not found" |

Updates: `winget upgrade --all`. The winget build of Claude Code does not update itself, so run
`winget upgrade Anthropic.ClaudeCode` from time to time.

## Spreadsheets

LibreOffice 25.8 and later have two regressions on Windows that affect LibreOfficeKit, the
interface the app uses:

| Issue | Effect | State |
|---|---|---|
| [tdf#174142](https://bugs.documentfoundation.org/show_bug.cgi?id=174142), [#1](https://github.com/cbruyndoncx/Workspace-OS/issues/1) | Opening a spreadsheet or presentation hangs | Worked around in the app: the engine host restores the 25.2 wait on the LibreOffice UI thread |
| [tdf#174143](https://bugs.documentfoundation.org/show_bug.cgi?id=174143), [#2](https://github.com/cbruyndoncx/Workspace-OS/issues/2) | Spreadsheet tiles render black | Needs a LibreOffice fix; no workaround in the app |

Spreadsheets render on LibreOffice 25.2. That series reached end of life on 2025-11-30 and gets no
security fixes, so use it only if you need spreadsheets now and accept that:

```bat
winget uninstall --id TheDocumentFoundation.LibreOffice --exact
winget install --id TheDocumentFoundation.LibreOffice --exact --version 25.2.5.2 --accept-package-agreements --accept-source-agreements
```

Go back to the current release with `winget upgrade --id TheDocumentFoundation.LibreOffice --exact`
once tdf#174143 is fixed.

## Settings

The host settings file and the per-workspace content root work as on Linux; see
[LINUX-WSL.md](LINUX-WSL.md). On Windows the file is `%APPDATA%\workspace-os\host-settings.json`,
and workspace keys match regardless of letter case and trailing separator.

Environment variables for unusual setups:

| Variable | Effect |
|---|---|
| `WOS_LOK_INSTALL` | LibreOffice `program` folder (default `%ProgramFiles%\LibreOffice\program\`) |
| `WOS_LOK_FUND` | Its `fundamental.ini` |
| `WOS_LOK_HOST` | Another `wos-lok-host.exe` |
| `WOS_LOK_WAIT_FIX=0` | Turns off the tdf#174142 workaround |
| `WOS_LOK_KEEP_FORMULA_BAR=1` | Keeps Calc's formula bar in the engine profile (hidden by default on Windows) |
| `CLAUDE_BIN`, `CODEX_BIN` | Path to `claude.exe` or `codex.exe` when they are not in the usual places |
| `WOS_USERDATA_DIR` | Another app data folder |

The app looks for `claude.exe` in `%USERPROFILE%\.local\bin`, the per-user and machine-wide WinGet
links folders, on PATH, then in the WinGet package folders. Without Developer Mode, WinGet cannot
create the link and puts the package folder on the user PATH instead, which a program that was
already running does not see; the last step covers that.

## Build from source

Needs Visual Studio 2022 Build Tools (C++ workload), Node.js 22, Git for Windows and LibreOffice.
From a "x64 Native Tools Command Prompt for VS 2022":

```bat
npm ci --legacy-peer-deps
"%ProgramFiles%\Git\bin\bash.exe" -c "LOK_HEADER_REF=libreoffice-24.2.7.2 bash scripts/lok/fetch-headers.sh"
scripts\lok\build-host.cmd
npx electron-rebuild -f -w better-sqlite3,node-pty
npm run build
node scripts/patch-nsis-per-user.mjs
npx electron-builder --win --publish never
```

The installer lands in `release\`, the unpacked app in `release\win-unpacked\`. `patch-nsis-per-user.mjs` fixes an
electron-builder 25 installer crash on first install (electron-builder #10296, fixed upstream in 26.12). The sidecar is built
against the 24.2 LibreOfficeKit headers, the oldest supported engine, so it runs on every newer one.
`node e2e\lok-packaged-windows.mjs <fixtures-folder>` checks the unpacked app.

To check the engine alone on a PC, download `engine-test-kit` from the same workflow run and run
`run-engine-test.cmd`. It installs nothing.
