/**
 * Each card style on its own, for judging the animation itself.
 *
 *   node scripts/demo/style-samples.mjs
 *
 * Output: build/demo/styles/<style>.mp4 + contact-sheet.png
 *
 * For choosing BETWEEN styles use `style-preview.mjs` instead — a card is
 * judged by how it meets the shot after it, which this cannot show. This is for
 * looking closely at one card's timing.
 *
 * The style definitions live in card-styles.mjs and are NOT duplicated here.
 * They were, and the two copies drifted: this script kept re-rendering the
 * original cinematic card for a day after the beat-locked one replaced it, so
 * the file on disk disagreed with the one in the previews.
 */
import { _electron as electron } from 'playwright'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { STYLES, renderCard, CARD_W, CARD_H } from './card-styles.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = path.join(ROOT, 'build/demo/styles')
const TMP = path.join(OUT, '_tmp')
const BAR = (60 / 90) * 4 // 2.667s — the music's bar, so the sample is a real one

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

for (const style of Object.keys(STYLES)) {
  const out = path.join(OUT, `${style}.mp4`)
  await renderCard(win, {
    style,
    kicker: '02 — FILES',
    title: 'Sort, filter, find',
    support: 'Four ways to look at the same folder',
    seconds: 2 * BAR,
    out,
    tmp: TMP,
  })
  // A still from the last beat, once everything has landed.
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-ss', (2 * BAR - 0.9).toFixed(2), '-i', out,
    '-frames:v', '1', path.join(OUT, `${style}.png`),
  ])
  console.log(`  ✓ ${STYLES[style].label}`)
}

await app.close().catch(() => {})

execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error',
  ...Object.keys(STYLES).flatMap((n) => ['-i', path.join(OUT, `${n}.png`)]),
  '-filter_complex', '[0][1]hstack[t];[2][3]hstack[b];[t][b]vstack,scale=1512:-2',
  path.join(OUT, 'contact-sheet.png'),
])
fs.rmSync(TMP, { recursive: true, force: true })
console.log(`\n✓ ${path.relative(ROOT, OUT)} — contact-sheet.png compares all four\n`)
