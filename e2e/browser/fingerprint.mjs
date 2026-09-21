// What a login page's bot check sees when it looks at our browser.
//
// The provider probe showed all three sign-in FORMS load fine, so the refusal
// Clemens hit came later — after the email was submitted, where Google runs a
// fingerprint. This lists the signals those checks actually read, so the next
// move is picking a wrong one to fix rather than guessing at the user agent
// again (three plausible unmeasured fixes have already been paid for here).
//
// CONFOUND, stated loudly: this launches the app under Playwright, which sets
// navigator.webdriver = true. The installed app sets no automation switches, so
// in real use it is false. Any line marked [HARNESS] is about this probe, not
// about the product.
import { _electron as electron } from 'playwright'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

try {
  execSync('pkill -9 -f "Workspace-OS/node_modules/electron"', { stdio: 'ignore' })
} catch {
  /* nothing running */
}

const app = await electron.launch({
  args: [path.join(ROOT, 'out/main/index.js'), '--user-data-dir=/tmp/wos-fp'],
  cwd: ROOT,
  env: { ...process.env, WORKSPACE_TEST_ROOT: '/tmp/wos-demo' },
})
const win = await app.firstWindow({ timeout: 30000 })
await win.waitForSelector('#root', { timeout: 30000 })
await win.waitForTimeout(2000)

const report = await app.evaluate(async ({ BrowserWindow }) => {
  const w = new BrowserWindow({
    show: false,
    webPreferences: { partition: 'persist:browser', sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  // A real https origin: several of these APIs are unavailable otherwise.
  await w.loadURL('https://accounts.google.com/robots.txt')
  const out = await w.webContents.executeJavaScript(`(async () => {
    const r = {}
    r.webdriver = navigator.webdriver
    r.brands = navigator.userAgentData ? navigator.userAgentData.brands.map(b => b.brand + '/' + b.version).join(' | ') : '(none)'
    r.ua = navigator.userAgent

    // The classic mismatch: a page that is DENIED notifications but whose
    // permission query says 'prompt' is the signature of an automated or
    // embedded browser. Deny-all permission handlers produce it by accident.
    r.notificationPermission = typeof Notification !== 'undefined' ? Notification.permission : '(no Notification)'
    try {
      const st = await navigator.permissions.query({ name: 'notifications' })
      r.permissionsQuery = st.state
    } catch (e) { r.permissionsQuery = 'threw: ' + e.message }
    r.permissionsConsistent = r.notificationPermission === r.permissionsQuery

    // window.chrome — present in Chrome, and its shape is checked.
    r.windowChrome = typeof window.chrome
    r.chromeRuntime = !!(window.chrome && window.chrome.runtime)
    r.chromeKeys = window.chrome ? Object.keys(window.chrome).join(',') : '(none)'

    r.plugins = navigator.plugins.length
    r.mimeTypes = navigator.mimeTypes.length
    r.languages = navigator.languages.join(',')
    r.hardwareConcurrency = navigator.hardwareConcurrency
    r.deviceMemory = navigator.deviceMemory ?? '(absent)'
    r.maxTouchPoints = navigator.maxTouchPoints
    r.pdfViewerEnabled = navigator.pdfViewerEnabled

    // WebGL — a headless or software-rendered stack is a strong tell.
    try {
      const gl = document.createElement('canvas').getContext('webgl')
      const dbg = gl.getExtension('WEBGL_debug_renderer_info')
      r.webglVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)
      r.webglRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
    } catch (e) { r.webglVendor = 'threw: ' + e.message }

    r.screen = screen.width + 'x' + screen.height + ' @' + window.devicePixelRatio
    r.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    r.cookieEnabled = navigator.cookieEnabled
    return r
  })()`)
  w.destroy()
  return out
})

const ok = (b) => (b ? '✓' : '✗')
console.log('\n  WHAT A LOGIN PAGE SEES\n')
console.log(`    userAgent            ${report.ua.slice(0, 96)}`)
console.log(`    brands               ${report.brands}`)
console.log(`    webdriver            ${report.webdriver}   [HARNESS — false in the installed app]`)
console.log('')
console.log(`  ${ok(report.permissionsConsistent)} permissions agree`)
console.log(`    Notification.permission        ${report.notificationPermission}`)
console.log(`    permissions.query('notifications') ${report.permissionsQuery}`)
console.log('')
console.log(`  ${ok(report.windowChrome === 'object')} window.chrome present  (${report.windowChrome})`)
console.log(`    chrome.runtime       ${report.chromeRuntime}`)
console.log(`    chrome keys          ${report.chromeKeys}`)
console.log('')
console.log(`  ${ok(report.plugins > 0)} plugins ${report.plugins} · mimeTypes ${report.mimeTypes} · pdfViewer ${report.pdfViewerEnabled}`)
console.log(`    hardwareConcurrency  ${report.hardwareConcurrency}`)
console.log(`    deviceMemory         ${report.deviceMemory}`)
console.log(`    maxTouchPoints       ${report.maxTouchPoints}`)
console.log(`    languages            ${report.languages}`)
console.log(`    screen               ${report.screen}`)
console.log(`    timezone             ${report.timezone}`)
console.log('')
console.log(`  ${ok(!/swiftshader|llvmpipe|software/i.test(String(report.webglRenderer)))} GPU rendering`)
console.log(`    webgl vendor         ${report.webglVendor}`)
console.log(`    webgl renderer       ${report.webglRenderer}`)
console.log('')

await app.close()
