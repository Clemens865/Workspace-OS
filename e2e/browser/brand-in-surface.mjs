// Does the Chrome identity actually reach the browser the USER drives?
//
// The earlier probe made its own BrowserWindow, which no hook touches, and so
// measured nothing about the product. The guest webview is the thing with an
// address bar in front of it, and it is the only place this matters.
import { _electron as electron } from 'playwright'
import path from 'path'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'
const ROOT = process.cwd()
const app = await electron.launch({
  args: [path.join(ROOT, 'out/main/index.js'), '--user-data-dir=/tmp/wos-brand'],
  cwd: ROOT, env: { ...process.env, WORKSPACE_TEST_ROOT: '/tmp/wos-demo' },
})
const win = await app.firstWindow({ timeout: 30000 })
await win.waitForSelector('#root', { timeout: 30000 })
await win.evaluate(() => localStorage.setItem('workspace-os:settings', JSON.stringify({ newShell: true })))
await win.reload(); await win.waitForSelector('#root'); await win.waitForTimeout(3500)

await win.evaluate(() => [...document.querySelectorAll('nav[aria-label="Primary"] button')]
  .find(e => (e.textContent || '').trim().toLowerCase() === 'browser')?.click())
await win.waitForTimeout(4000)

const out = await app.evaluate(async ({ webContents }) => {
  const guests = webContents.getAllWebContents().filter((c) => c.getType() === 'webview')
  const rows = []
  for (const g of guests) {
    try {
      const brands = await g.executeJavaScript(
        'navigator.userAgentData ? navigator.userAgentData.brands.map(b=>b.brand+"/"+b.version).join(" | ") : "(none)"')
      rows.push({ url: g.getURL().slice(0, 60), brands })
    } catch (e) { rows.push({ url: g.getURL().slice(0, 60), brands: 'threw: ' + e.message }) }
  }
  return rows
})
console.log(JSON.stringify(out, null, 1))
await app.close()
