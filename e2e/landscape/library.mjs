/**
 * Landscape adoption B4 exit test (docs/landscape/ADOPTION.md): the Library
 * holds files, notes and memory in the landscape.
 *
 * In the real app, in a throwaway workspace: the dock opens the Library;
 * search finds a file by name and another by what is in it, and a result
 * opens on the stage; "Browse all files" opens the Files surface; Notes lists
 * the workspace's notes by links and the notes referenced but not written;
 * Memory remembers a line typed into it (read back from the memory store).
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

const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wos-library-')))
fs.mkdirSync(path.join(ws, 'Pilot'))
fs.writeFileSync(path.join(ws, 'Pilot', 'Rollout plan.md'), '# Rollout plan\n\nSee [[Budget]] and [[Risks]].\n')
fs.writeFileSync(path.join(ws, 'Budget.md'), '# Budget\n\nThe seat price is quokka-priced at 12 per seat. Back to [[Rollout plan]].\n')
fs.writeFileSync(path.join(ws, 'Minutes.txt'), 'Nothing here.\n')

await killAll()
const app = await electron.launch({ args: [path.join(root, 'out/main/index.js')], cwd: root, env: { ...process.env, WORKSPACE_TEST_ROOT: ws } })
const win = await app.firstWindow({ timeout: 20000 })
win.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`))
await win.waitForSelector('#root', { timeout: 20000 })
const saved = await win.evaluate(() => JSON.stringify({ ...localStorage }))
await win.evaluate(() => {
  const K = 'workspace-os:settings'
  let c = {}
  try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* fresh */ }
  localStorage.setItem(K, JSON.stringify({ ...c, startOn: 'landscape', terminalOpen: false }))
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
  await win.click('[data-dock="library"]')
  await settle()
  check('the dock opens the Library in the landscape', (await view()) === 'library' && (await win.getAttribute('[data-testid="library-view"]', 'data-tab')) === 'files')

  // ── search by name ──
  await win.fill('[data-testid="library-search"]', 'rollout')
  await win.waitForSelector('[data-library-file="Rollout plan.md"]', { timeout: 5000 }).catch(() => {})
  check('search finds a file by its name', !!(await win.$('[data-library-file="Rollout plan.md"]')))
  const where = await win.textContent('[data-library-file="Rollout plan.md"]').catch(() => '')
  check('…and says where it lives', (where ?? '').includes('Pilot'), where)

  // ── search by content (the search index) ──
  await win.evaluate(() => window.workspace.search.start().catch(() => {}))
  let found = false
  for (let i = 0; i < 20 && !found; i++) {
    await win.fill('[data-testid="library-search"]', '')
    await win.fill('[data-testid="library-search"]', 'quokka')
    await win.waitForTimeout(700)
    found = !!(await win.$('[data-library-file="Budget.md"]'))
  }
  check('search finds a file by what is in it', found)

  // ── open a result on the stage ──
  await win.fill('[data-testid="library-search"]', 'rollout')
  await win.waitForSelector('[data-library-file="Rollout plan.md"]', { timeout: 5000 }).catch(() => {})
  await win.click('[data-library-file="Rollout plan.md"]')
  await settle(1200)
  const tab = await win.evaluate(() => [...document.querySelectorAll('[class*="_tabOn_"]')].map((t) => t.textContent).join('|'))
  check('a result opens on the stage', (await view()) === 'stage' && tab.includes('Rollout plan'), `${await view()} ${tab}`)
  await win.click('[data-stage-dock="library"]')
  await settle()
  check('the stage topbar leads back to the Library', (await view()) === 'library')

  await win.click('[data-testid="library-browse"]')
  await settle(1000)
  const rail = await win.evaluate(() => document.querySelector('[data-testid="stage-surface-tab"]')?.textContent ?? document.querySelector('nav[aria-label="Primary"] [aria-current="page"]')?.getAttribute('title'))
  check('Browse all files opens Files on the stage', (await view()) === 'stage' && rail === 'Files', `${await view()} ${rail}`)
  await win.click('[data-stage-dock="library"]')
  await settle()

  // ── notes ──
  await win.click('[data-switch="notes"]')
  await win.waitForSelector('[data-note]', { timeout: 6000 }).catch(() => {})
  const notes = await win.$$eval('[data-note]', (els) => els.map((e) => e.getAttribute('data-note')))
  check('Notes lists the workspace notes, and only those', notes.length === 3 && ['Budget.md', 'Rollout plan.md', 'Minutes.txt'].every((n) => notes.includes(n)), notes.slice(0, 6).join(','))
  const notesText = (await win.textContent('[data-testid="library-notes"]')) ?? ''
  check('…and the ones referenced but not written', notesText.includes('Risks'), notesText.slice(-120))

  // ── memory ──
  await win.click('[data-switch="memory"]')
  await settle()
  // (the stage's own Memory panel is mounted too, hidden: scope to the Library)
  await win.fill('[data-testid="library-memory"] input[placeholder="Tell it something worth remembering…"]', 'The pilot starts with three teams')
  await win.click('[data-testid="library-memory"] button:has-text("Remember")')
  await settle(1200)
  const mem = await win.evaluate(() => window.workspace.memory.listMemories({ limit: 20 }))
  check('Memory remembers what is typed into it', mem.some((m) => m.text.includes('three teams')), JSON.stringify(mem.map((m) => m.text)))
  check('…and shows it', ((await win.textContent('[data-testid="library-memory"]')) ?? '').includes('three teams'))
} catch (e) {
  check('run completed', false, e.message)
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
