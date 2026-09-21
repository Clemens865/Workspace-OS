/**
 * Watching a workspace must not cost a descriptor per file.
 *
 * 2026-09-16: on a fresh Mac, opening a large folder and visiting Files failed
 * with `fs:read-dir … EMFILE: too many open files`. Both tree watchers used
 * chokidar 4, which opens one fs.watch handle per file AND per directory; the
 * kernel caps a process at kern.maxfilesperproc, and once the watchers held
 * every descriptor, readdir had none. The fix is a single recursive fs.watch.
 *
 * This measures the main process's open descriptors once both watchers are
 * live on a 3000-file workspace. Pre-fix: 3000+. Post-fix: the idle footprint.
 *
 * Run: npm run e2e:fd-pressure   (rebuild:electron + build first)
 */
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

let failures = 0
const check = (name, cond) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}`)
  if (!cond) failures++
}

const DIRS = 30
const PER_DIR = 100
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-fd-'))
for (let d = 0; d < DIRS; d++) {
  const dir = path.join(ws, `dir-${d}`)
  fs.mkdirSync(dir)
  for (let i = 0; i < PER_DIR; i++) fs.writeFileSync(path.join(dir, `note-${i}.md`), `# ${d}/${i}\n`)
}
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-fd-udata-'))

const app = await electron.launch({
  args: [path.join(root, 'out/main/index.js')],
  cwd: root,
  env: { ...process.env, WORKSPACE_TEST_ROOT: ws, WOS_USERDATA_DIR: userData },
})

// Playwright serialises this function into the main process, where `require`
// is not in scope; the entry module's own loader is.
const openFds = () => app.evaluate(() => process.mainModule.require('fs').readdirSync('/dev/fd').length)

try {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForSelector('#root', { timeout: 20000 })
  await win.waitForTimeout(1500)

  // Both watchers start on their own as soon as the shell mounts, so there is
  // no clean "before": assert the ABSOLUTE count once everything has settled.
  // A per-entry watcher puts the main process at 3000+ here; the recursive one
  // leaves it near the app's idle footprint (~120).
  await win.evaluate(async () => {
    await window.workspace.fs.watchStart()
    await window.workspace.search.start()
  })
  // Let the indexer walk finish and any per-entry watcher open everything it would.
  await win.waitForTimeout(6000)
  const open = await openFds()
  console.log(`  main-process open descriptors=${open} with ${DIRS * PER_DIR} files watched`)
  check('tree + index watchers keep the main process under 400 descriptors', open < 400)

  const listing = await win.evaluate((r) => window.workspace.fs.readDir(r), ws)
  check('fs:read-dir still answers with the watchers live', Array.isArray(listing) && listing.length >= DIRS)
} catch (err) {
  console.error('  ✗ harness error:', err?.message ?? err)
  failures++
} finally {
  await app.close().catch(() => {})
  fs.rmSync(ws, { recursive: true, force: true })
  fs.rmSync(userData, { recursive: true, force: true })
}

console.log(`\nFD PRESSURE: ${failures === 0 ? 'all passed' : failures + ' failed'}`)
process.exit(failures === 0 ? 0 : 1)
