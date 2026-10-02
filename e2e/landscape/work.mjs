/**
 * Landscape phase 5 (docs/landscape/PLAN.md §5a, P2 item 9): cases, case
 * folders, sub-projects, pause/resume, in the real app and a throwaway
 * workspace (WORKSPACE_TEST_ROOT). Every check reads the disk or the store,
 * not just the screen.
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

const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wos-work-')))
await killAll()
const app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root, env: { ...process.env, WORKSPACE_TEST_ROOT: ws } })
const win = await app.firstWindow({ timeout: 20000 })
win.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`))
await win.waitForSelector('#root', { timeout: 20000 })
// The review store lives in localStorage: save the user's, restore it after.
const saved = await win.evaluate(() => JSON.stringify({ ...localStorage }))
await win.evaluate(() => {
  const K = 'workspace-os:settings'
  let c = {}
  try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* fresh */ }
  localStorage.setItem(K, JSON.stringify({ ...c, startOn: 'landscape', terminalOpen: false }))
  localStorage.removeItem('workspace-os:project-home')
})
await win.reload()
await win.waitForSelector('[data-shell="landscape"]', { timeout: 20000 })
for (let i = 0; i < 40 && (await win.$('[class*="_splash_"]')); i++) {
  await win.keyboard.press('Enter').catch(() => {})
  await win.waitForTimeout(400)
}
await win.waitForTimeout(1000)
const settle = (ms = 800) => win.waitForTimeout(ms)
const view = () => win.getAttribute('[data-shell="landscape"]', 'data-view')

try {
  // ── Cases ──
  const c = await win.evaluate(() => window.workspace.cases.create({ title: 'Onboarding research', type: 'task', description: 'Find a clearer first experience' }))
  await win.click('[data-dock="cases"]')
  await settle(1200)
  check('Cases opens in the landscape', (await view()) === 'cases')
  check('the shelf lists the case', !!(await win.$(`[data-case="${c.id}"]`)))
  check('the case opens with its description', ((await win.textContent('[data-testid="case-open"]')) ?? '').includes('Find a clearer first experience'))

  await win.click('[data-tab="notes"]')
  await win.fill('[data-testid="case-note"]', 'Focus on first-time users')
  await win.click('[data-testid="case-note-send"]')
  await settle()
  const noted = await win.evaluate((id) => window.workspace.cases.get(id), c.id)
  check('a note is written to the case file', noted.notes.some((n) => n.text === 'Focus on first-time users' && n.author === 'you'))

  await win.selectOption('[data-testid="case-status"]', 'in-progress')
  await settle()
  check('the status is written to the case file', (await win.evaluate((id) => window.workspace.cases.get(id), c.id)).status === 'in-progress')

  // ── the case folder ──
  await win.click('[data-testid="case-folder"]')
  await settle(1000)
  const folder = path.join(ws, 'Work', c.id)
  check('the case folder exists with sources, drafts, outputs', ['sources', 'drafts', 'outputs'].every((p) => fs.existsSync(path.join(folder, p))))
  check('…and opens in Files on the stage', (await view()) === 'stage')
  await win.click('[data-testid="stage-landscape"]')
  await settle()

  // ── accept a draft into outputs ──
  fs.writeFileSync(path.join(folder, 'drafts', 'findings.md'), '# Findings\n')
  await win.evaluate(({ id, rel }) => window.workspace.cases.addArtifact(id, rel), { id: c.id, rel: `Work/${c.id}/drafts/findings.md` })
  await win.click('[data-dock="overview"]')
  await settle(400)
  await win.click('[data-dock="cases"]')
  await settle(1200)
  await win.click('[data-tab="files"]')
  await win.click('[data-testid="case-accept"]')
  await settle(1000)
  check('Accept moves the draft to outputs on disk', fs.existsSync(path.join(folder, 'outputs', 'findings.md')) && !fs.existsSync(path.join(folder, 'drafts', 'findings.md')))
  const after = await win.evaluate((id) => window.workspace.cases.get(id), c.id)
  check('…and the case points at its new place', after.artifacts.includes(`Work/${c.id}/outputs/findings.md`), JSON.stringify(after.artifacts))

  // ── B3: the Cockpit's case tools in the landscape (ADOPTION.md) ──
  fs.writeFileSync(path.join(folder, 'outputs', 'budget.csv'), 'item,amount\nseats,1200\nhosting,300\ntravel,450\n')
  await win.evaluate(({ id, rel }) => window.workspace.cases.addArtifact(id, rel), { id: c.id, rel: `Work/${c.id}/outputs/budget.csv` })
  await win.click('[data-dock="overview"]')
  await settle(400)
  await win.click('[data-dock="cases"]')
  await settle(1200)
  await win.click('[data-tab="data"]')
  await win.waitForSelector('[data-testid="case-data"]', { timeout: 8000 }).catch(() => {})
  const dataText = (await win.textContent('[data-testid="case-data"]').catch(() => '')) ?? ''
  check('the Data tab reads the case’s numbers', dataText.includes('budget.csv') && /1[.,]?200|seats/.test(dataText), dataText.slice(0, 120))

  await win.click('[data-tab="overview"]')
  await settle(500)
  check('Overview offers to hand the case to an agent', !!(await win.$('[data-testid="case-actions"] textarea')))
  await win.click('[data-scope="global"]')
  await settle(900)
  check('Lives in → Everywhere writes the scope', (await win.evaluate((id) => window.workspace.cases.get(id), c.id))?.scope === 'global')
  await win.click('[data-scope="workspace"]')
  await settle(900)
  check('…and back to this workspace', ((await win.evaluate((id) => window.workspace.cases.get(id), c.id))?.scope ?? 'workspace') === 'workspace')

  await win.click('[data-testid="case-new"]')
  await win.fill('input[placeholder="e.g. Steuer 2025"]', 'Pilot rollout')
  await win.keyboard.press('Enter')
  await settle(1200)
  const made = (await win.evaluate(() => window.workspace.cases.list())).find((x) => x.title === 'Pilot rollout')
  check('New case creates a case', !!made)
  check('…and opens it on the shelf', !!made && (await win.getAttribute('[data-testid="case-open"]', 'data-case')) === made.id)

  await win.click('[data-mode="map"]')
  await settle(1500)
  const mapText = (await win.textContent('[data-testid="cases-view"]')) ?? ''
  check('Map shows the cases as territories', (await win.getAttribute('[data-testid="cases-view"]', 'data-mode')) === 'map' && mapText.includes('Onboarding research'), mapText.slice(0, 120))
  await win.click('[data-mode="board"]')
  await settle(1500)
  const boardText = (await win.textContent('[data-testid="cases-view"]')) ?? ''
  check('Board shows the cases by stage', (await win.getAttribute('[data-testid="cases-view"]', 'data-mode')) === 'board' && boardText.includes('Pilot rollout'), boardText.slice(0, 160))
  await win.click('[data-mode="shelf"]')
  await settle(600)

  // ── sub-projects ──
  await win.click('[data-dock="overview"]')
  await settle(400)
  await win.click('[data-testid="project-pill"]')
  await settle(400)
  check('the project menu offers the workspace itself', ((await win.textContent('[data-testid="project-menu"]')) ?? '').includes('All projects'))
  await win.fill('[data-testid="project-new"]', 'Website launch')
  await win.press('[data-testid="project-new"]', 'Enter')
  await settle(2000)
  const sub = path.join(ws, 'Website launch')
  check('a sub-project is created with its marker, Cases and Work', ['.workspace-os/project.json', 'Cases', 'Work'].every((p) => fs.existsSync(path.join(sub, p))))
  const rootNow = await win.evaluate(() => window.workspace.fs.getWorkspaceRoot())
  check('…and opened as the workspace', rootNow === sub, rootNow)
  await win.waitForSelector('[data-testid="project-pill"]', { timeout: 8000 })
  await settle(800)
  check('the pill names the sub-project', ((await win.textContent('[data-testid="project-pill"]')) ?? '').includes('Website launch'))
  await win.click('[data-testid="project-pill"]')
  await settle(400)
  await win.click(`[data-project="${ws}"]`)
  await settle(2000)
  check('All projects returns to the parent workspace', (await win.evaluate(() => window.workspace.fs.getWorkspaceRoot())) === ws)

  // ── pause / resume ──
  const roster = await win.evaluate(() => window.workspace.agents.list())
  if (roster.length) {
    const A = roster[0].name
    await win.evaluate((A) => {
      window.__reviewStore.openRun({ runId: 'e2e-pause', sessionId: 'e2e-pause-s', sessionName: A, agentName: A, prompt: 'Long research task', mode: 'safe', checkpointId: null })
    }, A)
    await settle()
    await win.evaluate((A) => document.querySelector(`[data-agent="${CSS.escape(A)}"] [data-testid="agent-face"]`)?.click(), A)
    await settle(1500)
    // B3: the focused agent shows what its run has cost so far.
    await win.evaluate(() => window.__reviewStore.patchRun('e2e-pause', { turns: 3, costUsd: 0.42 }))
    await settle(400)
    const stakes = (await win.textContent('[data-testid="agent-stakes"]').catch(() => '')) ?? ''
    check('the focused agent shows turns and cost', stakes.includes('3 turns') && stakes.includes('$0.42'), stakes)
    await win.click('[data-testid="agent-pause"]')
    await win.waitForTimeout(5000) // no real process: the pause lands on its 4 s fallback
    const st = await win.evaluate(() => window.__reviewStore.getSnapshot().runs.find((r) => r.runId === 'e2e-pause')?.status)
    check('Pause marks the run paused (not failed)', st === 'paused', st)
    check('…and the screen says Paused', (await win.getAttribute(`[data-agent="${A.replace(/"/g, '\\"')}"] [data-status]`, 'data-status')) === 'paused')
    await win.keyboard.press('Escape')
    await win.click('[data-dock="inbox"]')
    await settle()
    check('the paused run waits in the Inbox', !!(await win.$('[data-inbox="paused:e2e-pause"]')))
    await win.click('[data-inbox="paused:e2e-pause"]')
    await win.click('[data-testid="inbox-resume"]')
    await settle(2500)
    const msg = (await win.textContent('[data-testid="inbox-main"]').catch(() => '')) ?? ''
    // This run never had a provider session: resume must refuse, not start over.
    check('Resume refuses honestly when there is no session to continue', /no longer available|not available|conversation/i.test(msg), msg.slice(-160))
  } else console.log('  SKIP  pause/resume: no agents')
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
