// Does the browser EXPLAIN a refused sign-in, and stay quiet otherwise?
//
// The failure that matters is the false positive: a scary bar over a working
// page is worse than the silence it replaced. So this checks both directions.
import { _electron as electron } from 'playwright'
import path from 'path'
const ROOT = process.cwd()
const app = await electron.launch({
  args: [path.join(ROOT, 'out/main/index.js'), '--user-data-dir=/tmp/wos-banner'],
  cwd: ROOT, env: { ...process.env, WORKSPACE_TEST_ROOT: '/tmp/wos-demo' },
})
const win = await app.firstWindow({ timeout: 30000 })
await win.waitForSelector('#root', { timeout: 30000 })
await win.evaluate(() => localStorage.setItem('workspace-os:settings', JSON.stringify({ newShell: true })))
await win.reload(); await win.waitForSelector('#root'); await win.waitForTimeout(3500)
await win.evaluate(() => [...document.querySelectorAll('nav[aria-label="Primary"] button')]
  .find(e => (e.textContent || '').trim().toLowerCase() === 'browser')?.click())
await win.waitForTimeout(3500)

const go = async (url) => {
  await app.evaluate(async ({ webContents }, u) => {
    const g = webContents.getAllWebContents().find((c) => c.getType() === 'webview')
    if (g) { try { await g.loadURL(u) } catch { /* the refusal page may abort */ } }
  }, url)
  await win.waitForTimeout(4000)
  return win.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) => /will not sign in here/.test(d.textContent || ''))
    return el ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 130) : null
  })
}

console.log('normal page   :', await go('https://duckduckgo.com/'))
console.log('google signin :', await go('https://accounts.google.com/v3/signin/identifier?flowName=GeneralOAuthFlow'))
console.log('THE REFUSAL   :', await go('https://accounts.google.com/v3/signin/rejected?flowName=GeneralOAuthFlow'))
await win.screenshot({ path: '/tmp/signin-banner.png' })
console.log('back to normal:', await go('https://duckduckgo.com/'))
await app.close()
