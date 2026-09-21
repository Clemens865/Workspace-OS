/**
 * Renders the film's cards — the intro, one per function, and the outro.
 *
 *   node scripts/demo/render-cards.mjs
 *
 * Output: build/demo/story/cards/<id>.mp4
 *
 * All in the chosen cinematic style, all beat-locked to the track: 90 BPM, so a
 * beat is 0.667s and a bar 2.667s. Interstitials run 1.5 bars, the intro and
 * outro 2, so every card is a whole number of bars and the film stays on grid
 * however the clips between them are trimmed.
 *
 * Each card is written to sit BEFORE the clips named in `covers`, which is how
 * the assembly knows the running order without a separate edit list.
 */
import { _electron as electron } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { renderCard, CARD_W, CARD_H } from './card-styles.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = path.join(ROOT, 'build/demo/story/cards')
const TMP = path.join(OUT, '_tmp')
const BAR = (60 / 90) * 4

/**
 * The voice is the product's own: plain, concrete, no adjectives doing work
 * that the footage does better. Each support line says what the section proves,
 * not what it is called.
 */
const CARDS = [
  {
    id: '00-intro',
    kicker: 'WORKSPACE OS',
    title: 'One workspace',
    support: 'Documents, mail, the web and agents — on your machine',
    bars: 2,
    covers: ['overview-rail'],
  },
  {
    id: '01-files',
    kicker: '01 — FILES',
    title: 'Sort, filter, find',
    support: 'Four ways to look at the same folder',
    bars: 1,
    covers: ['files-sort-filter', 'files-views'],
  },
  {
    // Mail and calendar together: 3.6s of calendar cannot carry its own card,
    // and "your day" is one idea rather than two.
    id: '02-day',
    kicker: '02 — YOUR DAY',
    title: 'Mail and calendar, in place',
    support: 'Read, write, and see the week without leaving',
    bars: 1,
    covers: ['mail-inbox', 'mail-compose', 'calendar-week'],
  },
  {
    id: '03-web',
    kicker: '03 — THE WEB',
    title: 'A browser that reads along',
    support: 'The assistant knows the page you are on',
    bars: 1,
    covers: ['browser-page', 'browser-assistant'],
  },
  {
    id: '04-agents',
    kicker: '04 — AGENTS',
    title: 'Describe it, and it is built',
    support: 'Specialists that work on your own files',
    bars: 1,
    covers: ['agents-roster', 'agents-new'],
  },
  {
    id: '05-documents',
    kicker: '05 — DOCUMENTS',
    title: 'Native office, locally',
    support: 'A real engine — no upload, no round trip',
    bars: 1,
    covers: ['office-editing'],
  },
  {
    // The four feature-* clips are deliberately not used. browser-layout-flow
    // tells the same story in one continuous take and was made for it; four
    // toggle demos spent a third of the film on window management.
    id: '06-room',
    kicker: '06 — ROOM TO WORK',
    title: 'The window gets out of the way',
    support: 'Dock it, move it, or fill the screen',
    bars: 1,
    covers: ['browser-layout-flow', 'terminal-drag-file'],
  },
  {
    id: '07-outro',
    kicker: 'WORKSPACE OS',
    title: 'Everything in one place',
    support: 'And all of it yours',
    bars: 2,
    wash: false,
    covers: [],
  },
]

fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })
fs.mkdirSync(OUT, { recursive: true })

const app = await electron.launch({
  args: [path.join(ROOT, 'out/main/index.js'), '--user-data-dir=/tmp/wos-demo-profile'],
  cwd: ROOT,
  env: { ...process.env, WORKSPACE_TEST_ROOT: '/tmp/wos-demo' },
})
const win = await app.firstWindow({ timeout: 30000 })
await win.waitForSelector('#root', { timeout: 30000 })
await app.evaluate(({ BrowserWindow }, s) => {
  const w = BrowserWindow.getAllWindows()[0]
  w.setContentSize(s.w, s.h)
  w.center()
}, { w: CARD_W, h: CARD_H })

const manifest = []
for (const c of CARDS) {
  const seconds = c.bars * BAR
  const out = path.join(OUT, `${c.id}.mp4`)
  await renderCard(win, {
    style: 'cinematic',
    kicker: c.kicker,
    title: c.title,
    support: c.support,
    seconds,
    wash: c.wash !== false,
    out,
    tmp: TMP,
  })
  manifest.push({ ...c, seconds: Number(seconds.toFixed(3)), file: path.relative(ROOT, out) })
  console.log(`  ✓ ${c.id}  ${c.bars} bars (${seconds.toFixed(2)}s)  “${c.title}”`)
}

await app.close().catch(() => {})
fs.rmSync(TMP, { recursive: true, force: true })
fs.writeFileSync(path.join(OUT, 'cards.json'), JSON.stringify(manifest, null, 2))

const total = manifest.reduce((a, c) => a + c.seconds, 0)
console.log(`\n✓ ${manifest.length} cards · ${total.toFixed(1)}s of card time → ${path.relative(ROOT, OUT)}\n`)
