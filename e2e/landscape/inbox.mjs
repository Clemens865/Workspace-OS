/**
 * Landscape phases 4–5 (docs/landscape/PLAN.md §7): the Inbox and the screen
 * previews, in the real app, in a throwaway workspace (WORKSPACE_TEST_ROOT),
 * so the user's runs and files are never touched.
 *
 * Inbox: a question, a result and a failure, seeded through the review store's
 * e2e handle → the dock badge counts 3, questions come first, Allow once
 * reaches the asking session, the result shows its text in place, Revise arms
 * only with feedback, Mark accepted resolves it, Dismiss clears the failure.
 * (Revise and Start again are not pressed: they start a real agent run.)
 *
 * Previews: a working run's output appears on its screen with its time; when
 * its run drives the browser, the screen shows a real capture of the page,
 * stamped "captured hh:mm:ss"; a finished text result shows its opening lines.
 *
 * Run: npm run e2e:landscape
 */
import { _electron as electron } from 'playwright'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { killAll } from '../office/_harness.mjs'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')

let fails = 0
let total = 0
const check = (n, c, d) => {
  total++
  if (c) console.log(`  PASS  ${n}`)
  else {
    console.error(`  FAIL  ${n}${d ? ` — ${d}` : ''}`)
    fails++
  }
}

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-landscape-'))
const resultFile = path.join(ws, 'Launch plan.md')
fs.writeFileSync(resultFile, '# Launch plan\n\nWeek 1: closed beta with ten teams.\nWeek 2: open the waitlist.\n')

await killAll()
const app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root, env: { ...process.env, WORKSPACE_TEST_ROOT: ws } })
const win = await app.firstWindow({ timeout: 20000 })
win.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`))
await win.waitForSelector('#root', { timeout: 20000 })
// The review and mail stores live in localStorage: save the user's, restore them after.
const saved = await win.evaluate(() => JSON.stringify({ ...localStorage }))
await win.evaluate(() => {
  const K = 'workspace-os:settings'
  let c = {}
  try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* fresh */ }
  localStorage.setItem(K, JSON.stringify({ ...c, startOn: 'landscape', terminalOpen: false }))
  localStorage.removeItem('workspace-os:landscape-dismissed')
})
await win.reload()
await win.waitForSelector('[data-shell="landscape"]', { timeout: 20000 })
for (let i = 0; i < 40 && (await win.$('[class*="_splash_"]')); i++) {
  await win.keyboard.press('Enter').catch(() => {})
  await win.waitForTimeout(400)
}
await win.waitForTimeout(1200)

const roster = await win.evaluate(() => window.workspace.agents.list())
if (roster.length < 1) {
  console.log('  SKIP  no agents to attribute runs to')
  await app.close()
  process.exit(0)
}
const A = roster[0].name
const B = (roster[1] ?? roster[0]).name
const settle = () => win.waitForTimeout(700)

try {
  await win.evaluate(({ A, B, file }) => {
    const s = window.__reviewStore
    s.reset()
    // a result to review
    s.openRun({ runId: 'e2e-rev', sessionId: 'e2e-s-rev', sessionName: A, agentName: A, prompt: 'Draft the launch plan', mode: 'full', checkpointId: null })
    s.patchRun('e2e-rev', { status: 'pending', resolvedAt: Date.now() - 60_000, artifacts: [{ path: file, name: 'Launch plan.md', type: 'md' }] })
    // a live run that asks
    s.openRun({ runId: 'e2e-ask', sessionId: 'e2e-s-ask', sessionName: B, agentName: B, prompt: 'Run the test suite', mode: 'full', checkpointId: null })
    window.__e2eDecision = null
    s.setHitl({ sessionId: 'e2e-s-ask', sessionName: B, kind: 'command', question: 'Allow running npm test?', createdAt: Date.now() }, (d) => (window.__e2eDecision = d))
    // a failure (an agent with no later run)
    s.openRun({ runId: 'e2e-fail', sessionId: 'e2e-s-fail', sessionName: 'Probe', agentName: 'E2E probe agent', prompt: 'Fetch the report', mode: 'full', checkpointId: null })
    s.patchRun('e2e-fail', { status: 'error', resolvedAt: Date.now() })
  }, { A, B, file: resultFile })
  await settle()

  const badge = () => win.textContent('[data-testid="inbox-badge"]').catch(() => null)
  check('the dock badge counts what waits (3)', (await badge()) === '3', await badge())

  await win.click('[data-dock="inbox"]')
  await settle()
  const first = await win.getAttribute('[data-inbox]', 'data-kind')
  check('the Inbox opens with the question first', first === 'question', first)
  const main = await win.textContent('[data-testid="inbox-main"]')
  check('the question is shown verbatim', main.includes('Allow running npm test?'))
  await win.click('[data-testid="inbox-main"] button:has-text("Allow once")')
  await settle()
  check('Allow once reaches the asking session', (await win.evaluate(() => window.__e2eDecision)) === 'allow-once')
  check('…and the badge drops to 2', (await badge()) === '2', await badge())

  await win.click('[data-inbox="review:e2e-rev"]')
  await win.waitForTimeout(900)
  const reviewText = await win.textContent('[data-testid="inbox-main"]')
  check('a text result is readable in place', reviewText.includes('closed beta with ten teams'))
  check('Revise is disarmed until there is feedback', await win.isDisabled('[data-testid="inbox-revise"]'))
  await win.fill('[data-testid="inbox-feedback"]', 'Add week numbers to every line')
  check('…and arms with feedback', !(await win.isDisabled('[data-testid="inbox-revise"]')))
  await win.fill('[data-testid="inbox-feedback"]', '')
  await win.click('[data-testid="inbox-accept"]')
  await settle()
  const kept = await win.evaluate(() => window.__reviewStore.getSnapshot().runs.find((r) => r.runId === 'e2e-rev')?.status)
  check('Mark accepted keeps the run', kept === 'kept', kept)

  await win.click('[data-inbox="error:e2e-fail"]')
  await win.waitForTimeout(500)
  await win.click('[data-testid="inbox-dismiss"]')
  await settle()
  const count = await win.getAttribute('[data-testid="inbox-view"]', 'data-count')
  check('Dismiss clears the failure; the Inbox is empty', count === '0', count)
  check('…and says so', ((await win.textContent('[data-testid="inbox-view"]')) ?? '').includes('Nothing is waiting on you'))

  // ── mail waiting for a reply (ADOPTION.md B2) ──
  await win.evaluate(() => {
    const m = window.__mailReviewStore
    m.reset()
    m.ingestTriage('e2e-acct', 'INBOX', [{ folder: 'INBOX', uid: 9, subject: 'Can you send the deck?', from: { name: 'Dana', address: 'dana@example.com' }, reason: 'asks for a file', score: 80 }])
  })
  await settle()
  const mailCard = await win.$('[data-inbox^="mail:"]')
  check('mail waiting for a reply is in the Inbox', !!mailCard && (await mailCard.getAttribute('data-kind')) === 'mail')
  if (mailCard) {
    await mailCard.click()
    await win.waitForTimeout(500)
    const mainText = await win.textContent('[data-testid="inbox-main"]')
    check('…with its subject and why it needs you', mainText.includes('Can you send the deck?') && mainText.includes('asks for a file'), mainText)
    await win.click('[data-testid="inbox-dismiss-mail"]')
    await settle()
    const left = await win.evaluate(() => window.__mailReviewStore.getSnapshot().cards.find((c) => c.id.startsWith('e2e-acct'))?.status)
    check('Dismiss resolves the mail card', left === 'dismissed', left)
    check('…and it leaves the Inbox', !(await win.$('[data-inbox^="mail:"]')))
  }

  // ── History, the Inbox's second tab ──
  await win.click('[data-switch="history"]')
  await settle()
  const hist = await win.textContent('[data-testid="history-view"]').catch(() => '')
  check('History lists what happened, by day', /Today/i.test(hist) && hist.includes('Draft the launch plan'), hist.slice(0, 160))
  await win.click('[data-lens="agent"]')
  await win.waitForTimeout(400)
  const groups = await win.$$eval('[data-group]', (els) => els.map((e) => e.getAttribute('data-group')))
  check('…and regroups by agent', groups.includes(A), groups.join(','))
  await win.click('[data-switch="waiting"]')
  await settle()

  // ── previews ──
  await win.click('[data-dock="overview"]')
  await settle()
  await win.evaluate(() => window.__landscapeOutput.push('e2e-ask', 'Running 214 tests\nAll suites passed in 9.2 s\n'))
  await settle()
  const sel = `[data-agent="${B.replace(/"/g, '\\"')}"] [data-testid="screen-tail"]`
  const tail = await win.textContent(sel).catch(() => '')
  check("a working agent's screen shows its latest output", tail.includes('All suites passed'), tail)

  // A real page capture: give the browser a page, then let the run "drive" it.
  await win.click('[data-dock="menu"]')
  await settle()
  await win.click('[data-menu="browser"]')
  await win.waitForTimeout(2500)
  const canShoot = await win.evaluate(async () => {
    try { return (await window.workspace.browser.thumbnail(320)).ok } catch { return false }
  })
  await win.click('[data-testid="stage-landscape"]')
  await win.waitForTimeout(800)
  if (canShoot) {
    await win.evaluate(() => window.__browserDriver.record('e2e-ask', 'browser.navigate'))
    const shot = await win.waitForSelector(`[data-agent="${B.replace(/"/g, '\\"')}"] [data-testid="screen-shot"] img`, { timeout: 6000 }).catch(() => null)
    const src = shot ? await shot.getAttribute('src') : ''
    check('the screen shows a real capture of the page its run drives', !!src && src.startsWith('data:image/jpeg;base64,') && src.length > 1000, src?.slice(0, 40))
    const foot = await win.textContent(`[data-agent="${B.replace(/"/g, '\\"')}"]`)
    check('…stamped with the time it was captured', /captured \d{1,2}:\d{2}:\d{2}/.test(foot), foot)
  } else console.log('  SKIP  no browser page to capture on this machine')

  // An agent navigating the browser must not pull the stage over the landscape.
  const viewBefore = await win.getAttribute('[data-shell="landscape"]', 'data-view')
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('wos:browser-navigate')))
  await win.waitForTimeout(1200)
  const viewAfter = await win.getAttribute('[data-shell="landscape"]', 'data-view')
  check('an agent navigating keeps you in the landscape', viewBefore !== 'stage' && viewAfter === viewBefore, `${viewBefore} → ${viewAfter}`)

  // A finished text result previews its opening lines on the screen.
  await win.evaluate(({ A, file }) => {
    const s = window.__reviewStore
    s.openRun({ runId: 'e2e-rev2', sessionId: 'e2e-s-rev2', sessionName: A, agentName: A, prompt: 'Draft the launch plan again', mode: 'full', checkpointId: null })
    s.patchRun('e2e-rev2', { status: 'pending', resolvedAt: Date.now(), artifacts: [{ path: file, name: 'Launch plan.md', type: 'md' }] })
  }, { A, file: resultFile })
  await win.waitForTimeout(1200)
  const txt = await win.textContent(`[data-agent="${A.replace(/"/g, '\\"')}"] [data-testid="screen-result-text"]`).catch(() => '')
  check('a finished text result previews its opening lines', txt.includes('Launch plan'), txt)
} finally {
  await win
    .evaluate((saved) => {
      localStorage.clear()
      for (const [k, v] of Object.entries(JSON.parse(saved))) localStorage.setItem(k, v)
    }, saved)
    .catch(() => {})
  await app.close()
  fs.rmSync(ws, { recursive: true, force: true })
}

console.log(`\n${total - fails}/${total} passed`)
process.exit(fails ? 1 : 0)
