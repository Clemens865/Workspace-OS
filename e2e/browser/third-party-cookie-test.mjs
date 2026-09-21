// Does the in-app browser accept a REAL third-party cookie?
//
// Not session.cookies.set() — that writes straight into the store through
// Electron's API and BYPASSES the third-party policy, so it always succeeds and
// proves nothing. I made exactly that mistake and reported it as a fix.
//
// This does it the way a sign-in flow does: a page on origin A embeds an iframe
// from origin B, B sets a cookie over HTTP, and we check whether it landed.
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

const out = await app.evaluate(async ({ session, BrowserWindow }) => {
  const s = session.fromPartition('persist:wos-browser')
  // Start clean so a leftover cannot masquerade as success.
  await s.cookies.remove('https://httpbin.org/', 'wos3p').catch(() => {})

  const w = new BrowserWindow({
    show: false,
    webPreferences: { partition: 'persist:wos-browser', sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  // Top-level origin A…
  await w.loadURL('https://example.com/')
  // …embeds an iframe from origin B that sets a cookie over HTTP. Cross-site,
  // exactly like a provider's silent-SSO frame.
  await w.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const f = document.createElement('iframe')
      f.src = 'https://httpbin.org/response-headers?Set-Cookie=wos3p%3D1%3B%20Path%3D%2F%3B%20SameSite%3DNone%3B%20Secure'
      f.onload = () => resolve(true)
      f.onerror = () => resolve(false)
      document.body.appendChild(f)
      setTimeout(() => resolve(false), 12000)
    })
  `)
  await new Promise((r) => setTimeout(r, 2500))

  const got = await s.cookies.get({ name: 'wos3p' })
  w.destroy()
  return { stored: got.length > 0, detail: got[0] ? { domain: got[0].domain, sameSite: got[0].sameSite } : null }
})

console.log('\n  REAL THIRD-PARTY COOKIE TEST')
console.log('  ────────────────────────────')
console.log('  A cross-site iframe set a cookie over HTTP (as silent SSO does).')
console.log(out.stored
  ? `  ✓ ACCEPTED — third-party cookies work  ${JSON.stringify(out.detail)}`
  : '  ✗ REFUSED — third-party cookies are still blocked. Silent SSO cannot work.')
console.log('')
await app.close()
try { execSync('pkill -f "Workspace OS.app/Contents/MacOS"', { stdio: 'ignore' }) } catch { /* none */ }
