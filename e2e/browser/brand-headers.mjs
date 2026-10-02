// What the SERVER actually receives, versus what the page says about itself.
// The whole point: one story, or none. Reads a real echo endpoint from the
// guest webview — the surface the user drives.
import { _electron as electron } from 'playwright'
import path from 'path'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'
const ROOT = process.cwd()
const app = await electron.launch({
  args: [path.join(ROOT, 'out/main/index.js'), '--user-data-dir=/tmp/wos-bh'],
  cwd: ROOT, env: { ...process.env, WORKSPACE_TEST_ROOT: '/tmp/wos-demo' },
})
const win = await app.firstWindow({ timeout: 30000 })
await win.waitForSelector('#root', { timeout: 30000 })
await win.evaluate(() => localStorage.setItem('workspace-os:settings', JSON.stringify({ newShell: true })))
await win.reload(); await win.waitForSelector('#root'); await win.waitForTimeout(3500)
await win.evaluate(() => [...document.querySelectorAll('nav[aria-label="Primary"] button')]
  .find(e => (e.textContent || '').trim().toLowerCase() === 'browser')?.click())
await win.waitForTimeout(3500)
console.log(JSON.stringify(await app.evaluate(async ({ webContents }) => {
  const g = webContents.getAllWebContents().find((c) => c.getType() === 'webview')
  if (!g) return { error: 'no guest' }
  await g.loadURL('https://httpbin.org/headers')
  await new Promise((r) => setTimeout(r, 3500))
  const body = await g.executeJavaScript('document.body.innerText')
  const js = await g.executeJavaScript('navigator.userAgentData.brands.map(b=>b.brand+"/"+b.version).join(" | ")')
  let all = {}
  try { all = JSON.parse(body).headers } catch { /* keep raw */ }
  const ch = Object.fromEntries(Object.entries(all).filter(([k]) => /sec-ch|user-agent/i.test(k)))
  return { chHeaders: ch, pageSays: js }
}), null, 1))
await app.close()
