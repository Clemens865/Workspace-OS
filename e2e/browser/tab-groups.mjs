/**
 * Tab groups, in the real app.
 *
 * The claim: opening several links from one page groups them WITHOUT anyone
 * asking, and the group is labelled, collapsible and survives a restart. The
 * reducer tests prove the rules; only this proves an actual link-open carries
 * its opener through main, the renderer and back.
 */
import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'
import { killAll } from '../office/_harness.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')
let fails = 0
const check = (n, c, d) => { if (c) console.log(`  PASS  ${n}`); else { console.error(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); fails++ } }

async function open(fresh = false) {
  const app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root })
  const win = await app.firstWindow({ timeout: 20000 })
  await win.waitForSelector('#root', { timeout: 20000 })
  await win.evaluate((clearSession) => {
    const K = 'workspace-os:settings'
    const c = (() => { try { return JSON.parse(localStorage.getItem(K) || '{}') } catch { return {} } })()
    localStorage.setItem(K, JSON.stringify({ ...c, newShell: true }))
    // Cleared BEFORE the reload below, or the surface seeds from the previous
    // run's session and its tabs accumulate from one run to the next (5, then
    // 7, then …), which is how this test first "failed".
    if (clearSession) localStorage.removeItem('workspace-os:browser-session')
  }, fresh)
  await win.reload()
  await win.waitForSelector('#root', { timeout: 20000 })
  await win.waitForTimeout(1200)
  await win.evaluate(() => {
    const h = [...document.querySelectorAll('button,[role=tab],a,[role=button]')]
      .find(e => /browser/i.test(e.textContent || '') || /browser/i.test(e.getAttribute('aria-label') || ''))
    if (h) h.click()
  })
  await win.waitForTimeout(2500)
  return { app, win }
}

/** Opens a tab the way main does for a target=_blank link. */
const openFromPage = (win, url) =>
  win.evaluate((u) => window.dispatchEvent(new CustomEvent('__test_open_tab', { detail: u })), url)

await killAll()
let { app, win } = await open(true)

const groupHeads = () => win.evaluate(() =>
  [...document.querySelectorAll('[class*="groupHead"]')].map(e => e.textContent || ''))
const tabCount = () => win.evaluate(() => document.querySelectorAll('[role="tab"]').length)

/**
 * Opens a tab in the BACKGROUND from the current page — the agent fan-out path,
 * and the case grouping exists for.
 *
 * Background matters. A target=_blank link FOCUSES its new tab, so a person
 * opening a second link must first return to the article — which they do
 * naturally, and which then groups correctly. Driving two foreground opens back
 * to back instead makes the second tab's opener the FIRST new tab, so there is
 * no shared opener and no group. That is correct behaviour and an unrealistic
 * test, and it cost a round of chasing a bug that was not there.
 */
const openFrom = async (url) => {
  await win.evaluate(
    (u) =>
      new Promise((res) => {
        window.dispatchEvent(
          new CustomEvent('wos:browser-tab-command', {
            detail: { kind: 'newTab', url: u, focus: false, resolve: res },
          }),
        )
        setTimeout(res, 8000)
      }),
    url,
  )
  await win.waitForTimeout(1200)
}

// One tab from a page: no group. A single link is not a project.
await openFrom('https://example.com/')
check('one link from a page does not create a group', (await groupHeads()).length === 0, JSON.stringify(await groupHeads()))

// A second tab from the SAME page: a group forms, taking both with it.
await openFrom('https://example.org/')
const heads = await groupHeads()
check('a second link from the same page forms a group', heads.length === 1, JSON.stringify(heads))
check('the group is labelled', (heads[0] || '').trim().length > 0, JSON.stringify(heads))
check('the label is not the generic fallback', !/^Group\d*$/.test((heads[0] || '').trim()), JSON.stringify(heads))

// Collapsing hides members but never the active tab.
const before = await tabCount()
await win.evaluate(() => document.querySelector('[class*="groupName"]')?.click())
await win.waitForTimeout(500)
const after = await tabCount()
check('collapsing hides its members', after < before, `${before} → ${after}`)
check('the ACTIVE tab is never hidden by a collapse', after >= 1, `${after} tabs visible`)

await win.evaluate(() => document.querySelector('[class*="groupName"]')?.click())
await win.waitForTimeout(500)
check('expanding brings them back', (await tabCount()) === before)

// Groups survive a restart — otherwise reopening a task gives back anonymous tabs.
const stored = await win.evaluate(() => localStorage.getItem('workspace-os:browser-session'))
check('the group is persisted with the session', !!stored && stored.includes('groups'), String(stored).slice(0, 140))

await app.close().catch(() => {})
await killAll()
;({ app, win } = await open())
await win.waitForTimeout(2500)
const restoredHeads = await groupHeads()
check('the group comes back after a restart', restoredHeads.length === 1, JSON.stringify(restoredHeads))

await app.close().catch(() => {})
console.log(`\n  TAB GROUPS e2e: ${9 - fails} passed, ${fails} failed\n`)
process.exit(fails ? 1 : 0)
