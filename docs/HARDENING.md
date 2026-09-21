# Hardening & Release Checklist — Workspace OS

Covers the pre-beta hardening loop from `docs/IWE-GAP-ANALYSIS.md §6`:
auto-update, macOS signing/notarization, and local-first crash reporting.

Status legend: ✅ verified in this repo · ⏳ pending (needs the Apple Developer
certificate — a one-time manual step) · 🔒 privacy note.

---

## 1. What ships in the box (verified ✅)

| Piece | Where | State |
|---|---|---|
| Auto-update wiring (electron-updater 6) | `src/main/updater.ts` | ✅ wired; no-op in dev/unsigned |
| "Check for Updates…" menu item | `src/main/menu.ts` (app menu) | ✅ |
| "Update ready — Restart" banner | `src/renderer/src/components/Update/UpdateBanner.tsx` | ✅ |
| Local crash reporter + minidumps | `src/main/crash-reporter.ts` | ✅ 🔒 no upload |
| Rotating main-process log + crash handlers | `src/main/crash-reporter.ts` | ✅ |
| macOS hardened-runtime config | `package.json` → `build.mac` | ✅ parses |
| Entitlements plist | `build/entitlements.mac.plist` | ✅ |
| GitHub publish config (update feed) | `package.json` → `build.publish` | ✅ |
| Signed + notarized DMG | — | ⏳ needs cert (see §4) |

Verification run in this loop:

```bash
npm run typecheck   # ✅ clean
npm run build       # ✅ clean
npm test            # ✅ 98 passed
npx electron-builder --dir --publish never   # ✅ config loads; "skipped macOS
                                             #    code signing (identity null)"
```

The unsigned local dev flow is unchanged: `identity: null` stays in the mac
config, so `npm run dist:mac` still produces a runnable (unsigned) `.app`/DMG
with no certificate. Hardened runtime + entitlements are only exercised once a
signing identity is present.

---

## 2. Auto-update behaviour

- **Guarded**: `initUpdater` is a hard no-op in dev, when `!app.isPackaged`, and
  on unsigned macOS builds (Squirrel-mac refuses to update an unsigned app).
  A failed check logs and degrades gracefully — it never crashes.
- **Cadence**: first check ~10s after launch, then every 6 hours.
- **Flow**: `autoDownload = true` → downloads in the background →
  `update-downloaded` fires → renderer shows the restart banner →
  `autoInstallOnAppQuit = true` installs on next quit (or immediately via the
  banner's **Restart** button → `autoUpdater.quitAndInstall()`).
- **Feed**: GitHub Releases, from `build.publish` in `package.json`. electron-
  builder bakes this into `app-update.yml` inside the app at build time.

> ⚠️ TODO — confirm the publish target. It is currently set to the git remote
> (`owner: Clemens865`, `repo: Workspace-OS`). Change these two fields if the
> release repo differs.

### Cutting a release electron-updater will find

1. Bump `version` in `package.json` (electron-updater compares semver).
2. Build a **signed + notarized** DMG (see §4) — unsigned artifacts won't update
   on macOS.
3. Publish so the release assets include `latest-mac.yml` + the `.dmg` +
   `.blockmap` (electron-updater needs all three):

   ```bash
   export GH_TOKEN=<a GitHub PAT with 'repo' scope>
   npm run dist:mac -- --publish always
   ```

   `--publish always` uploads the DMG, blockmap, and `latest-mac.yml` to a
   GitHub Release for the current `v<version>` tag (drafted if it doesn't
   exist). Publish/finalize that release.
4. Installed clients pick it up on their next 6-hour check (or via
   "Check for Updates…").

---

## 3. Crash reporting (local-first 🔒)

Privacy-first per the gap analysis — **nothing is ever uploaded**.

- Native minidumps (renderer/GPU/utility crashes) via Electron's
  `crashReporter` with `uploadToServer: false` → written under
  `app.getPath('crashDumps')` (inside userData).
- Main-process JS safety net: `uncaughtException` / `unhandledRejection` are
  logged to a rotating file at `<userData>/logs/main.log` (rotates to
  `main.1.log` at ~1 MB). electron-updater's own logging is routed here too.
- The user can attach a dump/log to a bug report by choice; there is no
  telemetry endpoint.

userData locations on macOS:
`~/Library/Application Support/Workspace OS/` → `logs/` and `Crashpad/` (or the
platform crashDumps dir).

---

## 4. Manual signing + notarization (⏳ requires your Apple Developer cert)

This is the only step that cannot be done without the certificate. Do it on the
release machine.

### 4.1 One-time setup

1. **Apple Developer Program** membership ($99/yr) → note your **Team ID**
   (Apple Developer → Membership).
2. Create a **Developer ID Application** certificate (Xcode → Settings →
   Accounts → Manage Certificates → +, or the Developer portal). Install it into
   the login keychain of the build machine. Verify:

   ```bash
   security find-identity -v -p codesigning
   # look for: "Developer ID Application: Your Name (TEAMID)"
   ```

3. Create an **app-specific password** for notarization at
   <https://appleid.apple.com> → Sign-In and Security → App-Specific Passwords.

### 4.2 Enable signing in the config

The mac config keeps `"identity": null` so the default dev flow stays unsigned.
For a release build, do **one** of:

- Remove the `"identity": null` line from `build.mac` in `package.json` (electron
  -builder then auto-discovers the Developer ID cert in the keychain), **or**
- Set it explicitly: `"identity": "Developer ID Application: Your Name (TEAMID)"`.

Then turn on notarization by replacing `"notarize": false` with:

```json
"notarize": { "teamId": "YOUR_TEAM_ID" }
```

Hardened runtime + the entitlements in `build/entitlements.mac.plist` are already
configured and take effect automatically once signing is enabled.

### 4.3 Build the signed + notarized DMG

```bash
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="YOUR_TEAM_ID"          # also used by notarize.teamId
export GH_TOKEN="<PAT>"                       # only if publishing

npm run dist:mac                              # signs + notarizes + staples
# or, to build AND publish the update in one step:
npm run dist:mac -- --publish always
```

electron-builder signs with the Developer ID cert, submits to Apple's notary
service (notarytool), and staples the ticket. First notarization can take a few
minutes.

### 4.4 Verify the result

```bash
# Gatekeeper acceptance:
spctl -a -vvv -t install "release/Workspace OS-<version>-arm64.dmg"
# Signature + hardened runtime:
codesign -dv --verbose=4 "release/mac-arm64/Workspace OS.app"
# Notarization staple:
xcrun stapler validate "release/Workspace OS-<version>-arm64.dmg"
```

---

## 5. Why these entitlements (`build/entitlements.mac.plist`)

Applied to both the app and its child processes (`entitlements` +
`entitlementsInherit`). Conservative — only what Electron and the bundled
LibreOffice sidecar need:

| Entitlement | Why |
|---|---|
| `com.apple.security.cs.allow-jit` | Electron/V8 JIT compiles JS to executable memory. |
| `com.apple.security.cs.allow-unsigned-executable-memory` | V8 maps writable+executable pages; hardened runtime blocks this otherwise. Standard for Electron. |
| `com.apple.security.cs.disable-library-validation` | We bundle **LibreOffice.app** (LibreOfficeKit sidecar) and native Node addons (`better-sqlite3`, `node-pty`). Library validation would reject dylibs/plugins not signed by our Team ID. |
| `com.apple.security.cs.allow-dyld-environment-variables` | LibreOffice's launcher sets `DYLD_*` to find its bundled libraries; hardened runtime strips these without the entitlement. |

If notarization later flags the LibreOffice child, revisit whether the sidecar
needs its own signing pass; these four are the conservative starting set.

---

## 6. Deferred / follow-ups

- **Sign the bundled LibreOffice.app** — the sidecar copied via `extraResources`
  is signed under the app's identity by electron-builder's deep sign. If notary
  rejects any nested binary, it may need targeted re-signing. Validate on the
  first real notarized build.
- **Windows/Linux update signing** — `publish` is cross-platform, but this pass
  only configured macOS hardening. Windows needs an Authenticode cert.
- **"Report an issue" affordance** — a Help-menu action to open the log/crash
  dir in Finder (data already lands under userData). Small follow-up.
- **CI publish** — wire `GH_TOKEN` + the three Apple secrets into CI to automate
  §2/§4.
