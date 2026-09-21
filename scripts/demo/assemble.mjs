/**
 * Assembles the film: cards, trimmed clips, caption overlays, music.
 *
 *   node scripts/demo/assemble.mjs
 *
 * Output: build/demo/cuts/workspace-os-<date>.mp4
 *
 * EVERY duration is expressed in BARS. The track is 90 BPM so a bar is 2.667s,
 * and expressing lengths in bars is what keeps the film on the grid — a cut two
 * frames off the beat reads as a mistake to someone who could not say why.
 *
 * Captions are burned in HERE, never into the clips in build/demo/clips. Those
 * stay clean so they can be re-cut, re-captioned or re-scored without
 * re-recording anything. This script is the only thing that combines them.
 */
import { _electron as electron } from 'playwright'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { CARD_W, CARD_H } from './card-styles.mjs'
import { EDIT } from './edit.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CLIPS = path.join(ROOT, 'build/demo/clips')
const CARDS = path.join(ROOT, 'build/demo/story/cards')
const CUTS = path.join(ROOT, 'build/demo/cuts')
const TMP = path.join(CUTS, '_tmp')
const TRACK = process.argv[2] || process.env.WOS_DEMO_TRACK || ''
if (!TRACK) { console.error('usage: pass the music track as the first argument or set WOS_DEMO_TRACK'); process.exit(2) }

const BPM = 90
const BAR = (60 / BPM) * 4
const BEAT = 60 / BPM
const FPS = 30

const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })

/* ── caption overlays ────────────────────────────────────────────────────── */

const CAPTION_CSS = `
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${CARD_W}px;height:${CARD_H}px;background:transparent;overflow:hidden;
            font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif}
  .cap{position:fixed;left:52px;bottom:52px;display:inline-flex;align-items:center;gap:14px;
       padding:14px 24px 14px 20px;border-radius:14px;
       background:rgba(10,11,15,.82);
       -webkit-backdrop-filter:saturate(180%) blur(24px);
       box-shadow:0 18px 50px rgba(0,0,0,.34);
       color:#fff;font-size:23px;font-weight:500;letter-spacing:-.005em;white-space:nowrap}
  /* The accent bar carries the card's gradient, so a caption reads as part of
     the same film rather than a subtitle bolted on. */
  .bar{width:3px;height:26px;border-radius:2px;flex:none;
       background:linear-gradient(180deg,#2F5BFF,#A855F7,#FF6B9D)}
`

async function renderCaption(win, text, out) {
  const file = path.join(TMP, `cap-${Buffer.from(text).toString('hex').slice(0, 12)}.html`)
  fs.writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${CAPTION_CSS}</style></head><body><div class="cap"><span class="bar"></span><span>${text}</span></div></body></html>`,
  )
  await win.goto(`file://${file}`)
  await win.waitForTimeout(220)
  // omitBackground keeps the PNG transparent everywhere but the pill.
  await win.screenshot({ path: out, omitBackground: true })
  fs.rmSync(file, { force: true })
}

/* ── build ───────────────────────────────────────────────────────────────── */

fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })
fs.mkdirSync(CUTS, { recursive: true })

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

const parts = []
let total = 0

for (const [i, step] of EDIT.entries()) {
  const out = path.join(TMP, `p${String(i).padStart(2, '0')}.mp4`)

  if (step.card) {
    const src = path.join(CARDS, `${step.card}.mp4`)
    if (!fs.existsSync(src)) {
      console.log(`  ! missing card ${step.card}`)
      continue
    }
    // Cards are already the right length and format; copy rather than re-encode.
    fs.copyFileSync(src, out)
    const d = Number(
      execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', src], {
        encoding: 'utf8',
      }).trim(),
    )
    total += d
    parts.push(out)
    console.log(`  ▪ ${step.card}  ${d.toFixed(2)}s`)
    continue
  }

  const src = path.join(CLIPS, `${step.clip}.mp4`)
  if (!fs.existsSync(src)) {
    console.log(`  ! missing clip ${step.clip}`)
    continue
  }
  const dur = step.bars * BAR

  /**
   * Does the clip actually HOLD the slot the edit asks for?
   *
   * ffmpeg does not complain when `-ss` + `-t` runs past the end — it returns
   * the short remainder and exits 0. Four clips were overrun that way, the film
   * came out 3.3s under, and every cut after the first overrun sat off the beat.
   * Nothing in the output said so: the film played, the music fitted, and the
   * drift was only visible if you counted bars.
   *
   * Pulling `from` back is the right repair because it keeps the bar count,
   * which is what the grid depends on; only the lead-in is lost. If even bar
   * zero does not fit, no trim can save it — that clip needs re-recording, and
   * saying so loudly beats shipping a film that is quietly out of time.
   */
  const have = Number(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', src], {
      encoding: 'utf8',
    }).trim(),
  )
  let from = step.from
  if (from + dur > have) {
    const clamped = have - dur
    if (clamped < 0) {
      console.error(
        `\n✗ ${step.clip} is ${have.toFixed(2)}s but the edit gives it ${step.bars} bars ` +
          `(${dur.toFixed(2)}s). Re-record it longer or reduce its bars.\n`,
      )
      process.exit(1)
    }
    console.log(`    ~ ${step.clip}: from ${from.toFixed(2)} → ${clamped.toFixed(2)} (clip is ${have.toFixed(2)}s)`)
    from = clamped
  }

  if (step.caption) {
    const png = path.join(TMP, `cap${i}.png`)
    await renderCaption(win, step.caption, png)
    // In one beat after the clip starts, out one beat before it ends.
    const inAt = BEAT
    const outAt = Math.max(inAt + 0.6, dur - BEAT)
    ff([
      '-ss', from.toFixed(2), '-t', dur.toFixed(3), '-i', src,
      // -loop 1: a PNG input yields ONE frame and then ends, so the overlay
      // stream was already over by the time the caption's fade-in began at
      // beat 1. It rendered nothing, every time, silently.
      '-loop', '1', '-i', png,
      '-filter_complex',
      `[0:v]fps=${FPS},scale=${CARD_W}:${CARD_H},setsar=1[v];` +
        // Scaled DOWN first: the screenshot comes back at 2x device pixels on a
        // Retina display, so overlaying it untouched puts only its top-left
        // quadrant on the frame — and the caption sits bottom-left, outside it.
        // The pill was rendering correctly and landing off-screen every time.
        `[1:v]scale=${CARD_W}:${CARD_H},format=rgba,fade=t=in:st=${inAt.toFixed(2)}:d=0.35:alpha=1,` +
        `fade=t=out:st=${outAt.toFixed(2)}:d=0.35:alpha=1[c];` +
        // shortest=1 on the OVERLAY, not -shortest on the output: with
        // filter_complex the output-level flag is unreliable, so the looped PNG
        // kept the encode running forever — one clip was still being written
        // after 29 minutes and had produced a multi-gigabyte file.
        `[v][c]overlay=0:0:format=auto:shortest=1[o]`,
      '-map', '[o]', '-an',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p',
      out,
    ])
  } else {
    ff([
      '-ss', from.toFixed(2), '-t', dur.toFixed(3), '-i', src,
      '-vf', `fps=${FPS},scale=${CARD_W}:${CARD_H},setsar=1`,
      '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
      out,
    ])
  }
  total += dur
  parts.push(out)
  console.log(`  · ${step.clip.padEnd(22)} ${step.bars} bars (${dur.toFixed(2)}s)`)
}

await app.close().catch(() => {})

/* ── join and score ──────────────────────────────────────────────────────── */

const list = path.join(TMP, 'concat.txt')
fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n'))
const silent = path.join(TMP, 'silent.mp4')
ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent])

const stamp = new Date().toISOString().slice(0, 10)
const final = path.join(CUTS, `workspace-os-${stamp}.mp4`)
ff([
  '-i', silent, '-i', TRACK,
  '-filter_complex',
  `[0:v]fade=t=in:st=0:d=0.6[v];` +
    `[1:a]atrim=0:${total.toFixed(3)},afade=t=in:st=0:d=0.5,` +
    `afade=t=out:st=${Math.max(0, total - 2 * BAR).toFixed(2)}:d=${(2 * BAR).toFixed(2)}[a]`,
  '-map', '[v]', '-map', '[a]', '-shortest',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
  final,
])

fs.rmSync(TMP, { recursive: true, force: true })
console.log(`\n✓ ${path.relative(ROOT, final)}`)
console.log(`  ${total.toFixed(1)}s  ·  ${(total / BAR).toFixed(1)} bars  ·  track is 126.2s\n`)
