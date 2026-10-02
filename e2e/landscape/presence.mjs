/**
 * Landscape phase 2 exit test (docs/landscape/PLAN.md §7): agent presence and
 * the team overview, in the real app, against the real roster.
 *
 * It seeds a run for the first roster agent through the review store's e2e
 * handle (window.__reviewStore) and walks it through every state the screens
 * show: working → needs your answer (a PTY approval) → approved, working
 * again → ready for review → kept, idle. Along the way: the screen and the
 * header summary must say exactly that, the agent must move to the front row,
 * the focused screen must offer the matching action, and ← → / Esc must turn
 * the ring and step back. The user's own runs are saved first and restored.
 *
 * Run: npm run e2e:landscape
 */
import { _electron as electron } from 'playwright'
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

await killAll()
const app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root })
const win = await app.firstWindow({ timeout: 20000 })
win.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`))
await win.waitForSelector('#root', { timeout: 20000 })

// Save the user's review history; the test writes to the same store.
const saved = await win.evaluate(() => {
  const out = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith('workspace-os:review-runs')) out[k] = localStorage.getItem(k)
  }
  const K = 'workspace-os:settings'
  let c = {}
  try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* fresh */ }
  localStorage.setItem(K, JSON.stringify({ ...c, newShell: true, landscapeShell: true, terminalOpen: false }))
  return out
})
await win.reload()
await win.waitForSelector('[data-shell="landscape"]', { timeout: 20000 })
for (let i = 0; i < 40 && (await win.$('[class*="_splash_"]')); i++) {
  await win.keyboard.press('Enter').catch(() => {})
  await win.waitForTimeout(400)
}
await win.waitForTimeout(1200)

const roster = await win.evaluate(() => window.workspace.agents.list())
if (!roster.length) {
  console.log('  SKIP  no agents in ~/.claude/agents or the workspace; nothing to show')
  await app.close()
  process.exit(0)
}
const agent = roster[0].name
const screen = (sel = '') => `[data-agent="${agent.replace(/"/g, '\\"')}"]${sel}`
const statusOf = () => win.getAttribute(screen(' [data-status]'), 'data-status').catch(() => null)
const summary = () => win.textContent('[data-testid="team-summary"]').catch(() => '')
const frontIndex = () => win.getAttribute(screen(), 'data-front-index').then(Number).catch(() => -1)
const settle = () => win.waitForTimeout(700)

/** Click the agent's screen where it actually is (it may sit near an edge). */
const openScreen = async () => {
  await win.evaluate((sel) => document.querySelector(sel)?.click(), screen(' [data-testid="agent-face"]'))
  await win.waitForTimeout(1500)
}

try {
  check('screens show the roster, all honest at rest', (await win.$$('[data-testid="agent-face"]')).length === roster.length)

  // ── working ──
  await win.evaluate((name) => {
    window.__reviewStore.openRun({ runId: 'e2e-land-1', sessionId: 'e2e-land-s', sessionName: name, agentId: 'e2e-land-s', agentName: name, prompt: 'E2E landscape probe: compare two onboarding flows', mode: 'full', checkpointId: null })
  }, agent)
  await settle()
  check('a running run → the screen says Working', (await statusOf()) === 'working', await statusOf())
  check('…and the agent moves to the front', (await frontIndex()) === 0, String(await frontIndex()))
  check('…and the header counts it', /1 working/.test(await summary()), await summary())
  check('the task shows on the screen', ((await win.textContent(screen())) ?? '').includes('E2E landscape probe'))

  // ── needs your answer ──
  await win.evaluate((name) => {
    window.__e2eDecision = null
    window.__reviewStore.setHitl(
      { sessionId: 'e2e-land-s', sessionName: name, kind: 'command', question: 'Allow the e2e probe to run a command?', createdAt: Date.now() },
      (d) => (window.__e2eDecision = d),
    )
  }, agent)
  await settle()
  check('a pending approval → Needs your answer', (await statusOf()) === 'question', await statusOf())
  check('…and the header says 1 question', /1 question/.test(await summary()), await summary())
  await openScreen()
  check('choosing the screen focuses it', (await win.getAttribute('[data-shell="landscape"]', 'data-view')) === 'agent')
  const focus = await win.textContent('[data-testid="agent-focus"]')
  check('the focused screen shows the question verbatim', focus.includes('Allow the e2e probe to run a command?'))
  await win.click('[data-testid="agent-focus"] button:has-text("Allow once")')
  await settle()
  check('Allow once reaches the session that asked', (await win.evaluate(() => window.__e2eDecision)) === 'allow-once')
  check('…and the agent is back to Working', (await statusOf()) === 'working', await statusOf())

  // ── ready for review → keep ──
  await win.evaluate(() => {
    window.__reviewStore.patchRun('e2e-land-1', { status: 'pending', resolvedAt: Date.now(), artifacts: [{ path: '/tmp/e2e-landscape-result.md', name: 'e2e-landscape-result.md', type: 'md' }] })
  })
  await settle()
  check('a finished run → Ready for review', (await statusOf()) === 'review', await statusOf())
  const f2 = await win.textContent('[data-testid="agent-focus"]').catch(() => '')
  check('the focused screen lists the result file', f2.includes('e2e-landscape-result.md'))
  await win.click('[data-testid="agent-focus"] button:has-text("Keep")')
  await settle()
  check('Keep resolves the run and the agent is idle again', (await statusOf()) === 'idle', await statusOf())
  const kept = await win.evaluate(() => window.__reviewStore.getSnapshot().runs.find((r) => r.runId === 'e2e-land-1')?.status)
  check('…recorded as kept in the review store', kept === 'kept', kept)

  // ── the ring ──
  if (roster.length > 1) {
    await win.keyboard.press('ArrowRight')
    await win.waitForTimeout(1200)
    const focused = await win.evaluate(() => document.querySelector('[data-testid="agent-focus"]')?.closest('[data-agent]')?.getAttribute('data-agent'))
    check('→ turns the ring to the next agent', !!focused && focused !== agent, focused)
  }
  await win.keyboard.press('Escape')
  await win.waitForTimeout(900)
  check('Esc steps back to the team overview', (await win.getAttribute('[data-shell="landscape"]', 'data-view')) === 'overview')

  // ── the carousel ──
  const xs = () => win.$$eval('[data-front-index="0"]', (els) => els.map((e) => e.getBoundingClientRect().left)[0])
  const before = await xs()
  await win.mouse.move(700, 450)
  await win.mouse.wheel(0, 120)
  await win.waitForTimeout(1300)
  const front = await win.$$eval('[data-front-index]', (els) => els.filter((e) => Number(e.getAttribute('data-front-index')) >= 0).length)
  const after = await xs()
  if (front > 7) check('the mouse wheel scrolls the row by one screen', Math.abs(after - before) > 40, `${before} → ${after}`)
  else check('a short row does not scroll', Math.abs(after - before) < 2, `${before} → ${after}`)
} finally {
  await win.evaluate((s) => {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && k.startsWith('workspace-os:review-runs')) localStorage.removeItem(k)
    }
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v)
    const K = 'workspace-os:settings'
    let c = {}
    try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* ignore */ }
    localStorage.setItem(K, JSON.stringify({ ...c, landscapeShell: false, newShell: true }))
  }, saved).catch(() => {})
  await app.close()
}

console.log(`\n${total - fails}/${total} passed`)
process.exit(fails ? 1 : 0)
