import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

/**
 * Ad-hoc re-sign the rebuilt native addons. macOS only; a no-op elsewhere.
 *
 * WOS-002/WOS-003. Rebuilding a .node in place leaves macOS 26's code-signing
 * monitor with inconsistent signed-page state, and the kernel then SIGKILLs any
 * process that dlopens it — EXC_BAD_ACCESS, CODESIGNING / Invalid Page. The app
 * boots fine and dies later at the first lazy load, so it reads as a random
 * runtime crash rather than a build step that was missed.
 *
 * This cost an evening twice: once as "the app keeps crashing", and once as
 * "Playwright can't launch Electron 42" — which was never true. Both rebuild
 * scripts now sign, so neither symptom can come back.
 */
const TARGETS = [
  'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  'node_modules/node-pty/build/Release/pty.node',
]

if (process.platform !== 'darwin') process.exit(0)

let signed = 0
for (const rel of TARGETS) {
  const f = path.resolve(rel)
  if (!fs.existsSync(f)) continue
  execFileSync('codesign', ['--force', '--sign', '-', f], { stdio: 'pipe' })
  execFileSync('codesign', ['--verify', f], { stdio: 'pipe' }) // verify, don't assume
  signed++
}
console.log(`[sign-native] re-signed and verified ${signed} native addon(s)`)
