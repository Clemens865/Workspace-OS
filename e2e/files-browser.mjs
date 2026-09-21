/**
 * WOS-013: the Files surface as a real file browser.
 *
 * The pure rules — ordering, kind buckets, filters, back/forward — are covered
 * by fileBrowserModel.test.ts. What only the running app can prove is that the
 * listing is fed by REAL stat data: `fs:read-dir` returned nothing but
 * name/path/isDirectory before this, which is exactly why the order was
 * hardcoded. So this test builds a folder on disk with known sizes and
 * deliberately staggered timestamps, then checks the app sorts by them.
 */
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { killAll } from './office/_harness.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const WS = '/tmp/wos-files-e2e'

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

// ── a workspace with known sizes and known ages ──────────────────────────────
fs.rmSync(WS, { recursive: true, force: true })
fs.mkdirSync(path.join(WS, 'Clients', 'Acme'), { recursive: true })
const DAY = 86_400_000
const now = Date.now()
const files = [
  { name: 'tiny.txt', size: 10, age: 0 },
  { name: 'huge.txt', size: 60_000, age: 40 * DAY },
  { name: 'Budget.xlsx', size: 4_000, age: 2 * DAY },
  { name: 'Deck.pptx', size: 2_000, age: 90 * DAY },
]
for (const f of files) {
  const p = path.join(WS, f.name)
  fs.writeFileSync(p, 'x'.repeat(f.size))
  const t = new Date(now - f.age)
  fs.utimesSync(p, t, t)
}
fs.writeFileSync(path.join(WS, 'Clients', 'Acme', 'nested.docx'), 'x')

await killAll()
const app = await electron.launch({
  args: [path.join(root, 'out/main/index.js')],
  cwd: root,
  env: { ...process.env, WORKSPACE_TEST_ROOT: WS },
})
const win = await app.firstWindow({ timeout: 20000 })
await win.waitForSelector('#root', { timeout: 20000 })
await win.evaluate(() => {
  const K = 'workspace-os:settings'
  const c = (() => {
    try {
      return JSON.parse(localStorage.getItem(K) || '{}')
    } catch {
      return {}
    }
  })()
  localStorage.setItem(K, JSON.stringify({ ...c, newShell: true }))
  // The view mode persists across runs and localStorage is shared between e2e
  // suites, so a previous run leaving it on 'column' silently breaks every
  // assertion here. Pin the view this test is about.
  localStorage.setItem('workspace-os:files-view', 'list')
})
await win.reload()
await win.waitForSelector('#root', { timeout: 20000 })
await win.waitForTimeout(1400)

try {
  // ── the IPC actually carries stat data now ────────────────────────────────
  const listing = await win.evaluate((dir) => window.workspace.fs.readDir(dir), WS)
  const budget = listing.find((e) => e.name === 'Budget.xlsx')
  check('fs:read-dir returns a size', budget?.size === 4000, JSON.stringify(budget))
  check('fs:read-dir returns a modified time', typeof budget?.mtimeMs === 'number' && budget.mtimeMs > 0)
  check(
    'a directory is still marked as one',
    listing.find((e) => e.name === 'Clients')?.isDirectory === true,
  )

  // ── reach the Files surface ───────────────────────────────────────────────
  await win.evaluate(() => {
    const h = [...document.querySelectorAll('button,[role=tab],a,[role=button]')].find(
      (e) => /files/i.test(e.textContent || '') || /files/i.test(e.getAttribute('aria-label') || ''),
    )
    if (h) h.click()
  })
  await win.waitForTimeout(1800)

  const present = await win.isVisible('[data-testid="file-browser"]').catch(() => false)
  check('the folder browser replaced the "select a file" dead end', present)
  if (!present) throw new Error('no browser')

  /** Row names in the order the browser is showing them. */
  const names = () =>
    win.evaluate(() =>
      [...document.querySelectorAll('[data-testid="file-browser"] [class*=nameText]')].map((n) =>
        n.textContent.trim(),
      ),
    )

  const initial = await names()
  check('the folder is listed', initial.includes('Budget.xlsx'), initial.join(', '))
  check('folders come first', initial[0] === 'Clients', initial.join(', '))

  // ── sorting on real stat data ─────────────────────────────────────────────
  await win.click('[data-testid="file-browser"] button[aria-label="Sort by size"]')
  await win.waitForTimeout(400)
  const bySize = (await names()).filter((n) => n !== 'Clients')
  check('sorting by size puts the largest first', bySize[0] === 'huge.txt', bySize.join(', '))
  check('…and the smallest last', bySize[bySize.length - 1] === 'tiny.txt', bySize.join(', '))

  await win.click('[data-testid="file-browser"] button[aria-label="Sort by size"]')
  await win.waitForTimeout(400)
  const bySizeAsc = (await names()).filter((n) => n !== 'Clients')
  check('clicking the same column reverses it', bySizeAsc[0] === 'tiny.txt', bySizeAsc.join(', '))

  await win.click('[data-testid="file-browser"] button[aria-label="Sort by date modified"]')
  await win.waitForTimeout(400)
  const byDate = (await names()).filter((n) => n !== 'Clients')
  check('sorting by date puts the newest first', byDate[0] === 'tiny.txt', byDate.join(', '))
  check('…and the oldest last', byDate[byDate.length - 1] === 'Deck.pptx', byDate.join(', '))

  // ── filters ───────────────────────────────────────────────────────────────
  await win.click('[data-testid="file-browser"] button:has-text("Spreadsheet")')
  await win.waitForTimeout(400)
  const spreadsheets = await names()
  check('filtering by kind keeps the spreadsheet', spreadsheets.includes('Budget.xlsx'))
  check('…and drops the others', !spreadsheets.includes('huge.txt'), spreadsheets.join(', '))
  check(
    'but KEEPS the folder — it is the route to matches further down',
    spreadsheets.includes('Clients'),
    spreadsheets.join(', '),
  )

  await win.click('[data-testid="file-browser"] button[aria-label="Clear filters"]')
  await win.waitForTimeout(400)
  check('clearing brings everything back', (await names()).length === initial.length)

  await win.fill('[data-testid="file-browser"] input[aria-label="Filter this folder"]', 'deck')
  await win.waitForTimeout(400)
  check('the name filter narrows to the match', (await names()).join(',') === 'Deck.pptx', (await names()).join(','))
  await win.fill('[data-testid="file-browser"] input[aria-label="Filter this folder"]', '')
  await win.waitForTimeout(400)

  // ── entering a folder, breadcrumb, back/forward ───────────────────────────
  // Click the NAME cell, not `[class*=row]` — that also matches the `.rows`
  // container, and Playwright picks the first match, which is the scroller.
  await win.click('[data-testid="file-browser"] [class*=nameText]:has-text("Clients")')
  await win.waitForTimeout(700)
  check('clicking a folder enters it', (await names()).includes('Acme'), (await names()).join(', '))

  await win.click('[data-testid="file-browser"] [class*=nameText]:has-text("Acme")')
  await win.waitForTimeout(700)
  check('and again, deeper', (await names()).includes('nested.docx'), (await names()).join(', '))

  const crumbCount = await win.evaluate(
    () => document.querySelectorAll('[data-testid="file-browser"] nav[aria-label="Breadcrumb"] button').length,
  )
  check('the breadcrumb shows the whole path', crumbCount === 3, `${crumbCount} crumbs`)

  await win.click('[data-testid="file-browser"] button[aria-label="Back"]')
  await win.waitForTimeout(700)
  check('Back returns to the parent folder', (await names()).includes('Acme'))

  await win.click('[data-testid="file-browser"] button[aria-label="Forward"]')
  await win.waitForTimeout(700)
  check('Forward goes in again', (await names()).includes('nested.docx'))

  // A breadcrumb click jumps straight home.
  await win.click('[data-testid="file-browser"] nav[aria-label="Breadcrumb"] button >> nth=0')
  await win.waitForTimeout(700)
  check('a breadcrumb click jumps back to the root', (await names()).includes('Budget.xlsx'))
} finally {
  try {
    await app.close()
  } catch {
    /* already gone */
  }
  await killAll()
}

console.log(`\n  FILES-BROWSER e2e: ${total - fails} passed, ${fails} failed\n`)
process.exit(fails ? 1 : 0)
