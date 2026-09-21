#!/usr/bin/env node
/**
 * ship — build the app, install it to /Applications, and publish the dmg + zip
 * to the (private) GitHub repo as a release.
 *
 * Run this after a feature lands or a bug sweep is finished:
 *
 *     npm run ship                    # full: verify → build → install → release
 *     npm run ship -- --dry-run       # do everything except mutate anything
 *     npm run ship -- --no-release    # build + install only, nothing leaves the machine
 *     npm run ship -- --no-install    # build + release, don't touch /Applications
 *     npm run ship -- --notes "..."   # release notes body (default: the commit subject)
 *
 * Why a script rather than a chain of npm scripts: every step here has a way of
 * failing that LOOKS like success, and each guard below was paid for in a real
 * incident. See the numbered comments.
 */
import { execSync, execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const DRY = has('--dry-run')
const DO_RELEASE = !has('--no-release')
const DO_INSTALL = !has('--no-install')
const NOTES = (() => { const i = argv.indexOf('--notes'); return i >= 0 ? argv[i + 1] : null })()

const ENGINE_VOLUME = '/Volumes/LOBuild'
const ENGINE_PATH = `${ENGINE_VOLUME}/core/instdir/LibreOffice.app`
const SPARSE = '/Volumes/Extreme SSD/LOBuild.sparseimage'
const APPLICATIONS = '/Applications/Workspace OS.app'
const OUT_DIR = path.join(ROOT, 'release')

let step = 0
const log = (m) => console.log(`\n\x1b[1m[ship ${++step}]\x1b[0m ${m}`)
const info = (m) => console.log(`         ${m}`)
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m      ${m}`)
const die = (m, hint) => {
  console.error(`\n\x1b[31m✗ ship failed:\x1b[0m ${m}`)
  if (hint) console.error(`\n  ${hint}\n`)
  process.exit(1)
}
const run = (cmd, opts = {}) => execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts })
const cap = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf-8' }).trim()
const tryCap = (cmd) => { try { return cap(cmd) } catch { return null } }

if (DRY) console.log('\n\x1b[36m── DRY RUN — nothing will be built, installed, pushed or released ──\x1b[0m')

/* ------------------------------------------------------------------ *
 * 1. Preflight — fail before spending ten minutes on a build
 * ------------------------------------------------------------------ */
log('Preflight')

if (process.platform !== 'darwin') die('ship only builds the macOS target')

// The engine volume is a BUILD-time dependency: electron-builder's
// extraResources copies LibreOffice out of it into the bundle. Without it the
// build fails late and confusingly.
if (!fs.existsSync(ENGINE_PATH)) {
  die(`engine volume not mounted — ${ENGINE_PATH} is missing`,
      `Mount it first:\n    hdiutil attach "${SPARSE}"\n\n  If a stale device blocks it: hdiutil detach /dev/diskN -force`)
}
info(`engine volume mounted (${ENGINE_PATH})`)

const branch = cap('git rev-parse --abbrev-ref HEAD')
info(`branch: ${branch}`)

// Uncommitted SOURCE is a real problem: the build would ship code that is in no
// commit, so the release could never be reproduced. Test-output noise
// (e2e screenshots) is not, so it is reported and tolerated.
const dirty = cap('git status --porcelain').split('\n').filter(Boolean)
const dirtySrc = dirty.filter((l) => !l.includes('e2e/office/shots/'))
if (dirtySrc.length) {
  console.error('\n  Uncommitted changes:')
  dirtySrc.forEach((l) => console.error(`    ${l}`))
  die('working tree has uncommitted source changes',
      'Commit them first — a release built from uncommitted code cannot be reproduced.\n  (Changes under e2e/office/shots/ are ignored here; they are test output.)')
}
if (dirty.length !== dirtySrc.length) warn(`${dirty.length - dirtySrc.length} modified e2e screenshot(s) ignored`)

if (DO_RELEASE) {
  if (!tryCap('gh auth status 2>&1 && echo ok')) die('gh is not authenticated', 'Run: gh auth login')
  info('gh authenticated')
}

/* ------------------------------------------------------------------ *
 * 2. Verify — a release is a claim that this build works
 * ------------------------------------------------------------------ */
log('Verify (typecheck + unit tests)')
if (DRY) {
  info('skipped (dry run)')
} else {
  // These run against the NODE abi, which is what the tree is normally left in.
  // dist:mac flips to electron and back afterwards, so order matters: verify first.
  try { run('npm run typecheck') } catch { die('typecheck failed') }

  // ONE retry, and only one. The suite carries a documented timing-dependent
  // flake (the lokHost sidecar-exit assertion) which would otherwise block every
  // ship — it blocked the very first one. But a silent retry is how a real
  // intermittent regression gets shipped, so a retry that SUCCEEDS is reported
  // loudly rather than swallowed: the whole point of a gate is that you find out.
  let flaked = false
  try {
    run('npm test')
  } catch {
    warn('unit tests failed — retrying ONCE to rule out the known flake…')
    try {
      run('npm test')
      flaked = true
    } catch {
      die('unit tests failed twice — this is a real failure, not the known flake',
          'If it is ERR_DLOPEN_FAILED rather than an assertion, the native ABI is set for\n  Electron. Run: npm run rebuild:node')
    }
  }
  if (flaked) {
    warn('⚠︎ THE SUITE FAILED ONCE AND PASSED ON RETRY — a flake occurred in THIS ship.')
    warn('  Scroll up for the failing test. If it is not the known lokHost sidecar-exit')
    warn('  assertion, treat it as a real intermittent bug, not noise.')
  }
}
// Deliberately NOT gating on the office e2e: newDoc()->waitRender is flaky at
// ~1 run in 3, so a five-test suite fails ~87% of the time through no fault of
// the build. Gating on it would make shipping impossible. See docs/HANDOFF.md §8.
warn('real-engine e2e is NOT a gate here (known ~1-in-3 harness flake) — run it yourself for engine work')

/* ------------------------------------------------------------------ *
 * 3. Version — auto-bump the patch so electron-updater sees an upgrade
 * ------------------------------------------------------------------ */
log('Version')
const pkgPath = path.join(ROOT, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
const prev = pkg.version
const [maj, min, pat] = prev.split('.').map(Number)
const next = has('--no-bump') ? prev : `${maj}.${min}.${pat + 1}`
const tag = `v${next}`

if (tryCap(`git tag -l ${tag}`)) die(`tag ${tag} already exists`, 'Bump manually in package.json, or pass --no-bump if you meant to reuse it.')

if (next !== prev) {
  info(`${prev} → ${next}`)
  if (!DRY) {
    pkg.version = next
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
    run('git add package.json')
    run(`git commit -m "chore(release): ${tag}"`)
  }
} else {
  info(`keeping ${prev} (--no-bump)`)
}

/* ------------------------------------------------------------------ *
 * 4. Build
 * ------------------------------------------------------------------ */
log('Build (dist:mac — this takes a few minutes)')
if (DRY) {
  info('skipped (dry run)')
} else {
  // dist:mac already flips the native ABI to electron and back to node after.
  try { run('npm run dist:mac') } catch {
    die('build failed',
        'If this is a transient `hdiutil resize` error the dmg step is flaky — re-run.\n  The .zip is the reliable artifact.')
  }
}

const builtApp = path.join(OUT_DIR, 'mac-arm64', 'Workspace OS.app')
const dmg = path.join(OUT_DIR, `Workspace OS-${next}-arm64.dmg`)
const zip = path.join(OUT_DIR, `Workspace OS-${next}-arm64-mac.zip`)

if (!DRY) {
  if (!fs.existsSync(builtApp)) die(`build produced no app at ${builtApp}`)
  // WOS-002: an invalid seal makes macOS SIGKILL the process at the first lazy
  // dlopen — MINUTES after a successful launch, so it reads as a random crash.
  // afterPack already signs; this verifies rather than trusts, because the whole
  // point of that bug is that the previous signature LOOKED like it had worked.
  try { execFileSync('codesign', ['--verify', '--deep', builtApp], { stdio: 'pipe' }) } catch (e) {
    die('the built app fails codesign verification',
        'Do NOT ship this — macOS will SIGKILL it at the first native module load (WOS-002).')
  }
  info('signature verified on the built app')
}

/* ------------------------------------------------------------------ *
 * 5. Install to /Applications
 * ------------------------------------------------------------------ */
if (DO_INSTALL) {
  log('Install to /Applications')
  if (DRY) {
    info(`would replace ${APPLICATIONS}`)
  } else {
    // Replacing a RUNNING bundle leaves a half-updated app that crashes oddly.
    //
    // Ask it to quit properly first and give it time. A SIGKILL leaves
    // LaunchServices holding a stale registration, and the next launch then
    // fails or dies immediately — which is exactly the "it crashes when you
    // start it, I have to open it from Applications myself" the user hit.
    // pkill stays as a last resort, after the polite path has had its chance.
    const running = tryCap('pgrep -f "Workspace OS.app/Contents/MacOS" | head -1')
    if (running) {
      info('quitting the running app…')
      try { execSync('osascript -e \'quit app "Workspace OS"\'', { stdio: 'pipe' }) } catch { /* not scriptable */ }
      for (let i = 0; i < 20; i++) {
        if (!tryCap('pgrep -f "Workspace OS.app/Contents/MacOS" | head -1')) break
        execSync('sleep 0.5')
      }
      if (tryCap('pgrep -f "Workspace OS.app/Contents/MacOS" | head -1')) {
        warn('it did not quit on request; forcing (a relaunch may need Finder)')
        try { execSync('pkill -f "Workspace OS.app/Contents/MacOS"', { stdio: 'pipe' }) } catch { /* gone */ }
        execSync('sleep 2')
      }
    }
    fs.rmSync(APPLICATIONS, { recursive: true, force: true })
    // ditto preserves the bundle's extended attributes and signature; cp -R does not.
    execFileSync('ditto', [builtApp, APPLICATIONS], { stdio: 'inherit' })
    try { execFileSync('codesign', ['--verify', '--deep', APPLICATIONS], { stdio: 'pipe' }) } catch {
      die('the INSTALLED app fails codesign verification', 'The copy broke the seal — do not launch it.')
    }
    info(`installed and verified: ${APPLICATIONS}`)

    // Launch it. The point of shipping after every feature is to have the thing
    // in front of you — an installed build you never open proves nothing.
    if (!has('--no-launch')) {
      execFileSync('open', ['-a', APPLICATIONS], { stdio: 'inherit' })
      info('launched')
    }
  }
}

/* ------------------------------------------------------------------ *
 * 6. Push + release
 * ------------------------------------------------------------------ */
if (DO_RELEASE) {
  log('Push and release')
  const subject = NOTES ?? tryCap('git log -1 --pretty=%s') ?? tag
  if (DRY) {
    info(`would push ${branch}, tag ${tag}, and upload:`)
    info(`  ${path.basename(dmg)}`)
    info(`  ${path.basename(zip)}`)
    info(`  notes: ${subject}`)
  } else {
    // A release that points at commits nobody else has is a dead link.
    try { run(`git push origin ${branch}`) } catch { die('git push failed', 'Resolve it, then re-run with --no-bump to reuse this version.') }

    const assets = [dmg, zip].filter((f) => {
      if (fs.existsSync(f)) return true
      warn(`missing artifact, not uploading: ${path.basename(f)}`)
      return false
    })
    if (!assets.length) die('no artifacts to upload')

    run(`git tag ${tag} && git push origin ${tag}`)
    execFileSync('gh', [
      'release', 'create', tag,
      ...assets,
      '--repo', 'Clemens865/Workspace-OS',
      '--title', tag,
      '--notes', subject,
    ], { cwd: ROOT, stdio: 'inherit' })
    info(`released ${tag}`)
  }
}

/* ------------------------------------------------------------------ */
console.log(`\n\x1b[32m✓ ship complete\x1b[0m — ${tag}${DRY ? ' (dry run)' : ''}`)
if (!DRY && DO_INSTALL) console.log(`  Installed: ${APPLICATIONS}`)
if (!DRY && DO_RELEASE) console.log(`  Release:   https://github.com/Clemens865/Workspace-OS/releases/tag/${tag}`)
console.log()
