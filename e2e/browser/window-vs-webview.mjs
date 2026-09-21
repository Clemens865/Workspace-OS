// Decisive experiment: does LinkedIn sign-in work in a real BrowserWindow on
// the SAME session partition that the <webview> guest uses?
//
// Our browser surface renders an Electron <webview>, which is a GUEST
// WebContents — a different browsing context from a normal top-level window.
// Every diagnostic so far used a BrowserWindow and treated the two as
// equivalent. They are not, and it is the one structural difference from real
// Chrome that has never been tested.
//
//   works here, fails in the app  → the guest is the problem, and the fix is to
//                                   move the browser surface to WebContentsView
//                                   (which Electron recommends over <webview>)
//   fails here too                → not the guest; it is the session or the
//                                   fingerprint, and this rules out a big
//                                   migration before anyone starts it
//
// Same partition, so any session you establish here is the one the app uses.
// Nothing is logged or captured; you drive it by hand and close the window.
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
try { execSync('pkill -f "Workspace OS.app/Contents/MacOS"', { stdio: 'ignore' }) } catch { /* none */ }
await new Promise((r) => setTimeout(r, 2000))

const APP = [
  path.join(ROOT, 'release/mac-arm64/Workspace OS.app/Contents/MacOS/Workspace OS'),
  '/Applications/Workspace OS.app/Contents/MacOS/Workspace OS',
].find((p) => fs.existsSync(p))
if (!APP) { console.log('\nSKIP: no packaged app.\n'); process.exit(0) }

const app = await electron.launch({ executablePath: APP, args: [] })
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await win.waitForSelector('#root', { timeout: 20000 })

console.log('\n  Opening LinkedIn in a REAL window on the app\'s browser partition.')
console.log('  Sign in as you normally would, then close that window.\n')

await app.evaluate(async ({ BrowserWindow }) => {
  const w = new BrowserWindow({
    width: 1100,
    height: 850,
    show: true,
    title: 'LinkedIn — real-window test',
    webPreferences: {
      partition: 'persist:wos-browser',   // the SAME jar the app browses in
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  await w.loadURL('https://www.linkedin.com/login')
})

// Stay alive while the window is used; check the outcome by cookie.
const started = Date.now()
let result = 'timed out'
while (Date.now() - started < 5 * 60_000) {
  await new Promise((r) => setTimeout(r, 5000))
  const li = await app.evaluate(async ({ session }) => {
    const c = await session.fromPartition('persist:wos-browser').cookies.get({ name: 'li_at' })
    return c.length > 0
  })
  if (li) { result = 'SIGNED IN'; break }
}

console.log(`\n  RESULT: ${result}`)
console.log(result === 'SIGNED IN'
  ? '  li_at is present — a real window CAN sign in. The <webview> guest is the problem.\n'
  : '  li_at never appeared. Not the guest — the session or the fingerprint.\n')
await app.close().catch(() => {})
