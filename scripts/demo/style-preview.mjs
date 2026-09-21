/**
 * Each card style cut against REAL footage, with the music under it.
 *
 *   node scripts/demo/style-preview.mjs
 *
 * Output: build/demo/styles/preview-<style>.mp4  (~18s each)
 *
 * The isolated samples showed what each style looks like; they could not show
 * the thing that actually decides it — how a card MEETS the shot after it. A
 * dark card cutting into a white UI flashes at every interstitial, and there
 * are eight or nine of them in the finished film. That is invisible until you
 * watch the join.
 */
import { _electron as electron } from 'playwright'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { STYLES, renderCard, CARD_W, CARD_H } from './card-styles.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CLIPS = path.join(ROOT, 'build/demo/clips')
const OUT = path.join(ROOT, 'build/demo/styles')
const TMP = path.join(OUT, '_tmp')
const TRACK = process.argv[2] || process.env.WOS_DEMO_TRACK || ''
if (!TRACK) { console.error('usage: pass the music track as the first argument or set WOS_DEMO_TRACK'); process.exit(2) }
const BAR = (60 / 90) * 4 // 2.667s — measured by analyze-track.mjs

const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })

/** A shot taken from a real clip, cut to a whole number of bars. */
function shot(clipId, from, bars, out) {
  const src = path.join(CLIPS, `${clipId}.mp4`)
  if (!fs.existsSync(src)) return null
  ff([
    '-ss', from.toFixed(2), '-t', (bars * BAR).toFixed(3), '-i', src,
    '-vf', `scale=${CARD_W}:${CARD_H},fps=30,setsar=1`,
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
    out,
  ])
  return out
}

fs.mkdirSync(TMP, { recursive: true })

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
  const parts = []

  // Opening card → a shot → an interstitial → another shot. That sequence is
  // the whole film in miniature, and it contains both joins that matter.
  parts.push(
    await renderCard(win, {
      style,
      kicker: 'WORKSPACE OS',
      title: 'One workspace',
      support: 'Documents, mail, the web and agents — on your machine',
      seconds: 2 * BAR,
      out: path.join(TMP, `${style}-intro.mp4`),
      tmp: TMP,
    }),
  )
  const s1 = shot('mail-inbox', 2.0, 2, path.join(TMP, `${style}-shot1.mp4`))
  if (s1) parts.push(s1)

  parts.push(
    await renderCard(win, {
      style,
      kicker: '02 — FILES',
      title: 'Sort, filter, find',
      support: 'Four ways to look at the same folder',
      seconds: 1.5 * BAR,
      out: path.join(TMP, `${style}-mid.mp4`),
      tmp: TMP,
    }),
  )
  const s2 = shot('files-views', 6.0, 2, path.join(TMP, `${style}-shot2.mp4`))
  if (s2) parts.push(s2)

  const list = path.join(TMP, `${style}-list.txt`)
  fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n'))
  const silent = path.join(TMP, `${style}-silent.mp4`)
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent])

  const total = parts.length * 0 + (2 + 1.5) * BAR + 4 * BAR // cards + shots
  const final = path.join(OUT, `preview-${style}.mp4`)
  ff([
    '-i', silent, '-i', TRACK,
    '-filter_complex',
    `[1:a]atrim=0:${total.toFixed(2)},afade=t=in:st=0:d=0.3,afade=t=out:st=${(total - 1.2).toFixed(2)}:d=1.2[a]`,
    '-map', '0:v', '-map', '[a]', '-shortest',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    final,
  ])
  console.log(`  ✓ ${STYLES[style].label} → ${path.relative(ROOT, final)}`)
}

await app.close().catch(() => {})
fs.rmSync(TMP, { recursive: true, force: true })
console.log(`\nFour previews in ${path.relative(ROOT, OUT)} — watch the JOINS, not the cards.\n`)
