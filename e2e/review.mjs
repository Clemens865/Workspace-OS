/**
 * e2e smoke for the Agent Review surface (ContextHub "Living Feed").
 *
 * Launches the real Electron app against a throwaway workspace, opens the
 * Review view, seeds one reviewable run through the store's e2e hook
 * (window.__reviewStore) — no real agent needed — and asserts the card renders
 * and its three disclosure tiers (Glance → changes → full context) expand.
 *
 * Run with: node e2e/review.mjs   (after `npm run rebuild:electron` + `npm run build`)
 */
import { _electron as electron } from 'playwright'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const MAIN = path.join(root, 'out/main/index.js')

let failures = 0
function check(name, cond) {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.error(`  ✗ ${name}`); failures++ }
}

async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-review-'))
  fs.writeFileSync(path.join(ws, 'note.md'), '# hello\n')

  const app = await electron.launch({
    args: [MAIN],
    cwd: root,
    env: { ...process.env, WORKSPACE_TEST_ROOT: ws },
  })
  const win = await app.firstWindow()
  win.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForSelector('#root', { timeout: 10000 })

  // Open the Review view via its sidebar tab.
  await win.getByRole('button', { name: 'Review', exact: true }).first().click()
  await win.waitForSelector('[data-testid="review-feed"]', { timeout: 8000 })
  check('Review feed surface renders', true)

  // Start from a clean store (localStorage persists across launches).
  await win.evaluate(() => window.__reviewStore.reset())

  // Empty state first — the calm "you're caught up" reward.
  await win.waitForSelector('[data-testid="review-zero"]', { timeout: 5000 })
  const zero = await win.locator('[data-testid="review-zero"]').count()
  check('queue-zero state shows when nothing is pending', zero === 1)

  // Seed one reviewable run through the store's e2e hook.
  await win.evaluate(() => {
    const s = window.__reviewStore
    s.openRun({
      runId: 'e2e-run-1',
      sessionId: 'e2e',
      sessionName: 'Agent E2E',
      prompt: 'tidy up the report headings',
      mode: 'full',
      agentName: null,
    })
    s.patchRun('e2e-run-1', { status: 'pending', code: 0, checkpointId: 'abc1234', turns: 3, costUsd: 0.0123 })
  })

  const card = win.locator('[data-testid="review-card"]').first()
  await card.waitFor({ timeout: 8000 })
  check('a run renders as a feed card (Glance tier)', await card.isVisible())
  check('card shows the headline', (await card.innerText()).includes('tidy up the report headings'))

  // Tier 2 — draft (changes) expands inline (one tap).
  await win.getByText('Show changes', { exact: true }).first().click()
  await win.getByText('THE CHANGES THIS RUN MADE', { exact: false }).first().waitFor({ timeout: 5000 })
  check('draft/changes tier expands inline', true)

  // Tier 3 — full context expands inline (one more tap): the prompt.
  await win.getByText('Why this?', { exact: true }).first().click()
  await win.getByText('WHY THIS RUN EXISTS', { exact: false }).first().waitFor({ timeout: 5000 })
  check('full-context tier expands inline', true)

  // Equal-weight actions are both present.
  const txt = await card.innerText()
  check('Keep and Revert are both offered', txt.includes('Keep changes') && txt.includes('Revert'))

  await app.close().catch(() => {})
  fs.rmSync(ws, { recursive: true, force: true })

  console.log(failures === 0 ? '\nReview e2e: all checks passed' : `\nReview e2e: ${failures} failed`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })
