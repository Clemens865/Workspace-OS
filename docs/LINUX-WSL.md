# Linux and WSL

Workspace OS builds and runs on Linux (x64) against the distribution's own LibreOffice. Under WSL
(Ubuntu on Windows, shown through WSLg) a few extra workarounds apply. They are decided by
`src/main/host-profile.ts` and switch on only where they are needed: on native Linux, macOS and
Windows the app behaves as before.

## Build

```sh
sudo apt install libreoffice            # the engine; LibreOfficeKit ships with every stock build
npm ci --legacy-peer-deps               # @vitejs/plugin-react 4 has a vite 8 peer conflict
LOK_HEADER_REF=libreoffice-$(soffice --version | awk '{print $2}') bash scripts/lok/fetch-headers.sh
bash scripts/lok/build-host.sh          # g++ build of wos-lok-host against those headers
npm run dist:linux                      # release/linux-unpacked/ and an AppImage
```

The LibreOfficeKit headers must match the installed engine's version, because the LOK function
table only grows. Nothing is bundled: the app loads `/usr/lib/libreoffice/program/`. Set
`WOS_LOK_INSTALL`, `WOS_LOK_FUND` and `WOS_LOK_HOST` to use another engine build.

Run `release/linux-unpacked/workspace-os`. The AppImage needs `libfuse2`; without it, run it with
`--appimage-extract-and-run`.

## Host settings

Each setting resolves in this order: environment variable, then `<userData>/host-settings.json`
(`~/.config/workspace-os/host-settings.json`, or `$WOS_USERDATA_DIR`), then `auto`. A missing or
unreadable file means every setting is `auto`.

| Setting | Variable | Auto value | Why |
|---|---|---|---|
| `gpu`: `auto`, `on`, `off` | `WOS_GPU=1/0` | off under WSL, on elsewhere | WSLg shows a black window under GPU compositing |
| `csvSilentLoad`: `auto`, `on`, `off` | `WOS_CSV_SILENT_LOAD=1/0` | on when the engine is the stock `/usr/lib/libreoffice/program/` | see "CSV" below |
| `windowsDriveState`: `auto`, `external`, `in-folder` | `WOS_WINDOWS_DRIVE_STATE` | `external` | see "Windows-drive folders" |
| `windowsDriveCheckpoints`: `true`, `false` | `WOS_WINDOWS_DRIVE_CHECKPOINTS=1/0` | `false` | see "Windows-drive folders" |
| `windowsDriveArtifactDepth`: integer, `-1` = no scan | `WOS_WINDOWS_DRIVE_ARTIFACT_DEPTH` | `1` (elsewhere the scan depth is 4) | see "Windows-drive folders" |
| `windowsDriveWatch`: `true`, `false` | `WOS_WINDOWS_DRIVE_WATCH=1/0` | `false` | see "Windows-drive folders" |

The four `windowsDrive*` settings apply only to a workspace on a Windows drive under WSL
(`/mnt/c`, `/mnt/d`, …). Folders on the Linux disk, and every folder on native Linux, keep the
normal behaviour whatever the file says.

Example:

```json
{ "windowsDriveCheckpoints": false, "windowsDriveArtifactDepth": 2 }
```

### CSV

The stock engine lacks `scripts/lok/csv-filteroptions-headless.patch`: a headless CSV load raises
the import dialog request and deadlocks. With `csvSilentLoad` on, CSV files are opened with LOK's
`Batch=true` load option, which loads silently and is stripped before the filter options reach the
import filter. Side effect: Batch puts the engine into its silent dialog mode for the rest of the
engine process. With a patched engine build, `auto` leaves it off.

### Windows-drive folders (WSL)

WSL reaches Windows drives over 9P, which is slow and does not support the shared memory SQLite's
WAL mode needs. Measured on a 76,000-file folder on `/mnt/d`:

- the workspace memory database in `<folder>/.workspace-os/` blocked the main process in
  `p9_client_rpc`; on Linux that process also paints the window, so the app froze;
- listing the folder took 26 s, and the per-run artifact scan at depth 4 took 33 s on the main
  process, twice per agent run;
- a shadow-git snapshot of the whole folder before each run would take minutes;
- watching the folder froze the app: on Linux, Node's recursive `fs.watch` first walks the whole
  tree synchronously on the main thread, `node_modules` included (the ignore list is applied only to
  events), and inotify on a Windows drive never reports changes made from Windows anyway.

So, for such a folder:

- **`windowsDriveState: external`** keeps the `.workspace-os` store (memory database, trash,
  snapshots, chat sessions and uploads, wiki state, PDF annotations, `agent-context.json`, the
  captured browser page) in `<userData>/workspaces/<name>-<hash>/` on the Linux disk. Agent runs get
  that directory through `--add-dir` and `WOS_STATE_DIR`. Nothing is written to the folder itself
  unless you use a feature that creates content there (below).
- **`windowsDriveCheckpoints: false`** skips the snapshot before agent runs. Run cards then have no
  revert, and the Checkpoints list is empty.
- **`windowsDriveArtifactDepth: 1`** limits the scan for files an agent run created to the top two
  levels, so deeper files do not show as cards.
- **`windowsDriveWatch: false`** does not watch the folder. The file tree and the search index
  reflect the folder as it was when it was opened; reopen it to pick up changes.

Still true for such a folder:

- Content features create their folders at the workspace root when used, unless a content root is
  set (below). Sub-projects get `.workspace-os/project.json` in their own folder.
- The file tree and search walk the folder over 9P and are slower than on the Linux disk.

## Content root (every platform)

The app creates its own content folders when you use the matching feature: `Cases/` and `Work/`
(cases), `Wiki/` (wiki ingest), `Apps/` (app builder) and `Artifacts/` (chat artifacts). By default
they sit at the workspace root. To put them under a subfolder instead, set `contentRoot` for that
workspace in `host-settings.json`, keyed by the folder's absolute path:

```json
{
  "workspaces": {
    "/mnt/d/Notes/vault": { "contentRoot": "50-PROJECTS/workspace-os" }
  }
}
```

The value must be a relative folder without `..` or dot-folders; anything else is ignored with a
warning and the root is used. With a content root set:

- cases, work folders, wiki pages and apps are read and written under it, and the `wos-case` CLI
  finds them through `WOS_CONTENT_DIR`, which agent runs and terminals receive;
- agent and chat instructions get one extra sentence naming the folder, and the app builder's edit
  permission and prompts point at `<contentRoot>/Apps/<slug>/`;
- case artifacts and every other path stay relative to the workspace root.

Unlike the `windowsDrive*` settings, `contentRoot` applies on every platform, but only to the
workspaces it names; with no entry nothing changes.

## Agent hooks (every platform)

The app's agent and chat runs pass `disableAllHooks`, so Claude Code hooks (personal ones in
`~/.claude/settings.json`, and the workspace's own in `.claude/settings.json`) do not run there. The
reason is in `src/main/agent/launchRun.ts`: personal hooks such as a Stop hook that prints would
pollute the run output. Terminal-dock agent tabs keep hooks on.

A workspace can opt in with `agentHooks` in its `host-settings.json` entry (or `WOS_AGENT_HOOKS`):

| Value | Effect |
|---|---|
| `off` (default) | No hooks, as before |
| `project` | Only the workspace's hooks (`.claude/settings.json`, `settings.local.json`). Runs load project and local settings only (`--setting-sources project,local`), so `~/.claude/settings.json`, `~/.claude/CLAUDE.md` and personal skills and agents are not loaded; the user's MCP servers are re-added with `--mcp-config ~/.claude.json` (read in place, nothing copied) |
| `all` | User and workspace hooks, every Stop and prompt hook included |

```json
{ "workspaces": { "/mnt/d/Notes/vault": { "contentRoot": "50-PROJECTS/workspace-os", "agentHooks": "project" } } }
```

With `project` or `all`, the folder must be trusted in Claude Code: run `claude` in it once and accept
the trust prompt. Until then Claude ignores the folder's `permissions.allow`, so a run is refused the
tools the vault allows (an MCP skills server, for example) and says so in its answer. Agent runs are
non-interactive, so an MCP server's tools need an allow entry in the folder's `.claude/settings.json`
(`"permissions": { "allow": ["mcp__skills"] }`); servers without one stay unusable in the run.

The app builder and the internal one-shot jobs (Agent Foundry, app briefs and tests, mail helpers)
always run without hooks. When an app connector is enabled, the run uses a strict MCP config and the
user's servers are not re-added.

## Other notes

- **Window.** The app opens maximised with the system title bar (macOS opens full screen); F11
  toggles full screen, and Alt shows the menu bar.
- **Display scaling under WSLg.** WSLg already scales X11 windows to the Windows display setting. A
  `GDK_SCALE=2` exported in the shell doubles it again; start the app with `GDK_SCALE=1`.
- **Not in the stock engine:** `multidoc-parttile-view.patch`, so with several presentations open a
  slide tile can come back blank.
- **WebGL** is unavailable with the GPU off: the splash falls back to a static logo and 3D views
  do not draw.
- **Secrets** need a running Secret Service (GNOME Keyring or KWallet); without one the app
  refuses to store them.
- `e2e/lok-packaged-linux.mjs` checks the packaged app renders `.docx`, `.xlsx` and `.csv` from the
  system engine.
