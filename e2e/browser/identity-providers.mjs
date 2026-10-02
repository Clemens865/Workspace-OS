// Does the in-app browser get to sign in with Google, Microsoft or Apple?
//
// The question that decides whether "log in once, the agent inherits the
// session" is viable at all, since those three are the buttons most sites lead
// with. It has never been measured — the Google refusal was found by a user
// hitting it, and the other two are assumption.
//
// It logs in to NOTHING and needs no credentials. It loads each provider's
// real authorize endpoint and reports what came back: the sign-in form, or the
// "this browser may not be secure" refusal. That is the whole difference
// between a usable browser and a dead end, and it is visible before any
// password is typed.
//
// Run it twice to get the comparison that matters:
//   node e2e/browser/identity-providers.mjs                    # honest Chromium
//   WOS_BRAND_CHROME=1 node e2e/browser/identity-providers.mjs # claiming Chrome
import { _electron as electron } from 'playwright'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

try {
  execSync('pkill -9 -f "Workspace-OS/node_modules/electron"', { stdio: 'ignore' })
} catch {
  /* nothing running */
}

/**
 * A real authorize URL per provider.
 *
 * Public client ids from live products, so these are the exact flows a user
 * meets — a hand-made test endpoint would not be subject to the same policy.
 * `redirect_uri` never resolves to us and nothing is ever submitted.
 */
const PROVIDERS = [
  {
    name: 'Google',
    url:
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=565486769470-fhjhtkgh7hbrcsd4mt0632cmj0io1phm.apps.googleusercontent.com' +
      '&redirect_uri=https%3A%2F%2Fclerk.higgsfield.ai%2Fv1%2Foauth_callback&response_type=code' +
      '&scope=openid%20email%20profile&state=probe',
    // How Google says no.
    refused: (url, text) =>
      /\/signin\/rejected/.test(url) ||
      /may not be secure|nicht sicher|disallowed_useragent/i.test(text),
    // How Google says yes: the account chooser or the identifier form.
    accepted: (url, text) => /\/signin\/(identifier|v\d\/identifier)/.test(url) || /Sign in|Anmelden/i.test(text),
  },
  {
    name: 'Microsoft',
    url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=d3590ed6-52b3-4102-aeff-aad2292ab01c' +
      '&redirect_uri=https%3A%2F%2Flogin.microsoftonline.com%2Fcommon%2Foauth2%2Fnativeclient&response_type=code' +
      '&scope=openid%20profile&state=probe',
    refused: (url, text) => /error=|unsupported_browser/i.test(url) || /browser.{0,30}not supported|nicht unterst/i.test(text),
    accepted: (_url, text) => /Sign in|Anmelden|email, phone|E-Mail/i.test(text),
  },
  {
    name: 'Apple',
    url: 'https://appleid.apple.com/auth/authorize?client_id=com.spotify.accounts&redirect_uri=https%3A%2F%2Faccounts.spotify.com%2Flogin%2Fapple%2Fcallback' +
      '&response_type=code&scope=name%20email&response_mode=form_post&state=probe',
    refused: (url, text) => /unsupported|error/i.test(url) || /not supported|unable to/i.test(text),
    accepted: (_url, text) => /Apple.{0,20}(ID|Account)|Sign in|Anmelden/i.test(text),
  },
]

const app = await electron.launch({
  args: [path.join(ROOT, 'out/main/index.js'), '--user-data-dir=/tmp/wos-idp'],
  cwd: ROOT,
  env: { ...process.env, WORKSPACE_TEST_ROOT: '/tmp/wos-demo' },
})
const win = await app.firstWindow({ timeout: 30000 })
await win.waitForSelector('#root', { timeout: 30000 })
await win.waitForTimeout(2500)

const claiming = process.env['WOS_BRAND_CHROME'] === '1'
console.log(`\n  IDENTITY: ${claiming ? 'claiming Google Chrome' : 'honest Chromium'}\n`)

/** Loads a url in the BROWSER session (not the app window) and reports it. */
const results = []
for (const p of PROVIDERS) {
  const r = await app.evaluate(async ({ BrowserWindow, session }, { url, partition }) => {
    const w = new BrowserWindow({
      show: false,
      webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    try {
      await w.loadURL(url)
      // Providers redirect a few times before settling.
      await new Promise((r) => setTimeout(r, 4000))
      const finalUrl = w.webContents.getURL()
      const text = await w.webContents.executeJavaScript('document.body ? document.body.innerText.slice(0, 4000) : ""')
      const brands = await w.webContents.executeJavaScript(
        'navigator.userAgentData ? navigator.userAgentData.brands.map(b => b.brand + "/" + b.version).join(" | ") : "(none)"',
      )
      return { finalUrl, text, brands }
    } catch (e) {
      return { finalUrl: '', text: `LOAD FAILED: ${e.message}`, brands: '' }
    } finally {
      w.destroy()
    }
  }, { url: p.url, partition: 'persist:browser' })

  const refused = p.refused(r.finalUrl, r.text)
  const accepted = !refused && p.accepted(r.finalUrl, r.text)
  const verdict = refused ? 'REFUSED' : accepted ? 'sign-in shown' : 'unclear'
  results.push({ name: p.name, verdict, url: r.finalUrl, brands: r.brands })

  console.log(`  ${p.name.padEnd(10)} ${verdict}`)
  console.log(`    brands   ${r.brands}`)
  console.log(`    landed   ${r.finalUrl.slice(0, 110)}`)
  console.log(`    says     ${r.text.replace(/\s+/g, ' ').trim().slice(0, 150)}\n`)
}

console.log('  SUMMARY')
for (const r of results) console.log(`    ${r.name.padEnd(10)} ${r.verdict}`)
console.log('')

await app.close()
