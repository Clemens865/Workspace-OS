const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

/**
 * node-pty execs a tiny `spawn-helper` binary beside whichever pty.node it
 * managed to load. The package ships TWO copies: build/Release (our
 * electron-rebuild output, 755) and prebuilds/<platform>-<arch> (npm's
 * fallback, shipped as 644). If the first pty.node fails to dlopen on a user's
 * machine, node-pty silently falls back to the prebuilt dir and every terminal
 * dies with a bare `posix_spawnp failed.` (seen 2026-09-15 on a second Mac
 * running the shipped dmg). Give every copy the execute bit before signing so
 * the fallback path is as good as the primary one.
 */
function fixSpawnHelpers(app) {
  const root = path.join(app, 'Contents/Resources/app.asar.unpacked/node_modules/node-pty')
  if (!fs.existsSync(root)) {
    console.log('[after-pack] node-pty not unpacked, nothing to fix')
    return
  }
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.name === 'spawn-helper') {
        fs.chmodSync(p, 0o755)
        console.log(`[after-pack] execute bit set: ${path.relative(app, p)}`)
      }
    }
  }
  walk(root)
}

/**
 * Re-sign the packed .app before electron-builder wraps it into a dmg/zip.
 *
 * WOS-002: electron-builder's own ad-hoc signing (build.mac.identity = null)
 * leaves an incomplete seal — `codesign -v` reports "code has no resources but
 * signature indicates they must be present". With `hardenedRuntime: true`,
 * macOS 26's code-signing monitor then SIGKILLs the process the moment dyld
 * maps a native addon page it cannot validate. The app boots fine and dies
 * minutes later at the first lazy `dlopen`, so it reads as a random runtime
 * crash rather than a packaging fault.
 *
 * This runs in `afterPack`, i.e. BEFORE the dmg and zip are built, so the
 * distributables carry the fixed bundle rather than only the local install.
 *
 * Signing failure is fatal on purpose. A silently-unsigned build is exactly the
 * bug this hook exists to prevent, and shipping one "successfully" is worse than
 * failing the build.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)

  fixSpawnHelpers(app)

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  // Verify rather than trust: the whole point is that the previous signature
  // looked like it had worked.
  execFileSync('codesign', ['--verify', app], { stdio: 'inherit' })

  console.log(`[after-pack] re-signed and verified: ${app}`)
}
