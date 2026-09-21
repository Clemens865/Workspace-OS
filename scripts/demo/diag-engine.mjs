/**
 * Diagnostic: does the office engine open a document under the demo's env?
 *
 *   node scripts/demo/diag-engine.mjs              # with the demo HOME
 *   node scripts/demo/diag-engine.mjs --real-home  # with the real one
 *
 * Written because the demo's office segment burned its whole budget waiting for
 * a document that never opened, while the office e2e — which does NOT override
 * HOME — opens documents fine.
 */
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const WS = '/tmp/wos-demo'
const DEMO_HOME = '/tmp/wos-demo-home'
const useDemoHome = !process.argv.includes('--real-home')
const LOG = `/tmp/diag-engine${useDemoHome ? '-demohome' : '-realhome'}.log`

fs.writeFileSync(LOG, '')
// Appended as we go: node buffers stdout to a file, so a hung run shows nothing.
const say = (...parts) => {
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')
  fs.appendFileSync(LOG, line + '\n')
}

const timer = setTimeout(() => {
  say('TIMEOUT — giving up')
  process.exit(2)
}, 180_000)

const DEV_ENGINE = '/Volumes/LOBuild/core/instdir/LibreOffice.app/Contents'
const env = {
  ...process.env,
  WORKSPACE_TEST_ROOT: WS,
  WOS_LOK_INSTALL: `${DEV_ENGINE}/Frameworks/`,
  WOS_LOK_FUND: `${DEV_ENGINE}/Resources/fundamentalrc`,
  WOS_LOK_HOST: path.join(ROOT, 'scripts/lok/wos-lok-host'),
}
if (useDemoHome) env.HOME = DEMO_HOME
say('HOME =', env.HOME)

const app = await electron.launch({ args: [path.join(ROOT, 'out/main/index.js')], cwd: ROOT, env })
const win = await app.firstWindow({ timeout: 30000 })
await win.waitForSelector('#root', { timeout: 30000 })

say('system.status:', await win.evaluate(() => window.workspace.system.status()).catch((e) => String(e)))
say('lok.available:', await win.evaluate(() => window.workspace.lok?.available?.()).catch((e) => String(e)))

await win.evaluate(() => {
  const K = 'workspace-os:settings'
  const c = JSON.parse(localStorage.getItem(K) || '{}')
  localStorage.setItem(K, JSON.stringify({ ...c, newShell: true }))
})
await win.reload()
await win.waitForSelector('#root', { timeout: 30000 })
await win.waitForTimeout(1500)

await win.evaluate(() => {
  const h = [...document.querySelectorAll('button,[role=tab],a,[role=button]')].find(
    (e) => /files/i.test(e.textContent || '') || /files/i.test(e.getAttribute('aria-label') || ''),
  )
  if (h) h.click()
})
await win.waitForTimeout(1800)

const B = '[data-testid="file-browser"]'
await win.click(`${B} [class*=nameText]:has-text("Reports")`).catch((e) => say('reports click:', e.message))
await win.waitForTimeout(1200)
await win
  .click(`${B} [class*=nameText]:has-text("Quarterly Review")`)
  .catch((e) => say('doc click failed:', e.message))

for (let i = 0; i < 14; i++) {
  await win.waitForTimeout(3000)
  const parts = await win.evaluate(() => window.workspace.lok?.parts?.()).catch((e) => String(e))
  say(`  +${(i + 1) * 3}s parts=`, parts)
  if (parts && parts.parts > 0) {
    say('ENGINE OPENED THE DOCUMENT')
    break
  }
}

// How long until the canvas actually PAINTS? parts>0 only means the engine
// parsed the file; the tiles arrive later, and the recording filmed the gap.
for (let i = 0; i < 40; i++) {
  const state = await win
    .evaluate(() => {
      const host = document.querySelector('[class*=peekHost]') || document.body
      const rendering = /Rendering/i.test(host.innerText || '')
      const c = document.querySelector('canvas')
      let painted = false
      if (c) {
        try {
          const g = c.getContext('2d')
          const d = g.getImageData(Math.floor(c.width / 2), 0, 1, Math.min(c.height, 400)).data
          for (let k = 0; k < d.length; k += 4) {
            if (d[k] !== d[0] || d[k + 1] !== d[1] || d[k + 2] !== d[2]) { painted = true; break }
          }
        } catch { /* tainted or no 2d context */ }
      }
      return { rendering, hasCanvas: !!c, painted, w: c?.width ?? 0, h: c?.height ?? 0 }
    })
    .catch((e) => ({ err: String(e) }))
  say(`  render +${i}s`, state)
  if (state && !state.rendering && state.painted) { say('CANVAS PAINTED'); break }
  await win.waitForTimeout(1000)
}

await win.screenshot({ path: `/tmp/diag-engine${useDemoHome ? '-demohome' : '-realhome'}.png` }).catch(() => {})
await app.close().catch(() => {})
clearTimeout(timer)
say('done')
